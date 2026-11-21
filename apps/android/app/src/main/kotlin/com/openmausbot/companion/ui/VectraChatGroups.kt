package com.openmausbot.companion.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraAttachment
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.objects
import com.openmausbot.companion.core.safeVectraText
import com.openmausbot.companion.core.string
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private data class PendingGroupMessage(val id: String, val text: String, val mentions: Set<String>)

@Composable
internal fun VectraGroupChat(
    api: VectraApi,
    workspaceId: String,
    bots: List<VectraBot>,
    failure: (Throwable) -> String?,
    onBack: () -> Unit,
    onOpenBot: (VectraBot, String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    var input by remember(workspaceId) { mutableStateOf(TextFieldValue("")) }
    val text = input.text
    val composer = remember { FocusRequester() }
    var focusAfterMention by remember { mutableStateOf(false) }
    var messages by remember(workspaceId) { mutableStateOf(emptyList<JsonObject>()) }
    var activity by remember(workspaceId) { mutableStateOf(emptyList<JsonObject>()) }
    var pending by remember(workspaceId) { mutableStateOf<PendingGroupMessage?>(null) }
    var busy by remember(workspaceId) { mutableStateOf(false) }
    var error by remember(workspaceId) { mutableStateOf<String?>(null) }
    var paused by remember(workspaceId) { mutableStateOf(false) }
    var loaded by remember(workspaceId) { mutableStateOf(false) }
    var mention by remember(workspaceId) { mutableStateOf(false) }
    var mentioned by remember(workspaceId) { mutableStateOf(emptySet<String>()) }
    suspend fun refresh() {
        try {
            val snapshot = withContext(Dispatchers.IO) { api.group(workspaceId) }
            paused = snapshot.flag("paused") == true
            if (!paused) {
                messages = snapshot.objects("messages")
                activity = snapshot.objects("activity")
            }
            val expected = pending?.id
            if (expected != null && messages.any { it.string("id") == expected }) pending = null
            if (pending == null) error = null
        } catch (cause: Exception) {
            error = failure(cause)
        } finally { loaded = true }
    }
    fun send(retry: Boolean) {
        if (busy || paused) return
        val request = if (retry) pending else {
            val entered = text.trim()
            if (entered.isBlank() || pending != null) return
            if (entered.toByteArray(Charsets.UTF_8).size > 16_000) {
                error = "Keep group messages under 16,000 bytes."
                return
            }
            PendingGroupMessage("group-${UUID.randomUUID()}", entered,
                bots.filter { it.agentId in mentioned && entered.contains("@${it.name}") }.map { it.agentId }.toSet())
        } ?: return
        if (!retry) { input = TextFieldValue(""); mentioned = emptySet() }
        pending = request
        busy = true
        error = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { api.sendGroup(workspaceId, request.text, request.id, request.mentions) }
                refresh()
            } catch (cause: Exception) {
                error = failure(cause)
            } finally { busy = false }
        }
    }
    LaunchedEffect(workspaceId) {
        while (true) {
            refresh()
            delay(3000)
        }
    }
    LaunchedEffect(messages.size, pending?.id) {
        val count = messages.size + if (pending != null) 1 else 0
        if (count > 0) list.scrollToItem(count - 1)
    }
    LaunchedEffect(mention, focusAfterMention) {
        if (!mention && focusAfterMention) {
            composer.requestFocus()
            focusAfterMention = false
        }
    }

    VectraPage("Group chat", onBack) {
        Column(Modifier.fillMaxSize().imePadding().padding(horizontal = 12.dp)) {
            optionsRow {
                bots.forEach { bot -> TextButton(onClick = { onOpenBot(bot, null) }) { Text(bot.name) } }
            }
            if (paused) Text("The workspace is paused. Wake it to send a message.", Modifier.padding(8.dp))
            if (!loaded) Text("Loading group chat…", Modifier.padding(8.dp))
            if (loaded && messages.isEmpty() && pending == null && !paused) Text("No group messages yet.", Modifier.padding(8.dp))
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(messages) { message ->
                    val sender = message.string("senderBotId")
                    val owner = bots.firstOrNull { it.agentId == sender }
                    val support = message.string("text").orEmpty()
                    VectraGroupBubble(safeVectraText(support), owner?.name ?: sender, owner?.let {
                        { onOpenBot(it, message.string("sessionId")) }
                    })
                }
                pending?.let { item { VectraGroupBubble(it.text, null, null) } }
            }
            activity.take(3).forEach { row ->
                val label = row.string("label") ?: row.string("status") ?: row.string("kind")
                if (!label.isNullOrBlank()) Text(safeVectraText(label), style = MaterialTheme.typography.labelSmall)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (pending != null && !busy && error != null) TextButton(onClick = { send(true) }) { Text("Retry message") }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { mention = true }) { Text("@") }
                OutlinedTextField(input, { input = it }, Modifier.weight(1f).focusRequester(composer), label = { Text("Message group") })
                Button(enabled = !paused && !busy && pending == null && text.isNotBlank(), onClick = { send(false) }) { Text("Send") }
            }
        }
    }
    if (mention) AlertDialog(
        title = { Text("Mention an agent") },
        onDismissRequest = { mention = false },
        text = {
            Column {
                bots.forEach { bot ->
                    TextButton(onClick = {
                        val draft = text.trimEnd().let { if (it.isEmpty()) "" else "$it " } + "@${bot.name} "
                        input = TextFieldValue(draft, selection = TextRange(draft.length))
                        mentioned = mentioned + bot.agentId
                        focusAfterMention = true
                        mention = false
                    }) { Text(bot.name) }
                }
            }
        },
        confirmButton = { TextButton(onClick = { mention = false }) { Text("Close") } },
    )
}

@Composable
private fun VectraGroupBubble(text: String, sender: String?, onAgent: (() -> Unit)?) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (sender == null) Alignment.CenterEnd else Alignment.CenterStart) {
        Card {
            Column(Modifier.padding(10.dp)) {
                if (sender != null) {
                    if (onAgent == null) Text(sender, style = MaterialTheme.typography.titleSmall)
                    else TextButton(onClick = onAgent) { Text(sender) }
                }
                Text(text)
            }
        }
    }
}

@Composable
internal fun VectraAgentDialog(
    api: VectraApi,
    workspaceId: String,
    activeBot: String,
    failure: (Throwable) -> String?,
    onDismiss: () -> Unit,
    onUpdated: (String?) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var profiles by remember { mutableStateOf(emptyList<JsonObject>()) }
    var target by remember { mutableStateOf(activeBot) }
    var name by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf("") }
    var instructions by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf("🤖") }
    var avatar by remember { mutableStateOf<VectraAttachment?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var archive by remember { mutableStateOf(false) }
    var mail by remember { mutableStateOf<String?>(null) }
    val requestId = remember { "app-${UUID.randomUUID()}" }
    val selectAvatar = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { readVectraAttachment(context, uri) }
                if (file.bytes.size > 1024 * 1024 || file.mime !in setOf("image/png", "image/jpeg", "image/webp")) {
                    mail = "Choose a PNG, JPEG, or WebP image up to 1 MB."
                } else avatar = file
            } catch (cause: Exception) { mail = failure(cause) }
        }
    }
    fun select(id: String) {
        target = id
        val row = profiles.firstOrNull { it.string("id") == id }
        name = row?.string("name").orEmpty()
        folder = row?.string("defaultFolder").orEmpty()
        instructions = row?.string("instructions").orEmpty()
        icon = row?.string("icon") ?: "🤖"
        avatar = null
    }
    LaunchedEffect(workspaceId) {
        try {
            profiles = withContext(Dispatchers.IO) { api.botProfiles(workspaceId) }
            select(activeBot)
        } catch (cause: Exception) { mail = failure(cause) }
        finally { loading = false }
    }
    fun submit(archiveBot: Boolean = false) {
        if (busy || (!archiveBot && name.isBlank())) return
        busy = true
        scope.launch {
            try {
                val updated = withContext(Dispatchers.IO) {
                    val result = api.saveBot(workspaceId, target.takeIf(String::isNotBlank), buildJsonObject {
                        if (archiveBot) put("archived", true)
                        else {
                            put("name", name.trim())
                            put("icon", icon)
                            put("instructions", instructions.trim())
                            if (target.isBlank()) put("createKey", requestId)
                            if (folder.isNotBlank()) put("defaultFolder", folder.trim())
                        }
                    })
                    val id = target.ifBlank { (result["bot"] as? JsonObject)?.string("id").orEmpty() }
                    if (!archiveBot && id.isNotBlank()) avatar?.let { api.uploadBotAvatar(workspaceId, id, it) }
                    id
                }
                onDismiss()
                onUpdated(updated.takeIf { !archiveBot && it.isNotBlank() })
            } catch (cause: Exception) { mail = failure(cause) }
            finally { busy = false }
        }
    }
    AlertDialog(
        title = { Text("Manage agents") },
        onDismissRequest = { if (!busy && !archive) onDismiss() },
        text = {
            Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val choices = mapOf("" to "New agent") + profiles.associate { it.string("id").orEmpty() to it.string("name").orEmpty() }
                VectraChoice("Agent", target, choices, !loading && !busy, ::select)
                OutlinedTextField(name, { name = it.take(80) }, label = { Text("Name") })
                OutlinedTextField(folder, { folder = it }, label = { Text("Default folder") })
                OutlinedTextField(instructions, { instructions = it }, label = { Text("Instructions") })
                val icons = listOf("🤖", "🔎", "🛠️", "🎨", "📝", "📊", "🧠", "🌐", "⚡", "✨", "💻", "🧪", "🔒")
                VectraChoice("Icon", icon, icons.associateWith { it }, !busy) { icon = it; avatar = null }
                TextButton(enabled = !busy, onClick = { selectAvatar.launch(arrayOf("image/png", "image/jpeg", "image/webp")) }) {
                    Text(avatar?.name ?: "Choose profile picture")
                }
                if (target.isNotBlank() && target != "main") TextButton(enabled = !busy, onClick = { archive = true }) { Text("Archive agent") }
                mail?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = { Button(enabled = !loading && !busy && name.isNotBlank(), onClick = { submit() }) { Text("Save agent") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Close") } },
    )
    if (archive) VectraConfirm("Archive $name?", "This agent will no longer appear in the active roster.", "Archive", { archive = false }) {
        archive = false
        submit(archiveBot = true)
    }
}
