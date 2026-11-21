package com.openmausbot.companion.core

import kotlinx.serialization.json.JsonObject

data class VectraChatState(
    val messages: List<VectraMessage> = emptyList(),
    val working: Boolean = false,
    val label: String? = null,
    val cursor: String? = null,
    val replyIndex: Int? = null,
    val usage: String? = null,
    val tasks: List<JsonObject> = emptyList(),
    val problem: String? = null,
) {
    fun start(message: String, optimisticId: String): VectraChatState =
        copy(
            messages = if (message.isBlank()) messages else messages + VectraMessage(optimisticId, "user", message),
            working = true,
            label = null,
            replyIndex = null,
            problem = null,
        )

    fun stop() = copy(working = false, label = null, replyIndex = null)

    fun accept(event: JsonObject, history: List<VectraMessage> = emptyList()): VectraChatState {
        val kind = event.string("type").orEmpty()
        val id = event.string("id")
        val sequence = id?.toLongOrNull()?.takeIf { it > 0 }
        if (sequence != null && sequence <= (cursor?.toLongOrNull() ?: 0)) return this
        val next = if (sequence == null) this else copy(cursor = id)
        return when (kind) {
            "snapshot", "status" -> {
                val busy = event.flag("busy")
                val nextLabel = eventLabel(event, kind)
                val tasks = if ("backgroundTasks" in event) event.objects("backgroundTasks") else next.tasks
                when (busy) {
                    true -> next.copy(working = true, label = nextLabel ?: next.label, tasks = tasks)
                    false -> if (event.flag("queued") == true) next.copy(working = true, label = "Queued", tasks = tasks)
                    else next.stop().copy(tasks = tasks)
                    null -> if (nextLabel == null) next else next.copy(working = true, label = nextLabel)
                }
            }
            "progress", "thinking", "tool", "tool_use", "tool_call", "tool_result", "typing" -> {
                if (kind == "typing" && event.flag("busy") == false) next
                else next.copy(working = true, label = eventLabel(event, kind) ?: next.label)
            }
            "done", "result", "completed" -> next.stop()
            "error" -> next.stop().copy(problem = safeVectraText(eventText(event)).ifBlank { "The agent could not finish this reply." })
            "usage" -> next.copy(usage = event.string("label")?.let(::safeVectraText)
                ?: event.number("pct")?.let { "Context $it%" })
            "queued" -> next.copy(working = true, label = "Queued")
            "background" -> next.copy(tasks = event.objects("tasks"))
            "user" -> next.applyUser(event, history)
            "text", "delta", "chunk" ->
                if (event.string("role") in setOf("tool", "analysis", "thinking", "reasoning")) next
                else next.applyReply(event, kind, history)
            "approve", "approval", "ask", "picker", "file" -> next.appendCard(event, kind)
            else -> next
        }
    }

    private fun applyUser(event: JsonObject, history: List<VectraMessage>): VectraChatState {
        val content = eventText(event).trim()
        if (content.isEmpty()) return this
        val messageId = event.string("messageId") ?: event.string("id").orEmpty()
        val optimistic = messages.indexOfLast { it.kind == "text" && it.role == "user" && it.id.startsWith("local-") && it.text.trim() == content }
        if (optimistic >= 0) return copy(messages = messages.toMutableList().apply {
            this[optimistic] = this[optimistic].copy(id = messageId)
        })
        if (isReplay("user", messageId, content, history)) return this
        return copy(messages = messages + VectraMessage(messageId, "user", content), replyIndex = null)
    }

    private fun applyReply(event: JsonObject, kind: String, history: List<VectraMessage>): VectraChatState {
        val explicitDelta = event.string("delta") ?: event.string("chunk")
        val content = explicitDelta ?: eventText(event)
        if (content.isEmpty()) return this
        val messageId = event.string("messageId") ?: event.string("id").orEmpty()
        val progressive = explicitDelta != null || kind == "delta" || kind == "chunk"
        if (replyIndex == null && !progressive && isReplay("agent", messageId, content, history)) return this
        val prior = replyIndex?.let { messages.getOrNull(it) }
        val shown = safeVectraText(if (progressive) (prior?.text.orEmpty() + content) else content)
        if (!working && prior == null && messages.lastOrNull()?.let { it.role == "agent" && it.text == shown } == true) return this
        val nextIndex = replyIndex ?: messages.size
        val message = VectraMessage(messageId, "agent", shown)
        val updated = if (prior == null) messages + message else messages.toMutableList().apply { this[nextIndex] = message }
        return copy(messages = updated, replyIndex = nextIndex.takeUnless { !working && event.flag("final") == true })
    }

    private fun appendCard(event: JsonObject, kind: String): VectraChatState {
        val ref = event.string("ref") ?: event.string("fileId") ?: event.string("id").orEmpty()
        if (ref.isNotBlank() && messages.any { it.id == ref && it.kind == kind }) return this
        val role = if (event.string("role") == "user") "user" else "agent"
        return copy(messages = messages + VectraMessage(ref, role, safeVectraText(eventText(event)), kind, event))
    }

    private fun isReplay(role: String, id: String, text: String, history: List<VectraMessage>): Boolean =
        (id.isNotEmpty() && messages.any { it.id == id && it.role == role && it.text == text }) ||
            history.any { it.role == role && it.text == text }
}

private fun eventText(event: JsonObject) = sequenceOf("text", "summary", "detail", "question", "caption")
    .mapNotNull(event::string).firstOrNull { it.isNotBlank() }.orEmpty()

private fun eventLabel(event: JsonObject, kind: String): String? {
    val type = event.string("kind")
    val explicit = sequenceOf("label", "toolName", "tool", "name", "title", "lastTool")
        .mapNotNull(event::string).firstOrNull { it.isNotBlank() }
    val candidate = when {
        explicit != null -> explicit
        kind == "thinking" || type == "thinking" -> "Thinking"
        kind.startsWith("tool") -> "Using a tool"
        kind == "progress" -> eventText(event)
        kind == "status" && event.flag("busy") == true -> eventText(event)
        else -> null
    }
    return candidate?.lineSequence()?.firstOrNull()?.trim()
        ?.takeUnless { it.isBlank() || it == "ready" || it.startsWith("{") || it.startsWith("[") }
        ?.take(128)?.let(::safeVectraText)
}

fun safeVectraText(text: String): String = text
    .replace(Regex("(?i)\\b(?:timeout|timed\\s+out|time-out)\\b"), "connection delay")
