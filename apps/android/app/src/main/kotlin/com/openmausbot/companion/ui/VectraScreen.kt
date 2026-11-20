package com.openmausbot.companion.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.VectraAgent
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraHttpException
import com.openmausbot.companion.core.VectraMessage
import com.openmausbot.companion.core.VectraWorkspace
import com.openmausbot.companion.core.VECTRA_API_ORIGIN
import com.openmausbot.companion.core.visibleVectraEvent
import java.io.BufferedReader
import java.io.InputStreamReader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@Composable
fun VectraScreen() {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("vectra", Context.MODE_PRIVATE) }
    val api = remember {
        VectraApi(
            origin = prefs.getString("origin", VECTRA_API_ORIGIN) ?: VECTRA_API_ORIGIN,
            token = prefs.getString("token", null).orEmpty(),
        )
    }
    val http = remember {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
    var email by remember { mutableStateOf(prefs.getString("email", "").orEmpty()) }
    var signedIn by remember { mutableStateOf(api.token.isNotBlank()) }
    var loadingBots by remember { mutableStateOf(signedIn) }
    var rosterError by remember { mutableStateOf<String?>(null) }
    var signInBusy by remember { mutableStateOf(false) }
    var workspaces by remember { mutableStateOf(emptyList<VectraWorkspace>()) }
    var workspaceId by remember { mutableStateOf("") }
    var agents by remember { mutableStateOf(emptyList<VectraAgent>()) }
    var agentId by remember { mutableStateOf("") }
    var chatId by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf("") }
    var messages by remember { mutableStateOf(emptyList<VectraMessage>()) }
    var error by remember { mutableStateOf<String?>(null) }
    var pane by remember { mutableStateOf("Chat") }
    var running by remember { mutableStateOf(false) }
    var workLabel by remember { mutableStateOf("") }
    var liveStatus by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var chatQuery by remember { mutableStateOf("") }
    var finding by remember { mutableStateOf(false) }
    var files by remember { mutableStateOf(emptyList<String>()) }
    var computer by remember { mutableStateOf("") }
    var preview by remember { mutableStateOf("") }
    var account by remember { mutableStateOf("") }
    var plans by remember { mutableStateOf(emptyList<String>()) }
    var group by remember { mutableStateOf("") }
    var command by remember { mutableStateOf("") }
    var terminal by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf("openai") }
    var model by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var eventsJob by remember { mutableStateOf<Job?>(null) }
    var bots by remember { mutableStateOf(emptyList<VectraBot>()) }
    var inChat by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }

    fun forgetSession() {
        eventsJob?.cancel()
        api.signOut()
        prefs.edit().remove("token").remove("origin").apply()
        signedIn = false
        inChat = false
        bots = emptyList()
        query = ""
        rosterError = null
        error = null
    }

    fun failureMessage(cause: Throwable): String? {
        if (cause is CancellationException) throw cause
        if (cause is VectraHttpException && cause.authenticated && cause.status == 401) {
            forgetSession()
            error = "Your session expired. Sign in again."
            return null
        }
        val message = (cause as? VectraHttpException)?.message
        return message?.takeUnless { it.contains("timeout", true) || it.contains("timed out", true) }
            ?: "Could not reach Vectra. Check your connection and try again."
    }

    suspend fun collectBots(listed: List<VectraWorkspace>): List<VectraBot> = withContext(Dispatchers.IO) {
        val marks = listOf(0xFF3D5AFE, 0xFF7C4DFF, 0xFF00B8D4, 0xFFFF6D00, 0xFF00C853, 0xFFD500F9, 0xFF2979FF, 0xFFFF4081).map { it.toInt() }
        var index = 0
        listed.flatMap { workspace ->
            api.agents(workspace.id).map { agent ->
                val n = index++
                VectraBot(workspace.id, agent.id, agent.name, "bot", "", marks[n % marks.size].toInt())
            }
        }
    }

    fun openAgent(nextWorkspace: String, nextAgent: String) {
        eventsJob?.cancel()
        eventsJob = scope.launch {
            try {
                val conversation = withContext(Dispatchers.IO) { api.conversation(nextWorkspace, nextAgent) }
                workspaceId = nextWorkspace
                agentId = nextAgent
                chatId = conversation
                messages = emptyList()
                running = false
                workLabel = ""
                error = null
                val request = withContext(Dispatchers.IO) { api.openEvents(nextWorkspace, nextAgent, conversation) }
                withContext(Dispatchers.IO) {
                    http.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) {
                            throw VectraHttpException(
                                response.code,
                                request.header("Authorization") != null,
                                "Chat stream could not connect.",
                            )
                        }
                        val reader = BufferedReader(InputStreamReader(response.body?.byteStream() ?: return@withContext))
                        val block = StringBuilder()
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) {
                                val parsed = runCatching {
                                    val data = block.lines().filter { it.startsWith("data:") }
                                        .joinToString("\n") { it.removePrefix("data:").trim() }
                                    if (data.isBlank()) null else Json.parseToJsonElement(data).jsonObject
                                }.getOrNull()
                                block.clear()
                                val kind = parsed?.get("type")?.toString()?.trim('"')
                                val note = parsed?.get("text")?.toString()?.trim('"').orEmpty()
                                if (kind == "progress" || kind == "thinking" || kind == "status" || kind == "tool") {
                                    if (note.isNotBlank() && note != "ready") {
                                        withContext(Dispatchers.Main) {
                                            running = true
                                            liveStatus = true
                                            workLabel = note
                                        }
                                    }
                                }
                                if (kind == "usage" || kind == "done" || kind == "result") {
                                    withContext(Dispatchers.Main) {
                                        running = false
                                        liveStatus = false
                                        workLabel = ""
                                    }
                                }
                                val visible = parsed?.let(::visibleVectraEvent) ?: continue
                                withContext(Dispatchers.Main) {
                                    val last = messages.lastOrNull()
                                    val sameTurn = visible.role == "agent" && last?.role == "agent" && (
                                        (visible.id.isNotEmpty() && visible.id == last.id) ||
                                            visible.text.startsWith(last.text)
                                        )
                                    messages = if (sameTurn) messages.dropLast(1) + visible else messages + visible
                                }
                            } else {
                                block.append(line).append('\n')
                            }
                        }
                    }
                }
            } catch (cause: Exception) {
                failureMessage(cause)?.let { error = it }
            }
        }
    }

    fun enter(listed: List<VectraWorkspace>, rows: List<VectraBot>) {
        workspaces = listed
        bots = rows
        agents = rows.map { VectraAgent(it.agentId, it.name) }
        inChat = false
        error = null
    }

    fun openBot(bot: VectraBot) {
        inChat = true
        pane = "Chat"
        openAgent(bot.workspaceId, bot.agentId)
    }

    suspend fun loadBots() {
        val token = api.token
        loadingBots = true
        rosterError = null
        try {
            val listed = withContext(Dispatchers.IO) { api.workspaces() }
            val rows = collectBots(listed)
            if (api.token == token) enter(listed, rows)
        } catch (cause: Exception) {
            if (cause is CancellationException) throw cause
            if (api.token == token) rosterError = failureMessage(cause)
        } finally {
            if (api.token == token) loadingBots = false
        }
    }

    LaunchedEffect(signedIn) {
        if (signedIn) loadBots()
    }

    LaunchedEffect(running, liveStatus) {
        val lines = listOf(
            "Thinking",
            "Reading the workspace",
            "Putting it together",
            "Checking the files",
            "Looking at the screen",
            "Working",
        )
        var index = 0
        while (running && !liveStatus) {
            workLabel = lines[index % lines.size]
            index += 1
            kotlinx.coroutines.delay(1400)
        }
    }

    fun openTool(name: String) {
        pane = name
        menuOpen = false
        scope.launch {
            try {
                when (name) {
                    "Files" -> files = withContext(Dispatchers.IO) { api.files(workspaceId) }
                    "Computer" -> computer = withContext(Dispatchers.IO) { api.computer(workspaceId, agentId) }
                    "Preview" -> preview = withContext(Dispatchers.IO) { api.preview(workspaceId) }
                    "Terminal" -> Unit
                }
                error = null
            } catch (cause: Exception) {
                failureMessage(cause)?.let { error = it }
            }
        }
    }

    if (!signedIn) {
        CompanionTheme(darkTheme = true) {
            VectraSignIn(
                email = email,
                onEmail = { email = it },
                busy = signInBusy,
                error = error,
                onError = { error = it },
                onSubmit = submit@{ login, password, origin, register ->
                    if (signInBusy) return@submit
                    signInBusy = true
                    error = null
                    scope.launch {
                        try {
                            api.origin = origin
                            val token = withContext(Dispatchers.IO) { api.login(login, password, register) }
                            prefs.edit().putString("token", token).putString("origin", origin)
                                .putString("email", email.trim()).apply()
                            loadingBots = true
                            signedIn = true
                        } catch (cause: Exception) {
                            error = failureMessage(cause)
                        } finally {
                            signInBusy = false
                        }
                    }
                },
            )
        }
        return
    }

    if (!inChat) {
        VectraRoster(
            bots = bots,
            query = query,
            onQuery = { query = it },
            onOpen = ::openBot,
            onSignOut = { forgetSession() },
            loading = loadingBots,
            error = rosterError,
            onRetry = { scope.launch { if (signedIn && !loadingBots) loadBots() } },
        )
        return
    }

    val agentName = bots.firstOrNull { it.agentId == agentId }?.name
        ?: agents.firstOrNull { it.id == agentId }?.name
        ?: "Vectra"
    val agentColor = bots.firstOrNull { it.agentId == agentId }?.color ?: "pink"
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(40.dp).clip(CircleShape).background(Color(0xFF2A2A31)).clickable {
                    eventsJob?.cancel()
                    inChat = false
                },
                contentAlignment = Alignment.Center,
            ) { Icon(VectraIcons.ArrowLeft, contentDescription = "Back", tint = Color.White) }
            Row(
                Modifier
                    .padding(horizontal = 10.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color(0xFF2A2A31))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val mark = bots.firstOrNull { it.agentId == agentId }?.mark ?: 0xFF3D5AFE.toInt()
                Box(Modifier.size(22.dp).clip(RoundedCornerShape(7.dp)).background(Color(mark)), contentAlignment = Alignment.Center) {
                    Text(agentName.take(1).uppercase(), color = Color.White, style = MaterialTheme.typography.labelSmall)
                }
                Text(agentName, color = Color.White, modifier = Modifier.padding(start = 8.dp), maxLines = 1, fontWeight = FontWeight.SemiBold)
            }
            Box(Modifier.weight(1f))
            Box {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(Color(0xFF2A2A31)).clickable { menuOpen = true },
                    contentAlignment = Alignment.Center,
                ) { Icon(VectraIcons.Ellipsis, contentDescription = "More", tint = Color.White) }
                DropdownMenu(
                    expanded = menuOpen,
                    onDismissRequest = { menuOpen = false },
                    containerColor = Color(0xFF2A2A31),
                ) {
                    DropdownMenuItem(text = { Text("Files", color = Color.White) }, onClick = { openTool("Files") }, leadingIcon = { Icon(VectraIcons.Search, contentDescription = null, tint = Color(0xFFB7B7C2)) })
                    DropdownMenuItem(text = { Text("Computer", color = Color.White) }, onClick = { openTool("Computer") }, leadingIcon = { Icon(VectraIcons.Square, contentDescription = null, tint = Color(0xFFB7B7C2)) })
                    DropdownMenuItem(text = { Text("Preview", color = Color.White) }, onClick = { openTool("Preview") }, leadingIcon = { Icon(VectraIcons.Search, contentDescription = null, tint = Color(0xFFB7B7C2)) })
                    DropdownMenuItem(text = { Text("Terminal", color = Color.White) }, onClick = { openTool("Terminal") }, leadingIcon = { Icon(VectraIcons.Plus, contentDescription = null, tint = Color(0xFFB7B7C2)) })
                    DropdownMenuItem(text = { Text("Search in chat", color = Color.White) }, onClick = { menuOpen = false; finding = true }, leadingIcon = { Icon(VectraIcons.Search, contentDescription = null, tint = Color(0xFFB7B7C2)) })
                }
            }
        }
        if (pane != "Chat") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(pane, color = Color.White, modifier = Modifier.weight(1f).padding(start = 8.dp), fontWeight = FontWeight.SemiBold)
                TextButton(onClick = { pane = "Chat" }) { Text("Close", color = Color.White) }
            }
        }
        if (finding && pane == "Chat") {
            OutlinedTextField(
                chatQuery,
                { chatQuery = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                placeholder = { Text("Find in chat") },
                singleLine = true,
            )
        }
        LazyColumn(Modifier.weight(1f).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (pane == "Chat") items(messages.filter { chatQuery.isBlank() || it.text.contains(chatQuery, true) }) { message ->
                Box(Modifier.fillMaxWidth(), contentAlignment = if (message.role == "user") Alignment.CenterEnd else Alignment.CenterStart) {
                    Text(
                        message.text,
                        color = if (message.role == "user") Color.White else Color(0xFFF2F2F4),
                        modifier = Modifier
                            .widthIn(max = 320.dp)
                            .clip(RoundedCornerShape(22.dp))
                            .background(if (message.role == "user") Color(0xFFD84F8B) else Color(0xFF2C2C31))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    )
                }
            }
            if (pane == "Files") items(files) { name -> Text(name) }
            if (pane == "Terminal" || pane == "Computer") {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(computer.ifBlank { "Agent desktop" })
                        OutlinedTextField(command, { command = it }, label = { Text("Terminal") })
                        Button(onClick = {
                            scope.launch {
                                terminal = runCatching { withContext(Dispatchers.IO) { api.exec(workspaceId, command).toString() } }
                                    .getOrElse { failureMessage(it).orEmpty() }
                            }
                        }) { Text("Run") }
                        Text(terminal)
                        Button(onClick = {
                            scope.launch {
                                detail = runCatching {
                                    withContext(Dispatchers.IO) { api.handoff(workspaceId, "stop", "other", agentId); api.handoff(workspaceId, "start", "phone", agentId).toString() }
                                }.getOrElse { failureMessage(it).orEmpty() }
                            }
                        }) { Text("Force access") }
                        Text(detail)
                    }
                }
            }
            if (pane == "Preview") item { Text(preview.ifBlank { "Open Preview to load the workspace URL." }) }
            if (pane == "Group") item { Text(group.ifBlank { "No shared messages yet." }) }
            if (pane == "Account") {
                item { Text(account.ifBlank { "Account" }) }
                item {
                    Button(onClick = { forgetSession() }) { Text("Sign out") }
                }
                items(plans) { name -> Text(name) }
            }
            if (pane == "Billing") {
                items(plans) { name ->
                    TextButton(onClick = {
                        scope.launch {
                            detail = runCatching { withContext(Dispatchers.IO) { api.createOrder(workspaceId, "hosting-2c4g") } }
                                .getOrElse { failureMessage(it).orEmpty() }
                        }
                    }) { Text(name) }
                }
                item { Text(detail.ifBlank { "Tap a plan to start checkout." }) }
            }
            if (pane == "Market") items(files) { name -> Text(name) }
            if (pane == "Pollen") item { Text(preview.ifBlank { "Connect URL" }) }
            if (pane == "Provider") {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(provider, { provider = it }, label = { Text("Provider") })
                        OutlinedTextField(model, { model = it }, label = { Text("Model") })
                        OutlinedTextField(apiKey, { apiKey = it }, label = { Text("API key") })
                        Button(onClick = {
                            scope.launch {
                                try {
                                    withContext(Dispatchers.IO) { api.saveProvider(workspaceId, provider.trim(), model.trim(), apiKey) }
                                    error = null
                                    apiKey = ""
                                } catch (cause: Exception) {
                                    failureMessage(cause)?.let { error = it }
                                }
                            }
                        }) { Text("Save provider") }
                    }
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
        if (pane == "Chat") Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("Terminal", "Preview", "Computer").forEach { name ->
                Text(
                    name,
                    color = Color.White,
                    modifier = Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF1C1C22))
                        .clickable { openTool(name) }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
        if (pane == "Chat" && (running || workLabel.isNotBlank())) {
            val mark = bots.firstOrNull { it.agentId == agentId }?.mark ?: 0xFF3D5AFE.toInt()
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(28.dp).clip(RoundedCornerShape(9.dp)).background(Color(mark)), contentAlignment = Alignment.Center) {
                    Text(agentName.take(1).uppercase(), color = Color.White, style = MaterialTheme.typography.labelSmall)
                }
                Text(
                    workLabel.ifBlank { "Putting it together" },
                    color = Color(0xFFE7E7EA),
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
        }
        if (pane == "Chat") Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(Color(0xFF1C1C22))
                .padding(horizontal = 8.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                draft,
                { draft = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Ask $agentName", color = Color(0xFF9A9AA3)) },
                shape = RoundedCornerShape(24.dp),
                maxLines = 4,
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.Transparent,
                    unfocusedBorderColor = Color.Transparent,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    cursorColor = Color(0xFFD84F8B),
                ),
            )
            IconButton(onClick = {
                if (running) {
                    running = false
                    scope.launch {
                        runCatching { withContext(Dispatchers.IO) { api.stop(workspaceId, agentId, chatId) } }
                            .onFailure { cause -> failureMessage(cause)?.let { error = it } }
                    }
                    return@IconButton
                }
                val text = draft.trim()
                if (text.isEmpty() || chatId.isEmpty()) return@IconButton
                messages = messages + VectraMessage("", "user", text)
                draft = ""
                running = true
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) { api.send(workspaceId, agentId, chatId, text) }
                    } catch (cause: Exception) {
                        running = false
                        failureMessage(cause)?.let { error = it }
                    }
                }
            }) {
                Icon(
                    if (running) VectraIcons.Square else VectraIcons.Send,
                    contentDescription = if (running) "Stop" else "Send",
                    tint = if (running) Color(0xFFE7E7EA) else Color(0xFF8EB4FF),
                )
            }
        }
    }
}

@Composable
private fun VectraSignIn(
    email: String,
    onEmail: (String) -> Unit,
    busy: Boolean,
    error: String?,
    onError: (String?) -> Unit,
    onSubmit: (String, String, String, Boolean) -> Unit,
) {
    val focus = LocalFocusManager.current
    var password by remember { mutableStateOf("") }
    var host by remember { mutableStateOf("") }
    var register by remember { mutableStateOf(false) }
    var daemon by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    val action = when {
        daemon -> "Connect"
        register -> "Create account"
        else -> "Sign in"
    }
    fun submit() {
        if (busy) return
        val address = host.trim()
        val origin = if (daemon) {
            val url = if ("://" in address) address else "http://$address"
            url.toHttpUrlOrNull()?.takeIf {
                it.username.isEmpty() && it.password.isEmpty() && it.query == null && it.fragment == null
            }?.toString()?.trimEnd('/')
        } else {
            VECTRA_API_ORIGIN
        }
        val problem = when {
            daemon && origin == null -> "Enter a valid Supercharge server host."
            daemon && password.isEmpty() -> "Enter the server password."
            !daemon && '@' !in email.trim() -> "Enter a valid email."
            !daemon && password.length < 6 -> "Password must be at least 6 characters."
            else -> null
        }
        if (problem != null || origin == null) {
            onError(problem)
            return
        }
        focus.clearFocus()
        onSubmit(if (daemon) "server@supercharge" else email.trim(), password, origin, register && !daemon)
    }

    Column(
        Modifier.fillMaxSize().background(Color(0xFF0E0E10)).imePadding()
            .verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 36.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Vectra", color = Color.White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold)
        Text(
            when {
                daemon -> "Connect to a Supercharge daemon on your VPS or local network."
                register -> "Create your Vectra account."
                else -> "Sign in to your cloud workspaces, conversations, and files."
            },
            color = Color(0xFFB7B7C2),
        )
        FilterChip(
            selected = daemon,
            enabled = !busy,
            onClick = {
                daemon = !daemon
                password = ""
                showPassword = false
                onError(null)
            },
            label = { Text("Supercharge server") },
        )
        OutlinedTextField(
            if (daemon) host else email,
            { if (daemon) host = it else onEmail(it) },
            label = { Text(if (daemon) "Host" else "Email") },
            placeholder = if (daemon) ({ Text("http://192.168.1.10:6767") }) else null,
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (daemon) KeyboardType.Uri else KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
        )
        OutlinedTextField(
            password,
            { password = it },
            label = { Text("Password") },
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
            singleLine = true,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            trailingIcon = {
                TextButton(enabled = !busy, onClick = { showPassword = !showPassword }) {
                    Text(if (showPassword) "Hide" else "Show")
                }
            },
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            modifier = Modifier.fillMaxWidth(),
            enabled = !busy,
            onClick = ::submit,
            colors = ButtonDefaults.buttonColors(contentColor = Color(0xFF06140C)),
        ) {
            Text(if (busy) "Connecting…" else action)
        }
        if (!daemon) {
            TextButton(
                enabled = !busy,
                onClick = {
                    register = !register
                    onError(null)
                },
            ) { Text(if (register) "Have an account? Sign in" else "New here? Create an account") }
        }
    }
}

private data class VectraBot(
    val workspaceId: String,
    val agentId: String,
    val name: String,
    val color: String,
    val preview: String,
    val mark: Int,
)

@Composable
private fun VectraRoster(
    bots: List<VectraBot>,
    query: String,
    onQuery: (String) -> Unit,
    onOpen: (VectraBot) -> Unit,
    onSignOut: () -> Unit,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
) {
    val shown = bots.filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }
    Column(Modifier.fillMaxSize().background(Color(0xFF0E0E10)).navigationBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Vectra", color = Color.White, modifier = Modifier.weight(1f).padding(start = 12.dp), style = MaterialTheme.typography.titleLarge)
            IconButton(onClick = onSignOut) { Icon(VectraIcons.Ellipsis, contentDescription = "Sign out", tint = Color(0xFFB7B7C2)) }
        }
        LazyColumn(Modifier.weight(1f)) {
            if (loading || error != null || shown.isEmpty()) item {
                Column(Modifier.padding(20.dp)) {
                    Text(
                        when {
                            loading -> "Loading bots…"
                            error != null -> error
                            query.isNotBlank() -> "No matching bots."
                            else -> "No bots yet."
                        },
                        color = Color(0xFFB7B7C2),
                    )
                    if (error != null) TextButton(onClick = onRetry) { Text("Retry") }
                }
            }
            items(shown, key = { "${it.workspaceId}/${it.agentId}" }) { bot ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(bot) }.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(Color(bot.mark)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(bot.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.SemiBold)
                    }
                    Text(
                        bot.name,
                        color = Color.White,
                        modifier = Modifier.padding(start = 14.dp),
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(12.dp).clip(RoundedCornerShape(16.dp)).background(Color(0xFF17171C)).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(VectraIcons.Search, contentDescription = null, tint = Color(0xFF8E8E99))
            OutlinedTextField(
                query,
                onQuery,
                modifier = Modifier.weight(1f),
                placeholder = { Text("Search bots", color = Color(0xFF8E8E99)) },
                singleLine = true,
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.Transparent,
                    unfocusedBorderColor = Color.Transparent,
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                ),
            )
        }
    }
}
