package com.openmausbot.companion.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ListItem
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
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

private enum class MarketTab(val title: String) { Skills("Skills"), Installed("Installed"), Mcp("MCP servers") }

private data class MarketItem(val row: JsonObject, val skill: Boolean) {
    val id get() = row.string(if (skill) "pluginId" else "id").orEmpty()
    val owner get() = row.string("owner").orEmpty()
    val name get() = row.string("name").orEmpty().ifBlank { id }
    val description get() = row.string("description").orEmpty()
}

private fun parseSkill(row: JsonObject): MarketItem? {
    val owner = row.string("owner") ?: return null
    val name = row.string("name") ?: return null
    val valid = owner.matches(Regex("[A-Za-z0-9_.-]{1,80}")) && name.matches(Regex("[A-Za-z0-9_.-]{1,120}")) &&
        owner !in setOf(".", "..") && name !in setOf(".", "..")
    return if (valid && row.string("id") == "skillmd:$owner/$name" && row.string("pluginId")?.startsWith("skillmd-") == true) MarketItem(row, true) else null
}

private val approvedDigests = mapOf(
    "vectra-echo" to "e1288de348eab757a0c5f0dd4580a371d02850470abfc0466af067b672f9081a",
    "vectra-github" to "bef5d2b97bad049ea95e1a05170fc9a91fcabc1585b9b3c5896e86cc2a30b5e9",
)

@Composable
internal fun VectraMarketplace(
    api: VectraApi,
    workspaces: List<VectraWorkspace>,
    failure: (Throwable) -> String?,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val selectedDefault = workspaces.firstOrNull { it.runtime == "supercharge" } ?: workspaces.firstOrNull()
    var workspaceId by remember { mutableStateOf(selectedDefault?.id.orEmpty()) }
    val workspace = workspaces.firstOrNull { it.id == workspaceId }
    val supported = workspace?.runtime == "supercharge"
    var botId by remember(workspaceId) { mutableStateOf("") }
    var agents by remember(workspaceId) { mutableStateOf(emptyMap<String, String>()) }
    var status by remember(workspaceId, botId) { mutableStateOf<JsonObject?>(null) }
    var runtime by remember(workspaceId) { mutableStateOf<JsonObject?>(null) }
    var targetError by remember(workspaceId) { mutableStateOf<String?>(null) }
    var targetLoading by remember(workspaceId, botId) { mutableStateOf(false) }
    var busy by remember(workspaceId, botId) { mutableStateOf(false) }
    var notice by remember(workspaceId, botId) { mutableStateOf<String?>(null) }

    var tab by remember { mutableStateOf(MarketTab.Skills) }
    var selected by remember { mutableStateOf<MarketItem?>(null) }
    var search by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf("") }
    var skills by remember { mutableStateOf(emptyList<MarketItem>()) }
    var skillError by remember { mutableStateOf<String?>(null) }
    var skillLoading by remember { mutableStateOf(true) }
    var nextOffset by remember { mutableStateOf<Int?>(null) }
    var skillAttempt by remember { mutableStateOf(0) }
    var catalog by remember { mutableStateOf(emptyList<MarketItem>()) }
    var catalogQuery by remember { mutableStateOf("") }
    var catalogError by remember { mutableStateOf<String?>(null) }
    var catalogLoading by remember { mutableStateOf(true) }
    var catalogAttempt by remember { mutableStateOf(0) }
    val inventory = status?.obj("inventory")?.objects("plugins").orEmpty()
    val canAct = supported && botId.isNotBlank() && status != null && !targetLoading && !busy

    LaunchedEffect(selectedDefault?.id) {
        if (workspace == null) workspaceId = selectedDefault?.id.orEmpty()
    }

    suspend fun refreshVm() {
        if (!supported || botId.isBlank()) return
        targetError = null
        targetLoading = true
        try {
            val snapshot = withContext(Dispatchers.IO) {
                api.managedMcp(workspaceId, botId, buildJsonObject { put("action", "status") })
            }
            check(snapshot.obj("inventory")["plugins"] is JsonArray) { "Inventory is unavailable." }
            status = snapshot
        } catch (cause: Exception) {
            status = null
            targetError = failure(cause)?.let { "VM inventory unavailable. $it" }
        } finally { targetLoading = false }
    }
    suspend fun loadSkills(offset: Int = 0) {
        if (offset == 0) { skills = emptyList(); nextOffset = null }
        skillLoading = true
        skillError = null
        try {
            val query = submitted
            val data = withContext(Dispatchers.IO) { if (query.isBlank()) api.skillCatalog(offset) else api.searchSkills(query) }
            if (query != submitted) return
            skills = (skills + data.objects("items").mapNotNull(::parseSkill)).distinctBy { it.id }
            nextOffset = data.number("nextOffset")?.takeIf { it > offset && query.isBlank() }
        } catch (cause: Exception) { skillError = failure(cause) }
        finally { skillLoading = false }
    }
    fun action(payload: JsonObject, success: String, secret: Boolean = false, onSuccess: () -> Unit = {}) {
        if (!canAct) return
        busy = true
        notice = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { api.managedMcp(workspaceId, botId, payload) }
                refreshVm()
                notice = success
                onSuccess()
            } catch (cause: Exception) {
                if (secret) {
                    val details = failure(cause)
                    notice = details?.let { "Could not save the configuration. Refresh VM status before retrying." }
                } else notice = failure(cause)
            } finally { busy = false }
        }
    }

    LaunchedEffect(workspaceId, supported) {
        if (!supported) return@LaunchedEffect
        try {
            agents = withContext(Dispatchers.IO) { api.agents(workspaceId) }.associate { it.id to it.name }
            botId = agents.keys.firstOrNull().orEmpty()
        } catch (cause: Exception) { targetError = failure(cause) }
        try {
            runtime = withContext(Dispatchers.IO) { api.pluginRuntime(workspaceId) }
        } catch (cause: Exception) { failure(cause) }
    }
    LaunchedEffect(workspaceId, botId) { refreshVm() }
    val polling = status?.obj("bindings")?.values?.any { (it as? JsonObject)?.string("status") in setOf("waiting", "removing") } == true
    LaunchedEffect(workspaceId, botId, polling) {
        while (polling) {
            delay(3000)
            if (!busy) refreshVm()
        }
    }
    LaunchedEffect(submitted, skillAttempt) { loadSkills() }
    LaunchedEffect(catalogAttempt) {
        catalogLoading = true
        catalogError = null
        try {
            catalog = withContext(Dispatchers.IO) { api.managedMcpCatalog() }.objects("plugins").map { MarketItem(it, false) }.filter { it.id.isNotBlank() }
        } catch (cause: Exception) { catalogError = failure(cause) }
        finally { catalogLoading = false }
    }
    val targetContent: @Composable () -> Unit = {
        VectraChoice("Workspace", workspaceId, workspaces.associate { it.id to it.name }, !busy) { workspaceId = it }
        VectraChoice("Bot", botId, agents, supported && !busy) { botId = it }
        if (!supported) Text("Select a Supercharge workspace to install items.")
        if (targetLoading) Text("Loading VM inventory…")
        if (status != null && !targetLoading) Text("VM inventory ready", color = MaterialTheme.colorScheme.onSurfaceVariant)
        targetError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        optionsRow {
            TextButton(enabled = supported && !busy && !targetLoading, onClick = { scope.launch { refreshVm() } }) { Text("Refresh VM status") }
            if (supported && runtime?.flag("ready") == false && runtime?.flag("supported") != false) {
                TextButton(enabled = !busy && botId.isNotBlank(), onClick = {
                    busy = true
                    scope.launch {
                        try {
                            runtime = withContext(Dispatchers.IO) {
                                api.updatePluginRuntime(workspaceId, botId)
                                api.pluginRuntime(workspaceId)
                            }
                            refreshVm()
                            notice = "Plugin support updated in this VM."
                        } catch (cause: Exception) { notice = failure(cause) }
                        finally { busy = false }
                    }
                }) { Text("Update plugin support") }
            }
        }
        notice?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }

    val item = selected
    if (item != null) {
        VectraMarketplaceDetail(api, item, workspaceId, botId, status, inventory.firstOrNull { it.string("id") == item.id },
            canAct, failure, targetContent, { selected = null }, ::action)
        return
    }
    VectraPage("Marketplace", onBack) {
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Text("Skills for your agents", style = MaterialTheme.typography.headlineSmall)
                targetContent()
                optionsRow {
                    MarketTab.entries.forEach { section ->
                        FilterChip(selected = tab == section, onClick = { tab = section }, label = {
                            Text(section.title + if (section == MarketTab.Installed && inventory.isNotEmpty()) " · ${inventory.size}" else "")
                        })
                    }
                }
            }
            when (tab) {
                MarketTab.Skills -> {
                    item {
                        Text("Browse SkillMD", style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(search, { search = it }, Modifier.fillMaxWidth(), label = { Text("Search SkillMD skills") },
                            singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { submitted = search.trim(); skillAttempt++; focus.clearFocus() }),
                        )
                        optionsRow {
                            TextButton(onClick = { submitted = search.trim(); skillAttempt++; focus.clearFocus() }) { Text("Search skills") }
                            if (submitted.isNotBlank()) TextButton(onClick = { search = ""; submitted = "" }) { Text("Clear") }
                        }
                        if (skillLoading) Text("Loading SkillMD skills…")
                        skillError?.let { Text(it); TextButton(onClick = { skillAttempt++ }) { Text("Retry skills") } }
                        if (!skillLoading && skills.isEmpty() && skillError == null) Text("No skills match this search.")
                    }
                    items(skills, key = { it.id }) { result ->
                        MarketRow(result.name, listOfNotNull(result.owner.takeIf(String::isNotBlank), result.description.takeIf(String::isNotBlank)).joinToString(" · ")) {
                            selected = result
                        }
                    }
                    if (nextOffset != null) item {
                        OutlinedButton(enabled = !skillLoading, onClick = { nextOffset?.let { offset -> scope.launch { loadSkills(offset) } } }) {
                            Text("Load more skills")
                        }
                    }
                }
                MarketTab.Installed -> {
                    item { Text("Installed for this bot", style = MaterialTheme.typography.titleMedium) }
                    if (inventory.isEmpty()) item { Text(if (status == null) "Select a bot and refresh inventory." else "Nothing installed yet.") }
                    items(inventory, key = { it.string("id").orEmpty() }) { installed ->
                        val id = installed.string("id").orEmpty()
                        val name = installed.obj("manifest").string("name") ?: id
                        MarketRow(name, if (installed.flag("enabled") == true) "Enabled" else "Disabled") {
                            val full = if (id.startsWith("skillmd-") && '/' in name) {
                                parseSkill(buildJsonObject {
                                    put("id", "skillmd:$name"); put("pluginId", id)
                                    put("owner", name.substringBefore('/')); put("name", name.substringAfter('/'))
                                })
                            } else null
                            selected = full ?: catalog.firstOrNull { it.id == id } ?: MarketItem(installed, false)
                        }
                    }
                }
                MarketTab.Mcp -> {
                    item {
                        Text("Reviewed MCP servers", style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(catalogQuery, { catalogQuery = it }, Modifier.fillMaxWidth(), label = { Text("Search MCP servers") })
                        if (catalogLoading) Text("Loading reviewed servers…")
                        catalogError?.let { Text(it); TextButton(onClick = { catalogAttempt++ }) { Text("Retry catalog") } }
                    }
                    items(catalog.filter { "${it.name} ${it.description} ${it.row.string("publisher")}".contains(catalogQuery.trim(), true) }, key = { it.id }) {
                        MarketRow(it.name, it.description) { selected = it }
                    }
                }
            }
        }
    }
}

@Composable
private fun MarketRow(title: String, detail: String, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        ListItem(headlineContent = { Text(title) }, supportingContent = { Text(vectraSafeStatus(detail), maxLines = 3) })
    }
}

@Composable
private fun VectraMarketplaceDetail(
    api: VectraApi,
    item: MarketItem,
    workspace: String,
    bot: String,
    status: JsonObject?,
    installed: JsonObject?,
    ready: Boolean,
    failure: (Throwable) -> String?,
    target: @Composable () -> Unit,
    onBack: () -> Unit,
    action: (JsonObject, String, Boolean, () -> Unit) -> Unit,
) {
    val context = LocalContext.current
    var fetched by remember(item.id) { mutableStateOf<MarketItem?>(if (item.skill) null else item) }
    var error by remember(item.id) { mutableStateOf<String?>(null) }
    var attempt by remember(item.id) { mutableStateOf(0) }
    val revision = installed?.number("revision")
    var consent by remember(workspace, bot, item.id, revision) { mutableStateOf(false) }
    var remove by remember(workspace, bot, item.id) { mutableStateOf(false) }
    var inputs by remember(workspace, bot, item.id) { mutableStateOf(emptyMap<String, String>()) }
    val manifest = installed?.obj("manifest") ?: JsonObject(emptyMap())
    val permissions = manifest["permissions"] as? JsonArray
    val servers = manifest.obj("mcpServers").keys
    val schema = manifest.obj("userConfig")
    val configured = (installed?.get("configuredKeys") as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.content }.toSet()
    val missing = schema.any { (key, value) -> (value as? JsonObject)?.flag("required") == true && key !in configured }
    val trusted = installed?.flag("trusted") == true
    val enabled = installed?.flag("enabled") == true
    val reviewable = permissions != null && permissions.all { (it as? JsonPrimitive)?.isString == true } && revision != null
    val reviewDigest = approvedDigests[item.id]
    val reviewed = item.skill || installed == null || (reviewDigest != null && installed.string("activeDigest") == reviewDigest && manifest.string("version") == "1.0.0")
    val permittedSkill = !item.skill || permissions.orEmpty().isEmpty() && servers.isEmpty()
    val allowedOrigins = (status?.obj("service")?.get("allowedMcpOrigins") as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.content }
    val githubAllowed = item.id != "vectra-github" || "https://api.githubcopilot.com" in allowedOrigins
    val authentication = item.row.string("auth") ?: "unspecified"
    val supportedAuth = authentication in setOf("none", "unspecified") || authentication == "secrets" && schema.isNotEmpty()

    LaunchedEffect(item.id, attempt) {
        if (!item.skill) return@LaunchedEffect
        error = null
        try {
            val row = withContext(Dispatchers.IO) { api.skill(item.owner, item.name) }
            fetched = parseSkill(row)?.takeIf { it.id == item.id && it.owner == item.owner && it.name == item.name }
            if (fetched == null) error = "The skill details did not match the selected bundle."
        } catch (cause: Exception) { error = failure(cause) }
    }
    fun change(kind: String, success: String, extra: JsonObjectBuilder.() -> Unit = {}) {
        if (revision == null || !ready) return
        action(buildJsonObject {
            put("action", "pluginAction")
            put("pluginId", item.id)
            put("requestId", UUID.randomUUID().toString())
            put("pluginAction", buildJsonObject {
                put("action", kind)
                put("expectedRevision", revision)
                extra()
            })
        }, success, kind == "configure") {
            if (kind == "configure") inputs = emptyMap()
            if (kind == "trust") consent = false
        }
    }

    VectraPage(if (item.skill) "SkillMD skill" else "MCP server", onBack) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(item.name, style = MaterialTheme.typography.headlineSmall)
            val detail = fetched
            error?.let { Text(it); TextButton(onClick = { attempt++ }) { Text("Retry details") } }
            if (detail == null && error == null) Text("Loading skill details…")
            if (detail != null) {
                if (detail.owner.isNotBlank()) Text("${detail.owner} · SkillMD")
                Text(vectraSafeStatus(detail.description.ifBlank { "No description provided." }))
                if (item.skill) {
                    Text(if (detail.row.string("itemType") == "plugin") "Bundle with supporting files" else "Single skill")
                    Text("Included files", style = MaterialTheme.typography.titleMedium)
                    val files = detail.row.objects("files")
                    if (files.none { it.string("path").equals("SKILL.md", true) }) Text("SKILL.md")
                    files.forEach { file -> Text(vectraSafeStatus(file.string("path").orEmpty()) + if (file.flag("isScript") == true) " · script (not run on install)" else "") }
                    val source = detail.row.string("sourceUrl")?.toHttpUrlOrNull()?.takeIf { it.isHttps && it.host == "skillmd.com" }
                    TextButton(enabled = source != null, onClick = { source?.let { error = openVectraUrl(context, it.toString()) } }) { Text("Read on SkillMD") }
                }
            }
            target()
            if (!reviewed || !permittedSkill) Text("The installed bundle does not match the reviewed release or permissions.", color = MaterialTheme.colorScheme.error)
            if (installed == null) {
                val source = item.row.obj("source")
                val digest = source.string("sha256")?.takeIf { source.string("type") == "archive" && it.matches(Regex("[a-fA-F0-9]{64}")) }
                if (digest != null) SelectionContainer { Text("Archive SHA-256 · $digest") }
                val targets = (item.row["targets"] as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.content }
                val installable = if (item.skill) detail?.row?.flag("installable") == true else digest != null &&
                    (targets.isEmpty() || "supercharge-e2b" in targets) && authentication != "oauth" && githubAllowed
                if (!installable && detail != null) Text("This item has no supported installable bundle for this VM.")
                Button(enabled = ready && installable, onClick = {
                    val payload = buildJsonObject {
                        if (item.skill) {
                            put("action", "installSkillMd"); put("owner", item.owner); put("name", item.name)
                        } else {
                            put("action", "installCatalog"); put("catalogId", item.id); put("catalogSha256", digest)
                        }
                        put("requestId", UUID.randomUUID().toString())
                    }
                    action(payload, "Installed disabled. Review permissions before enabling.", false) {}
                }) { Text(if (item.skill) "Install skill bundle" else "Install in selected bot VM") }
            } else {
                Text("Installed · ${if (trusted) "approved" else "untrusted"} · ${if (enabled) "enabled" else "disabled"}")
                permissions?.let { rows -> Text("Permissions: ${rows.joinToString(", ") { (it as? JsonPrimitive)?.content.orEmpty() }.ifBlank { "none" }}") }
                if (!item.skill && schema.isNotEmpty()) {
                    Text("Configuration values are write-only.")
                    schema.keys.forEach { name ->
                        OutlinedTextField(inputs[name].orEmpty(), { inputs = inputs + (name to it) }, Modifier.fillMaxWidth(), label = { Text(name) },
                            enabled = ready && reviewed, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        )
                    }
                    TextButton(enabled = ready && reviewed && inputs.values.any(String::isNotBlank), onClick = {
                        change("configure", "Configuration saved in the VM.") {
                            put("values", buildJsonObject { inputs.filterValues(String::isNotBlank).forEach { (key, value) -> put(key, value) } })
                        }
                    }) { Text("Save configuration") }
                }
                if (!trusted) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(consent, { consent = it }, enabled = ready && reviewable && reviewed && permittedSkill)
                        Text(if (item.skill) "I reviewed this community bundle and approve its instructions." else "I reviewed these exact permissions.")
                    }
                    OutlinedButton(enabled = ready && consent && reviewable && reviewed && permittedSkill, onClick = {
                        change("trust", "Permissions approved.") { put("permissions", permissions ?: JsonArray(emptyList())) }
                    }) { Text("Approve") }
                }
                optionsRow {
                    if (!enabled) Button(enabled = ready && reviewable && reviewed && permittedSkill && trusted && !missing && (item.skill || supportedAuth && githubAllowed),
                        onClick = { change("enable", "Enabled in this VM.") }) { Text("Enable") }
                    if (enabled) OutlinedButton(enabled = ready && reviewable, onClick = { change("disable", "Disabled in this VM.") }) { Text("Disable") }
                    if (item.skill && !enabled) TextButton(enabled = ready && reviewable, onClick = { remove = true }) { Text("Uninstall…") }
                }
                if (!item.skill && servers.isNotEmpty()) {
                    VectraMarketplaceBinding(api, workspace, bot, item.id, status, servers, ready, enabled && trusted && reviewed && supportedAuth && githubAllowed,
                        reviewed, failure, action)
                }
            }
        }
    }
    if (remove) VectraConfirm("Uninstall ${item.name}?", "This removes the skill from the selected bot.", "Confirm uninstall", { remove = false }) {
        remove = false
        change("uninstall", "Skill uninstalled.")
    }
}

@Composable
private fun VectraMarketplaceBinding(
    api: VectraApi,
    workspace: String,
    bot: String,
    plugin: String,
    status: JsonObject?,
    servers: Set<String>,
    ready: Boolean,
    attachAllowed: Boolean,
    reviewed: Boolean,
    failure: (Throwable) -> String?,
    action: (JsonObject, String, Boolean, () -> Unit) -> Unit,
) {
    var threads by remember(workspace, bot) { mutableStateOf(emptyMap<String, String>()) }
    var session by remember(workspace, bot) { mutableStateOf("") }
    var server by remember(plugin) { mutableStateOf(servers.firstOrNull().orEmpty()) }
    var reload by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    val binding = status?.obj("bindings")?.obj(session) ?: JsonObject(emptyMap())
    val matches = binding.string("pluginId") == plugin
    val state = binding.string("status")
    val revision = binding.number("revision")
    val echo = binding.objects("tools").firstOrNull { it.string("description")?.startsWith("vectra-echo/echo/echo:") == true }?.string("name")
    var verify by remember(workspace, bot, session, revision, echo) { mutableStateOf(false) }
    LaunchedEffect(workspace, bot, reload) {
        if (workspace.isBlank() || bot.isBlank()) return@LaunchedEffect
        try {
            threads = withContext(Dispatchers.IO) { api.conversations(workspace, bot) }.objects("conversations").mapNotNull {
                val id = it.string("sessionId")
                if (id == null || it.string("source") == "group" || it.string("botId") != bot) null else id to (it.string("title") ?: id)
            }.toMap()
        } catch (cause: Exception) { error = failure(cause) }
    }
    fun mutate(kind: String) {
        action(buildJsonObject {
            put("action", kind)
            put("sessionId", session)
            put("expectedRevision", revision?.let(::JsonPrimitive) ?: JsonNull)
            if (kind == "apply") { put("pluginId", plugin); put("serverId", server) }
            if (kind == "verify") {
                put("tool", echo)
                put("arguments", buildJsonObject { put("text", "managed MCP check") })
                put("consent", true)
            }
        }, "Conversation bridge change requested.", false) { verify = false }
    }
    Text("Attach to a conversation", style = MaterialTheme.typography.titleMedium)
    VectraChoice("Server", server, servers.associateWith { it }, ready) { server = it }
    VectraChoice("Conversation", session, threads, ready) { session = it }
    TextButton(onClick = { reload++ }) { Text("Refresh conversations") }
    error?.let { Text(it) }
    if (binding.isNotEmpty()) Text(if (matches) "Conversation bridge: $state" else "A different plugin already has this conversation.")
    Button(enabled = ready && attachAllowed && session in threads && server in servers && (binding.isEmpty() || state == "removed" || binding.flag("configured") == false),
        onClick = { mutate("apply") }) { Text("Attach to conversation") }
    if (matches && revision != null) optionsRow {
        if (state == "failed") TextButton(enabled = ready && reviewed, onClick = { mutate("retry") }) { Text("Retry attachment") }
        if (state !in setOf("waiting", "removing", "removed")) TextButton(enabled = ready, onClick = { mutate("remove") }) { Text("Remove bridge") }
    }
    if (matches && state == "applied" && plugin == "vectra-echo" && binding.string("serverId") == "echo" && reviewed && echo != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(verify, { verify = it }, enabled = ready)
            Text("I consent to this one Echo verification call")
        }
        OutlinedButton(enabled = ready && verify, onClick = { mutate("verify") }) { Text("Verify Echo connection") }
    }
    if (matches && state == "ready") Text("Verified by the VM for this conversation.")
}
