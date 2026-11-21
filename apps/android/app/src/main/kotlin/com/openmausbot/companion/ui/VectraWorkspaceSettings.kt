package com.openmausbot.companion.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.PersistableBundle
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraWorkspace
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.obj
import com.openmausbot.companion.core.objects
import com.openmausbot.companion.core.string
import com.openmausbot.companion.core.number
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

private data class SettingField(val key: String, val label: String, val secret: Boolean = false)

private val providerFields = listOf(
    SettingField("model", "Model"),
    SettingField("baseUrl", "Base URL"),
)
private val integrationFields = listOf(
    SettingField("telegramBotToken", "Telegram bot token", secret = true),
    SettingField("discordBotToken", "Discord bot token", secret = true),
    SettingField("slackBotToken", "Slack bot token", secret = true),
    SettingField("slackAppToken", "Slack app token", secret = true),
)
private val imageFields = listOf(
    SettingField("imageProvider", "Image provider"),
    SettingField("imageModel", "Image model"),
    SettingField("imageBaseUrl", "Image base URL"),
    SettingField("imageFormat", "Image format"),
    SettingField("imageApiKey", "Image API key", true),
)
private val defaults = mapOf(
    "opencode-go" to ("https://opencode.ai/inference/go/openai/v1" to "glm-5.3-flash"),
    "opencode-zen" to ("https://opencode.ai/inference/openai/v1" to "glm-5.3"),
    "openscale" to ("https://api.openscale.so/v1" to "deepseek/deepseek-v4.1-flash"),
    "groq" to ("https://api.groq.com/openai/v1" to "llama-3.3-70b-versatile"),
    "zai" to ("https://api.z.ai/api/paas/v4" to "glm-5.1"),
    "kimi-coding" to ("https://api.moonshot.ai/v1" to "kimi-k2.6"),
    "kimi" to ("https://api.moonshot.ai/anthropic" to "kimi-k2.6"),
    "qwen" to ("https://dashscope-intl.aliyuncs.com/compatible-mode/v1" to "qwen3.6-plus"),
    "together" to ("https://api.together.xyz/v1" to "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
    "fireworks" to ("https://api.fireworks.ai/inference/v1" to "accounts/fireworks/models/llama-v3p3-70b-instruct"),
    "zenllm" to ("https://api.zenllm.org/v1" to "zhipu/glm-5.1"),
    "wiro" to ("https://llm.wiro.ai/v1" to "openai/gpt-5-6-sol"),
    "free-ai" to ("https://api.free.ai/v1" to "qwen7b"),
    "ollama" to ("http://127.0.0.1:11434/v1" to "llama3.3"),
    "lmstudio" to ("http://127.0.0.1:1234/v1" to "local-model"),
    "agentrouter" to ("https://agentrouter.org/v1" to "gpt-5.6-sol"),
    "mistral" to ("https://api.mistral.ai/v1" to "large-model-latest"),
    "pollinations" to ("https://gen.pollinations.ai/v1" to "openai"),
    "openai" to ("https://api.openai.com/v1" to "gpt-5.4"),
    "anthropic" to ("https://api.anthropic.com/v1" to "claude-sonnet-4-6"),
    "routingrun" to ("https://api.routing.run/v1" to "route/glm-5.1"),
    "openrouter" to ("https://openrouter.ai/api/v1" to "anthropic/claude-sonnet-4-6"),
    "grok" to ("https://api.x.ai/v1" to "grok-4-0709"),
    "google" to ("https://generativelanguage.googleapis.com/v1beta/openai" to "gemini-3-pro-preview"),
    "nous" to ("https://inference-api.nousresearch.com/v1" to "deepseek/deepseek-v4-flash"),
    "deepseek" to ("https://api.deepseek.com/v1" to "deepseek-v4-pro"),
)
private val formats = mapOf("chat_completions" to "Chat Completions", "messages" to "Messages", "responses" to "Responses")

private fun providerFormat(provider: String, raw: String? = null): String = when (raw?.lowercase()?.replace('-', '_')) {
    "anthropic", "anthropic_messages", "messages" -> "messages"
    "response", "responses" -> "responses"
    "chat_completion", "chat_completions", "chatcompletions", "openai", "openai_compatible" -> "chat_completions"
    else -> when (provider) { "anthropic", "kimi" -> "messages"; "agentrouter" -> "responses"; else -> "chat_completions" }
}

@Composable
internal fun VectraWorkspaceSettings(
    api: VectraApi,
    workspace: VectraWorkspace,
    failure: (Throwable) -> String?,
    onBack: () -> Unit,
    onChat: () -> Unit,
    onFiles: () -> Unit,
    onBilling: () -> Unit,
    onPollinations: () -> Unit,
    onDestroyed: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var values by remember(workspace.id) { mutableStateOf(emptyMap<String, String>()) }
    var slots by remember(workspace.id) { mutableStateOf(emptyList<JsonObject>()) }
    var hints by remember(workspace.id) { mutableStateOf(emptyMap<String, String>()) }
    var knownSecrets by remember(workspace.id) { mutableStateOf(emptyMap<String, String>()) }
    var activeSlotId by remember(workspace.id) { mutableStateOf("") }
    var allowAll by remember(workspace.id) { mutableStateOf(false) }
    var mismatch by remember(workspace.id) { mutableStateOf<String?>(null) }
    var ready by remember(workspace.id) { mutableStateOf(false) }
    var busy by remember(workspace.id) { mutableStateOf(true) }
    var message by remember(workspace.id) { mutableStateOf<String?>(null) }
    var confirm by remember(workspace.id) { mutableStateOf("") }
    var models by remember(workspace.id) { mutableStateOf(emptyList<JsonObject>()) }
    var pairing by remember(workspace.id) { mutableStateOf<JsonObject?>(null) }
    var cli by remember(workspace.id) { mutableStateOf<JsonObject?>(null) }
    var logs by remember(workspace.id) { mutableStateOf("") }
    var pairCode by remember(workspace.id) { mutableStateOf("") }
    var command by remember(workspace.id) { mutableStateOf("") }
    var cwd by remember(workspace.id) { mutableStateOf("/home/user/workspace") }
    var history by remember(workspace.id) { mutableStateOf(emptyList<Pair<String, JsonObject>>()) }
    val supercharge = workspace.runtime == "supercharge"

    fun field(key: String) = values[key].orEmpty()
    fun change(key: String, value: String) { values = values + (key to value) }

    suspend fun readConfig() {
        val data = withContext(Dispatchers.IO) { api.config(workspace.id) }
        val sandbox = data.obj("sandbox")
        val stored = data.obj("stored")
        fun read(key: String) = sequenceOf(sandbox, stored, data).mapNotNull { it.string(key)?.takeIf(String::isNotBlank) }.firstOrNull().orEmpty()
        val selected = read("provider").ifBlank { "pollinations" }
        val imageProvider = read("imageProvider").ifBlank { selected }
        values = mapOf(
            "provider" to selected,
            "model" to read("model").ifBlank { defaults[selected]?.second.orEmpty() },
            "baseUrl" to read("baseUrl").ifBlank { defaults[selected]?.first.orEmpty() },
            "format" to providerFormat(selected, read("format")),
            "imageProvider" to imageProvider,
            "imageModel" to read("imageModel").ifBlank { if (imageProvider == "pollinations") "flux" else "" },
            "imageBaseUrl" to read("imageBaseUrl").ifBlank { defaults[imageProvider]?.first.orEmpty() },
            "imageFormat" to read("imageFormat").ifBlank {
                when (imageProvider) {
                    "pollinations" -> "pollinations"
                    "openai" -> "openai_images"
                    else -> "custom"
                }
            },
        )
        slots = if (sandbox["savedProviders"] is JsonArray) sandbox.objects("savedProviders") else stored.objects("savedProviders")
        activeSlotId = slotId(selected, field("baseUrl"))
        knownSecrets = (listOf("apiKey", "imageApiKey") + integrationFields.map { it.key }).associateWith(::read)
        hints = mapOf(
            "apiKey" to read("apiKeyHint"),
            "telegramBotToken" to read("telegramHint"),
            "discordBotToken" to read("discordHint"),
            "slackBotToken" to read("slackHint"),
            "imageApiKey" to read("imageApiKeyHint"),
        )
        allowAll = sandbox.flag("allowAllUsers") ?: stored.flag("allowAllUsers") ?: false
        mismatch = data.string("runtimeMismatchMessage")
        ready = true
    }

    suspend fun load() {
        busy = true
        try {
            readConfig()
        } catch (cause: Exception) {
            message = failure(cause)
        } finally {
            busy = false
        }
    }
    LaunchedEffect(workspace.id) { load() }
    LaunchedEffect(workspace.id, ready) {
        if (!ready) return@LaunchedEffect
        try {
            pairing = withContext(Dispatchers.IO) { api.pairing(workspace.id) }
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            failure(cause)
        }
        try {
            cli = withContext(Dispatchers.IO) { api.cliVersion(workspace.id) }
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            failure(cause)
        }
    }
    LaunchedEffect(field("provider")) {
        models = emptyList()
        val identifier = field("provider").trim()
        if (identifier.isEmpty()) return@LaunchedEffect
        delay(300)
        try {
            models = withContext(Dispatchers.IO) { api.models(identifier) }
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            failure(cause)
        }
    }

    fun run(label: String, action: suspend () -> String?) {
        if (busy) return
        busy = true
        message = label
        scope.launch {
            try {
                message = action()
            } catch (cause: Exception) {
                message = failure(cause)
            } finally {
                busy = false
            }
        }
    }

    fun chooseProvider(provider: String) {
        values = values + mapOf(
            "provider" to provider,
            "baseUrl" to defaults[provider]?.first.orEmpty(),
            "model" to defaults[provider]?.second.orEmpty(),
            "format" to providerFormat(provider),
            "apiKey" to "",
        )
    }

    fun snapshot(): JsonObject = buildJsonObject {
        val provider = field("provider").trim().lowercase().ifBlank { "custom" }
        val url = field("baseUrl").trim().ifBlank { defaults[provider]?.first.orEmpty() }
        put("id", slotId(provider, url))
        put("provider", provider)
        put("baseUrl", url)
        put("model", field("model").trim())
        put("format", providerFormat(provider, field("format")))
        field("apiKey").trim().takeIf(String::isNotEmpty)?.let { put("apiKey", it) }
    }

    fun currentSlots(active: JsonObject): List<JsonObject> {
        val id = active.string("id")
        val existing = slots.firstOrNull { it.string("id") == id }
        val previousKey = existing?.get("apiKey")
        val updated = if (active["apiKey"] == null && previousKey != null) {
            JsonObject(active + ("apiKey" to previousKey))
        } else active
        return if (existing == null) slots + updated else slots.map { if (it.string("id") == id) updated else it }
    }

    fun save() = run("Saving settings and restarting…") {
        val active = snapshot()
        val id = active.string("id")
        val switching = id != activeSlotId
        val savedKey = if (switching) slots.firstOrNull { it.string("id") == id }?.string("apiKey") else null
        if (switching && active["apiKey"] == null && savedKey.isNullOrBlank() && !knownSecrets["apiKey"].isNullOrBlank()) {
            return@run "Enter an API key or select a saved provider with a key."
        }
        val body = buildJsonObject {
            active.forEach { (key, value) -> if (key != "id") put(key, value) }
            if (active["apiKey"] == null && !savedKey.isNullOrBlank()) put("apiKey", savedKey)
            put("savedProviders", JsonArray(currentSlots(active)))
            put("allowAllUsers", allowAll)
            put("restart", true)
            (integrationFields + if (supercharge) imageFields else emptyList()).forEach { setting ->
                val value = field(setting.key).trim()
                if (value.isNotEmpty()) put(setting.key, value)
            }
        }
        val result = withContext(Dispatchers.IO) { api.saveConfig(workspace.id, body) }
        readConfig()
        val requestedProvider = active.string("provider").orEmpty()
        val requestedModel = active.string("model").orEmpty()
        when {
            field("provider") != requestedProvider || (requestedModel.isNotBlank() && field("model") != requestedModel) ->
                "The saved settings did not match your selection. Check the provider and try again."
            result.flag("ok") == false ->
                "Settings were saved, but the workspace could not restart. Open Maintenance and try Restart."
            else -> "Settings saved."
        }
    }

    val selectedId = snapshot().string("id")
    val selectedSecret = if (selectedId == activeSlotId) knownSecrets["apiKey"]
    else slots.firstOrNull { it.string("id") == selectedId }?.string("apiKey")
    val displayedSecrets = knownSecrets + ("apiKey" to selectedSecret.orEmpty())
    var section by remember(workspace.id) { mutableStateOf("AI models") }
    VectraPage("Workspace settings", { if (!busy) onBack() }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(workspace.name, style = MaterialTheme.typography.titleMedium)
            Text(listOf(if (supercharge) "Supercharge" else "XibeCode", workspace.state.replace('_', ' '), if (workspace.free) "Free" else "").filter(String::isNotBlank).joinToString(" · "))
            optionsRow {
                TextButton(onClick = onChat) { Text("Chat") }
                TextButton(onClick = onFiles) { Text("Files") }
                TextButton(onClick = { scope.launch { load() } }, enabled = !busy) { Text("Refresh") }
                TextButton(onClick = onBilling) { Text("Billing / renew") }
            }
            if (ready) Button(enabled = !busy, onClick = ::save) { Text("Save settings") }
            Text(message ?: if (busy) "Loading settings…" else "", color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!ready && !busy) TextButton(onClick = { scope.launch { load() } }) { Text("Retry") }
            mismatch?.let { Text(vectraSafeStatus(it), color = MaterialTheme.colorScheme.error) }
            HorizontalDivider()
            optionsRow {
                listOf("AI models", "Messaging", "Tools", "Maintenance").forEach { name ->
                    androidx.compose.material3.FilterChip(selected = section == name, onClick = { section = name }, label = { Text(name) })
                }
            }
            if (section == "AI models") {
                Text("AI provider", style = MaterialTheme.typography.titleMedium)
                VectraProviderPicker(field("provider"), ready && !busy, ::chooseProvider)
                VectraSettingsFields(providerFields, values, hints, displayedSecrets, ready && !busy, ::change)
                val modelOptions = models.mapNotNull { it.string("id")?.let { id -> id to (it.string("label") ?: it.string("name") ?: id) } }.toMap()
                if (modelOptions.isNotEmpty()) VectraChoice("Available models", field("model"), modelOptions, ready && !busy) { change("model", it) }
                VectraChoice("API format", field("format"), formats, ready && !busy) { change("format", it) }
                if (field("provider") == "pollinations") TextButton(onClick = onPollinations) { Text("Connect Pollinations") }
                val keyLabel = if (field("provider") == "pollinations") "Pollinations secret key" else "API key"
                VectraSettingsFields(listOf(SettingField("apiKey", keyLabel, true)), values, hints, displayedSecrets, ready && !busy, ::change)
                val savedChoices = slots.mapNotNull { slot ->
                    val id = slot.string("id") ?: return@mapNotNull null
                    id to listOfNotNull(slot.string("provider"), slot.string("model")?.takeIf { it.isNotBlank() }).joinToString(" · ")
                }.toMap()
                VectraChoice("Saved AI providers", snapshot().string("id").orEmpty(), savedChoices, ready && !busy) { id ->
                    val slot = slots.firstOrNull { it.string("id") == id } ?: return@VectraChoice
                    val provider = slot.string("provider").orEmpty()
                    chooseProvider(provider)
                    change("model", slot.string("model").orEmpty())
                    change("baseUrl", slot.string("baseUrl").orEmpty())
                    change("format", providerFormat(provider, slot.string("format")))
                }
                TextButton(enabled = ready && !busy, onClick = {
                    slots = currentSlots(snapshot())
                    chooseProvider("custom")
                }) { Text("Add another provider") }
                if (supercharge) {
                    Text("Image generation", style = MaterialTheme.typography.titleMedium)
                    VectraSettingsFields(imageFields, values, hints, displayedSecrets, ready && !busy, ::change)
                }
            }
            if (section == "Messaging") {
                Text("Chat channels", style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = allowAll, onCheckedChange = { allowAll = it }, enabled = ready && !busy)
                    Text("Allow all users")
                }
                VectraSettingsFields(integrationFields, values, hints, displayedSecrets, ready && !busy, ::change)
                Text("Telegram pairing", style = MaterialTheme.typography.titleMedium)
                val pairingList = (pairing?.get("pairing") as? JsonObject) ?: pairing
                val pending = pairingList?.objects("pending").orEmpty()
                if (pending.isEmpty()) Text("No pending codes.")
                pending.forEach { Text(listOfNotNull(it.string("code"), it.string("platform"), it.string("userId")).joinToString(" · ")) }
                pairingList?.objects("approved").orEmpty().forEach { Text("Approved · ${it.string("platform").orEmpty()} ${it.string("userId").orEmpty()}") }
                OutlinedTextField(pairCode, { pairCode = it }, Modifier.fillMaxWidth(), label = { Text("Approve code") }, singleLine = true)
                TextButton(enabled = !busy && pairCode.isNotBlank(), onClick = {
                    run("Approving pair code…") {
                        pairing = withContext(Dispatchers.IO) {
                            api.approvePairing(workspace.id, pairCode.trim())
                            api.pairing(workspace.id)
                        }
                        pairCode = ""
                        "Pairing updated."
                    }
                }) { Text("Approve") }
            }
            if (section == "Tools") {
                VectraGitHubSettings(api, workspace.id, failure)
                VectraManagedMcp(api, workspace, failure)
                HorizontalDivider()
            }
            if (section == "Maintenance") {
                optionsRow {
                    TextButton(enabled = !busy, onClick = { run("Waking sandbox…") { withContext(Dispatchers.IO) { api.wake(workspace.id) }; "Wake sent." } }) { Text("Wake") }
                    TextButton(enabled = !busy, onClick = { run("Restarting…") { withContext(Dispatchers.IO) { api.restartWorkspace(workspace.id) }; "Daemon restarted." } }) { Text("Restart") }
                    TextButton(enabled = !busy, onClick = { confirm = "destroy" }) { Text("Destroy", color = MaterialTheme.colorScheme.error) }
                }
                Text("CLI", style = MaterialTheme.typography.titleMedium)
                Text("Sandbox ${cli?.string("current") ?: "?"} · latest ${cli?.string("latest") ?: "?"}")
                OutlinedButton(enabled = !busy, onClick = {
                    run("Updating CLI and restarting…") {
                        cli = withContext(Dispatchers.IO) {
                            api.cliUpdate(workspace.id)
                            api.cliVersion(workspace.id)
                        }
                        "CLI update finished."
                    }
                }) { Text("Update CLI & restart") }
                OutlinedButton(enabled = !busy, onClick = { confirm = "move" }) { Text("Move to a new sandbox") }
                Text("Logs", style = MaterialTheme.typography.titleMedium)
                optionsRow {
                    listOf("all", "daemon", "agent", "system").forEach { source ->
                        TextButton(enabled = !busy, onClick = {
                            run("Pulling $source logs…") {
                                val data = withContext(Dispatchers.IO) { api.logs(workspace.id, source) }
                                logs = (data.string("text") ?: (data["logs"] as? JsonArray)?.joinToString("\n") { (it as? JsonPrimitive)?.contentOrNull.orEmpty() }).orEmpty()
                                null
                            }
                        }) { Text(source) }
                    }
                }
                TextButton(enabled = logs.isNotBlank(), onClick = {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Workspace logs", logs))
                }) { Text("Copy logs") }
                SelectionContainer { Text(vectraSafeStatus(logs.ifBlank { "Tap a source to pull logs." }), fontFamily = FontFamily.Monospace) }
                Text("Shell", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(cwd, { cwd = it }, Modifier.fillMaxWidth(), label = { Text("Working directory") }, singleLine = true)
                OutlinedTextField(command, { command = it }, Modifier.fillMaxWidth(), label = { Text("Command") }, singleLine = true)
                Button(enabled = !busy && command.isNotBlank(), onClick = {
                    run("Running command…") {
                        val entered = command.trim()
                        val result = withContext(Dispatchers.IO) { api.exec(workspace.id, entered, cwd.trim()) }
                        history = (listOf(entered to result) + history).take(4)
                        null
                    }
                }) { Text("Run") }
                history.forEach { (entered, result) ->
                    Text("$entered · exit ${result.number("exitCode") ?: "?"}")
                    SelectionContainer {
                        Text(vectraSafeStatus(listOfNotNull(result.string("stdout"), result.string("stderr")).filter(String::isNotEmpty).joinToString("\n")), fontFamily = FontFamily.Monospace)
                    }
                }
            }

        }
    }
    if (confirm == "move") VectraConfirm(
        "Move to a new sandbox?",
        "Chat, files, and settings move with the workspace. Preview links change and node_modules is skipped.",
        "Move",
        { confirm = "" },
    ) {
        confirm = ""
        run("Moving workspace…") { withContext(Dispatchers.IO) { api.recreateWorkspace(workspace.id) }; "Moved to a new sandbox." }
    }
    if (confirm == "destroy") VectraConfirm(
        "Destroy sandbox?", "This permanently deletes the sandbox and its files.", "Destroy", { confirm = "" },
    ) {
        confirm = ""
        run("Destroying sandbox…") {
            withContext(Dispatchers.IO) { api.deleteWorkspace(workspace.id) }
            onDestroyed()
            null
        }
    }
}

@Composable
private fun VectraSettingsFields(
    fields: List<SettingField>,
    values: Map<String, String>,
    hints: Map<String, String>,
    secrets: Map<String, String>,
    enabled: Boolean,
    onChange: (String, String) -> Unit,
) {
    fields.forEach { setting ->
        VectraSettingsField(setting, values[setting.key].orEmpty(), hints[setting.key].orEmpty(), secrets[setting.key].orEmpty(), enabled, onChange)
    }
}

@Composable
private fun VectraSettingsField(
    setting: SettingField,
    input: String,
    hint: String,
    stored: String,
    enabled: Boolean,
    onChange: (String, String) -> Unit,
) {
    val context = LocalContext.current
    var visible by remember(setting.key, stored) { mutableStateOf(false) }
    val copyable = input.ifBlank { stored }
    OutlinedTextField(
        input.ifBlank { if (setting.secret && visible) stored else "" },
        { onChange(setting.key, it) },
        enabled = enabled,
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(setting.label) },
        supportingText = if (setting.secret) ({
            Text(if (hint.isBlank()) "Leave blank to keep the saved value." else "$hint · Leave blank to keep it.")
        }) else null,
        trailingIcon = if (setting.secret) ({
            Row {
                if (copyable.isNotBlank()) TextButton(onClick = { copySettingSecret(context, setting.label, copyable) }) { Text("Copy") }
                TextButton(onClick = { visible = !visible }, enabled = enabled) { Text(if (visible) "Hide" else "Show") }
            }
        }) else null,
        keyboardOptions = if (setting.secret) KeyboardOptions(keyboardType = KeyboardType.Password) else KeyboardOptions.Default,
        visualTransformation = if (setting.secret && !visible) PasswordVisualTransformation() else VisualTransformation.None,
    )
}

private fun copySettingSecret(context: Context, label: String, value: String) {
    val clip = ClipData.newPlainText(label, value)
    clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
}

private fun slotId(provider: String, url: String): String {
    val parsed = url.toHttpUrlOrNull()
    val host = parsed?.host ?: return provider
    val domain = if (parsed.port == 80 || parsed.port == 443) host else "$host:${parsed.port}"
    return if (provider in setOf("auto", "custom")) "custom:$domain" else provider
}

@Composable
internal fun optionsRow(content: @Composable () -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { content() }
}

@Composable
internal fun VectraChoice(label: String, value: String, choices: Map<String, String>, enabled: Boolean = true, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(enabled = enabled && choices.isNotEmpty(), onClick = { expanded = true }) {
            Text("$label · ${choices[value] ?: value.ifBlank { "Select" }}")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { (key, name) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { expanded = false; onSelect(key) })
            }
        }
    }
}

@Composable
private fun VectraProviderPicker(value: String, enabled: Boolean, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val names = mapOf(
        "agentrouter" to "AgentRouter", "mistral" to "Mistral API Key", "nous" to "Nous Research (API key)",
        "kimi-coding" to "Kimi Coding", "kimi" to "Moonshot (Kimi Anthropic)",
        "free-ai" to "Free.ai", "zai" to "Z.AI / GLM", "lmstudio" to "LM Studio",
        "openai" to "OpenAI", "openrouter" to "OpenRouter", "grok" to "xAI (Grok)",
        "qwen" to "Qwen Cloud", "google" to "Google AI Studio", "custom" to "Custom",
    )
    OutlinedButton(onClick = { query = ""; open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
        Text("Provider · ${names[value] ?: value.replaceFirstChar { it.uppercase() }}")
    }
    if (open) AlertDialog(
        onDismissRequest = { open = false },
        title = { Text("Choose a provider") },
        text = {
            Column {
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search providers") }, singleLine = true)
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                    (defaults.keys + "custom").forEach { id ->
                        val name = names[id] ?: id.replaceFirstChar { it.uppercase() }
                        if (name.contains(query, true) || id.contains(query, true)) {
                            TextButton(onClick = { open = false; onSelect(id) }, modifier = Modifier.fillMaxWidth()) { Text(name, modifier = Modifier.fillMaxWidth()) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } },
    )
}
