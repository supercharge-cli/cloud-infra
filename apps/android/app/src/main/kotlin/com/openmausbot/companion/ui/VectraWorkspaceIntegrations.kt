package com.openmausbot.companion.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraWorkspace
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.number
import com.openmausbot.companion.core.obj
import com.openmausbot.companion.core.objects
import com.openmausbot.companion.core.string
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
internal fun VectraGitHubSettings(
    api: VectraApi,
    id: String,
    failure: (Throwable) -> String?,
    conversationId: String? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var auth by remember(id) { mutableStateOf<JsonObject?>(null) }
    var busy by remember(id) { mutableStateOf(false) }
    var error by remember(id) { mutableStateOf<String?>(null) }
    var confirmSource by remember(id, conversationId) { mutableStateOf<String?>(null) }
    var revealed by remember(id, conversationId) { mutableStateOf<String?>(null) }
    val state = auth?.string("status") ?: "idle"
    val pending = state in setOf("pending", "starting")
    fun request(action: String) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                auth = withContext(Dispatchers.IO) {
                    when (action) {
                        "start" -> api.githubStart(id, UUID.randomUUID().toString().replace("-", ""), conversationId)
                        "done" -> api.githubDone(id)
                        "cancel" -> api.githubCancel(id)
                        else -> api.githubStatus(id)
                    }
                }
            } catch (cause: Exception) {
                error = failure(cause)
            } finally {
                busy = false
            }
        }
    }
    LaunchedEffect(id) { request("status") }
    LaunchedEffect(id, pending) {
        while (pending) {
            delay(3000)
            request("status")
        }
    }
    HorizontalDivider()
    Text("GitHub CLI", style = MaterialTheme.typography.titleMedium)
    Text(
        when (state) {
            "delivered", "connected" -> auth?.string("username")?.let { "Connected as $it." } ?: "Connected."
            "starting" -> "Waiting for a device code…"
            "pending" -> "Enter the code on GitHub, then verify."
            "verified" -> "Verified. Finish connecting to the sandbox."
            "idle" -> "Connect GitHub CLI for this sandbox."
            else -> state.replace('_', ' ').replaceFirstChar { it.uppercase() }
        },
    )
    auth?.string("code")?.takeIf { state == "pending" && it.isNotBlank() }?.let { code ->
        SelectionContainer { Text(code, style = MaterialTheme.typography.titleLarge) }
        OutlinedButton(onClick = { error = openVectraUrl(context, "https://github.com/login/device") }) { Text("Open GitHub device login") }
    }
    optionsRow {
        when {
            pending || state == "verified" -> {
                TextButton(enabled = !busy && state != "starting", onClick = { request("done") }) { Text("Verify GitHub login") }
                TextButton(enabled = !busy, onClick = { request("cancel") }) { Text("Cancel GitHub login") }
            }
            else -> TextButton(enabled = !busy, onClick = { request("start") }) {
                Text(if (state in setOf("delivered", "connected")) "Start a new GitHub login" else "Connect GitHub CLI")
            }
        }
        TextButton(enabled = !busy, onClick = { request("status") }) { Text("Refresh GitHub status") }
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    if (!conversationId.isNullOrBlank()) {
        TextButton(enabled = !busy, onClick = { confirmSource = "cli" }) { Text("Show my GitHub CLI token in chat") }
        TextButton(enabled = !busy, onClick = { confirmSource = "mcp" }) { Text("Show my GitHub MCP token in chat") }
        revealed?.let { token ->
            Text("Sensitive credential · saved in this private GitHub conversation")
            SelectionContainer { Text(token) }
            TextButton(onClick = { revealed = null }) { Text("Hide token on this device") }
        }
        confirmSource?.let { source ->
            VectraConfirm(
                "Send GitHub ${source.uppercase()} token to this chat?",
                "The token grants account access. It will be saved in this direct conversation and may be included in exports.",
                "Send token to this chat",
                { confirmSource = null },
            ) {
                confirmSource = null
                busy = true
                scope.launch {
                    try {
                        revealed = withContext(Dispatchers.IO) {
                            api.githubToken(id, conversationId, source, UUID.randomUUID().toString().replace("-", ""))
                        }
                    } catch (cause: Exception) {
                        error = failure(cause)
                    } finally { busy = false }
                }
            }
        }
    }
}

@Composable
internal fun VectraManagedMcp(api: VectraApi, workspace: VectraWorkspace, failure: (Throwable) -> String?) {
    HorizontalDivider()
    Text("Managed MCP", style = MaterialTheme.typography.titleMedium)
    if (workspace.runtime != "supercharge") {
        Text("Managed MCP is available on Supercharge sandboxes.")
        return
    }
    val id = workspace.id
    val scope = rememberCoroutineScope()
    var bots by remember(id) { mutableStateOf(mapOf("main" to "Main")) }
    var bot by remember(id) { mutableStateOf("main") }
    var catalog by remember(id) { mutableStateOf(emptyList<JsonObject>()) }
    var catalogId by remember(id) { mutableStateOf("") }
    var current by remember(id, bot) { mutableStateOf<JsonObject?>(null) }
    var plugins by remember(id, bot) { mutableStateOf(emptyList<JsonObject>()) }
    var conversations by remember(id, bot) { mutableStateOf(emptyList<JsonObject>()) }
    var selected by remember(id, bot) { mutableStateOf("") }
    var server by remember(id, bot, selected) { mutableStateOf("") }
    var session by remember(id, bot) { mutableStateOf("") }
    var config by remember(id, bot, selected) { mutableStateOf("") }
    var approval by remember(id, bot, selected) { mutableStateOf(false) }
    var busy by remember(id, bot) { mutableStateOf(false) }
    var notice by remember(id, bot) { mutableStateOf<String?>(null) }
    val installed = plugins.firstOrNull { it.string("id") == selected }
    val manifest = installed?.obj("manifest") ?: JsonObject(emptyMap())
    val declaredConfig = manifest.obj("userConfig")
    val servers = manifest.obj("mcpServers").keys
    val activeServer = server.takeIf { it in servers } ?: servers.firstOrNull()
    val binding = current?.obj("bindings")?.obj(session)
    val bindingState = binding?.string("status") ?: "not configured"
    val revision = binding?.number("revision")

    suspend fun fetchStatus() {
        val output = withContext(Dispatchers.IO) { api.managedMcp(id, bot, buildJsonObject { put("action", "status") }) }
        current = output
        plugins = output.obj("inventory").objects("plugins")
        if (plugins.none { it.string("id") == selected }) selected = plugins.firstOrNull()?.string("id").orEmpty()
    }

    suspend fun fetchConversations() {
        conversations = withContext(Dispatchers.IO) { api.conversations(id, bot) }.objects("conversations")
            .filter { it.string("botId") == bot && it.string("source") != "group" }
    }

    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        notice = null
        scope.launch {
            try {
                action()
            } catch (cause: Exception) {
                notice = failure(cause)
            } finally {
                busy = false
            }
        }
    }

    fun perform(action: String, fields: JsonObjectBuilder.() -> Unit = {}) = run {
        val payload = buildJsonObject { put("action", action); fields() }
        withContext(Dispatchers.IO) { api.managedMcp(id, bot, payload) }
        fetchStatus()
        if (action == "installCatalog") notice = "Installed disabled. Review permissions before enabling."
        if (action == "apply") notice = "Binding requested."
    }

    fun pluginAction(action: String, fields: JsonObjectBuilder.() -> Unit = {}) {
        val plugin = installed ?: return
        val expected = plugin.number("revision") ?: return
        perform("pluginAction") {
            put("pluginId", selected)
            put("requestId", UUID.randomUUID().toString())
            put("pluginAction", buildJsonObject {
                put("action", action)
                put("expectedRevision", expected)
                fields()
            })
        }
    }

    LaunchedEffect(id) {
        try {
            val loaded = withContext(Dispatchers.IO) { api.agents(id) }
            if (loaded.isNotEmpty()) {
                bots = loaded.associate { it.id to it.name }
                if (bot !in bots) bot = bots.keys.first()
            }
            catalog = withContext(Dispatchers.IO) { api.managedMcpCatalog() }.objects("plugins")
            catalogId = catalog.firstOrNull()?.string("id").orEmpty()
        } catch (cause: Exception) {
            notice = failure(cause)
        }
    }
    LaunchedEffect(id, bot) {
        fetchQuietly(failure, { notice = it }) { fetchStatus() }
        fetchQuietly(failure, { notice = it }) { fetchConversations() }
    }
    LaunchedEffect(id, bot, session, bindingState) {
        while (bindingState in setOf("waiting", "removing")) {
            delay(2000)
            if (!busy) fetchQuietly(failure, { notice = it }) { fetchStatus() }
        }
    }
    VectraChoice("Bot", bot, bots, !busy) { bot = it }
    Text("Conversation state: $bindingState")
    (notice ?: binding?.string("lastError"))?.let { Text(vectraSafeStatus(it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
    TextButton(enabled = !busy, onClick = { run { fetchStatus() } }) { Text("Refresh status") }
    Text("Shared reviewed catalog")
    VectraChoice("Catalog plugin", catalogId, catalog.associate { it.string("id").orEmpty() to (it.string("name") ?: it.string("id").orEmpty()) }, !busy) {
        catalogId = it
        if (plugins.any { plugin -> plugin.string("id") == it }) selected = it
    }
    catalog.firstOrNull { it.string("id") == catalogId }?.let { entry ->
        val hash = entry.obj("source").string("sha256")
        val already = plugins.any { it.string("id") == catalogId }
        entry.string("description")?.let { Text(it) }
        hash?.let { Text("Pinned archive · SHA-256 ${it.take(16)}") }
        Button(enabled = !busy && hash != null && !already, onClick = {
            perform("installCatalog") {
                put("catalogId", catalogId)
                put("catalogSha256", hash)
                put("requestId", UUID.randomUUID().toString())
            }
        }) { Text(if (already) "Installed; review permissions below" else "Connect: install in this VM") }
    }
    val choices = plugins.associate { it.string("id").orEmpty() to (it.obj("manifest").string("name") ?: it.string("id").orEmpty()) }
    VectraChoice("Reviewed plugin", selected, choices, !busy) { selected = it }
    if (installed != null) {
        val permissions = manifest["permissions"] as? JsonArray ?: JsonArray(emptyList())
        val trusted = installed.flag("trusted") == true
        val enabled = installed.flag("enabled") == true
        Text("Permissions: ${permissions.joinToString(", ") { (it as? JsonPrimitive)?.content.orEmpty() }.ifBlank { "none" }}")
        Text("${if (trusted) "Trusted" else "Needs approval"} · ${if (enabled) "Enabled" else "Disabled"}")
        if (declaredConfig.isNotEmpty()) {
            Text("Write-only fields: ${declaredConfig.keys.joinToString(", ")}")
            OutlinedTextField(
                config, { config = it }, Modifier.fillMaxWidth(), label = { Text("Configuration values (JSON object)") },
                visualTransformation = PasswordVisualTransformation(),
            )
            TextButton(enabled = !busy && config.isNotBlank(), onClick = {
                val obj = runCatching { Json.parseToJsonElement(config) as? JsonObject }.getOrNull()
                if (obj == null || obj.any { (key, value) -> key !in declaredConfig || (value as? JsonPrimitive)?.isString != true }) {
                    notice = "Use only the declared string fields."
                } else {
                    pluginAction("configure") { put("values", obj) }
                    config = ""
                }
            }) { Text("Save write-only configuration") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(approval, { approval = it }, enabled = !busy)
            Text("I reviewed these exact permissions")
        }
        optionsRow {
            OutlinedButton(enabled = !busy && !trusted && approval, onClick = { pluginAction("trust") { put("permissions", permissions) } }) { Text("Approve permissions") }
            Button(enabled = !busy && trusted && !enabled, onClick = { pluginAction("enable") }) { Text("Enable in VM") }
        }
        VectraChoice("MCP server", activeServer.orEmpty(), servers.associateWith { it }, !busy) { server = it }
    }
    val threads = conversations.mapNotNull { row -> row.string("sessionId")?.let { it to (row.string("title") ?: it) } }.toMap()
    VectraChoice("Existing conversation", session, threads, !busy) { session = it }
    TextButton(enabled = !busy, onClick = { run { fetchConversations() } }) { Text("Refresh conversations") }
    optionsRow {
        Button(enabled = !busy && session.isNotBlank() && installed?.flag("trusted") == true && installed.flag("enabled") == true && activeServer != null, onClick = {
            perform("apply") {
                put("sessionId", session)
                put("pluginId", selected)
                put("serverId", activeServer)
                put("expectedRevision", revision?.let(::JsonPrimitive) ?: JsonNull)
            }
        }) { Text("Apply to conversation") }
        OutlinedButton(enabled = !busy && session.isNotBlank() && revision != null && bindingState == "failed", onClick = {
            perform("retry") { put("sessionId", session); put("expectedRevision", revision) }
        }) { Text("Retry") }
        OutlinedButton(enabled = !busy && session.isNotBlank() && revision != null, onClick = {
            perform("remove") { put("sessionId", session); put("expectedRevision", revision) }
        }) { Text("Remove") }
    }
}

private suspend fun fetchQuietly(failure: (Throwable) -> String?, onError: (String?) -> Unit, action: suspend () -> Unit) {
    try {
        action()
    } catch (cause: Exception) {
        onError(failure(cause))
    }
}
