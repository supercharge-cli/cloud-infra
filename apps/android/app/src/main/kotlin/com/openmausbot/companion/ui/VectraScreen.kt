package com.openmausbot.companion.ui

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Switch
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.VectraAgent
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.VectraNotifications
import com.openmausbot.companion.VectraThreadTarget
import com.openmausbot.companion.core.VectraAttachment
import com.openmausbot.companion.core.VectraChatState
import com.openmausbot.companion.core.safeVectraText
import com.openmausbot.companion.core.string
import com.openmausbot.companion.core.obj
import java.util.UUID
import com.openmausbot.companion.core.VectraDashboard
import com.openmausbot.companion.core.VectraHttpException
import com.openmausbot.companion.core.VectraWorkspace
import com.openmausbot.companion.core.VECTRA_API_ORIGIN
import com.openmausbot.companion.core.flag
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
    val notifications = remember { VectraNotifications(context.applicationContext) }
    var notify by remember { mutableStateOf(prefs.getBoolean("chatNotifications", false)) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notify = granted
        prefs.edit().putBoolean("chatNotifications", granted).apply()
    }
    var email by remember { mutableStateOf(prefs.getString("email", "").orEmpty()) }
    var signedIn by remember { mutableStateOf(api.token.isNotBlank()) }
    var loadingBots by remember { mutableStateOf(signedIn) }
    var rosterError by remember { mutableStateOf<String?>(null) }
    var signInBusy by remember { mutableStateOf(false) }
    var dashboard by remember { mutableStateOf<VectraDashboard?>(null) }
    var destination by remember { mutableStateOf(VectraDestination.Home) }
    var billingTarget by remember { mutableStateOf(VectraBillingTarget()) }
    var settingsTarget by remember { mutableStateOf<VectraWorkspace?>(null) }
    var cliUpdates by remember { mutableStateOf(emptySet<String>()) }
    var homeAction by remember { mutableStateOf<String?>(null) }
    var workspaceId by remember { mutableStateOf("") }
    var agents by remember { mutableStateOf(emptyList<VectraAgent>()) }
    var agentId by remember { mutableStateOf("") }
    var chatId by remember { mutableStateOf("") }
    var configuredProvider by remember(workspaceId) { mutableStateOf("") }
    var configuredModel by remember(workspaceId) { mutableStateOf("") }
    LaunchedEffect(workspaceId) {
        if (workspaceId.isNotBlank()) {
            try {
                val config = withContext(Dispatchers.IO) { api.config(workspaceId) }
                val sections = listOf(config.obj("sandbox"), config.obj("stored"), config)
                configuredProvider = sections.firstNotNullOfOrNull { it.string("provider")?.takeIf(String::isNotBlank) }.orEmpty()
                configuredModel = sections.firstNotNullOfOrNull { it.string("model")?.takeIf(String::isNotBlank) }.orEmpty()
            } catch (cause: CancellationException) {
                throw cause
            } catch (_: Exception) {
                configuredProvider = ""
                configuredModel = ""
            }
        }
    }
    var draft by remember { mutableStateOf("") }
    var turn by remember { mutableStateOf(VectraChatState()) }
    val messages = turn.messages
    var groupOpen by remember { mutableStateOf(false) }
    var fromGroup by remember { mutableStateOf(false) }
    var recentKickoff by remember { mutableStateOf(0L) }
    var draftByThread by remember { mutableStateOf(emptyMap<String, String>()) }
    var chatTool by remember { mutableStateOf<VectraChatTool?>(null) }
    var toolsOpen by remember { mutableStateOf(false) }
    var attachments by remember { mutableStateOf(emptyList<VectraAttachment>()) }
    var pickingAttachments by remember { mutableStateOf(false) }
    var stopPending by remember { mutableStateOf(false) }
    var sendPending by remember { mutableStateOf(false) }
    var latestUserMessage by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var pane by remember { mutableStateOf("Chat") }
    var browserControlActive by remember { mutableStateOf(false) }
    var computerTab by remember { mutableStateOf(VectraComputerTab.Agent) }
    var filesStandalone by remember { mutableStateOf(false) }
    var workLabel by remember { mutableStateOf("Thinking") }
    var menuOpen by remember { mutableStateOf(false) }
    var chatQuery by remember { mutableStateOf("") }
    var finding by remember { mutableStateOf(false) }
    var eventsJob by remember { mutableStateOf<Job?>(null) }
    var loadingChat by remember { mutableStateOf(false) }
    var bots by remember { mutableStateOf(emptyList<VectraBot>()) }
    var inChat by remember { mutableStateOf(false) }
    val activity = context as? MainActivity

    fun forgetSession() {
        eventsJob?.cancel()
        notifications.cancelProgress(VectraThreadTarget(workspaceId, agentId, chatId))
        api.signOut()
        turn = VectraChatState()
        chatTool = null
        groupOpen = false
        fromGroup = false
        draftByThread = emptyMap()
        attachments = emptyList()
        prefs.edit().remove("token").remove("origin").apply()
        signedIn = false
        inChat = false
        bots = emptyList()
        dashboard = null
        cliUpdates = emptySet()
        destination = VectraDestination.Home
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
            ?: "Could not reach Vectrabot. Check your connection and try again."
    }

    suspend fun collectBots(listed: List<VectraWorkspace>): List<VectraBot> = withContext(Dispatchers.IO) {
        val marks = listOf(0xFF3D5AFE, 0xFF7C4DFF, 0xFF00B8D4, 0xFFFF6D00, 0xFF00C853, 0xFFD500F9, 0xFF2979FF, 0xFFFF4081).map { it.toInt() }
        var index = 0
        listed.filter { !it.pastDue && it.state != "destroyed" }.flatMap { workspace ->
            val available = try {
                api.agents(workspace.id)
            } catch (cause: VectraHttpException) {
                if (cause.status == 401) throw cause
                emptyList()
            }
            available.map { agent ->
                val n = index++
                VectraBot(workspace.id, agent.id, agent.name, "bot", "", marks[n % marks.size].toInt())
            }
        }
    }

    fun updateTurn(next: VectraChatState) {
        val target = VectraThreadTarget(workspaceId, agentId, chatId)
        if (notify && chatId.isNotEmpty()) {
            val name = bots.firstOrNull { it.workspaceId == workspaceId && it.agentId == agentId }?.name ?: "Vectrabot"
            if (turn.working && !next.working) {
                if (stopPending) notifications.cancelProgress(target)
                else notifications.finish(target, name, next.problem == null)
            }
            val prior = turn.messages.size
            if (next.messages.size > prior) {
                val kind = next.messages.lastOrNull()?.kind
                if (kind in setOf("ask", "approve", "approval")) notifications.action(target, if (kind == "ask") "Agent question" else "Approval needed")
            }
        }
        turn = next
        latestUserMessage = next.messages.lastOrNull { it.kind == "text" && it.role == "user" }?.text
    }

    fun openAgent(nextWorkspace: String, nextAgent: String, requestedThread: String? = null) {
        if (chatId.isNotBlank()) draftByThread = draftByThread + (chatId to draft)
        eventsJob?.cancel()
        notifications.cancelProgress(VectraThreadTarget(workspaceId, agentId, chatId))
        workspaceId = nextWorkspace
        agentId = nextAgent
        chatId = ""
        turn = VectraChatState()
        latestUserMessage = null
        recentKickoff = 0
        sendPending = false
        workLabel = "Thinking"
        draft = ""
        attachments = emptyList()
        error = null
        loadingChat = true
        finding = false
        chatQuery = ""
        eventsJob = scope.launch {
            try {
                val conversation = requestedThread ?: withContext(Dispatchers.IO) { api.conversation(nextWorkspace, nextAgent) }
                val history = try {
                    withContext(Dispatchers.IO) { api.transcript(nextWorkspace, nextAgent, conversation) }
                } catch (cause: Exception) {
                    if (cause is CancellationException || (cause is VectraHttpException && cause.status == 401)) throw cause
                    emptyList()
                }
                chatId = conversation
                draft = draftByThread[conversation].orEmpty()
                turn = VectraChatState(messages = history)
                latestUserMessage = history.lastOrNull { it.role == "user" }?.text
                loadingChat = false
                var backoff = 700L
                var replay = true
                while (true) {
                    try {
                        api.chatEvents(nextWorkspace, nextAgent, conversation, turn.cursor).collect { event ->
                            backoff = 700L
                            val type = event.string("type")
                            val settling = System.currentTimeMillis() - recentKickoff < 1800
                            if (!(settling && type in setOf("status", "snapshot") && event.flag("busy") == false)) {
                                updateTurn(turn.accept(event, if (replay && recentKickoff == 0L) history else emptyList()))
                            }
                            if (type in setOf("snapshot", "ready") || recentKickoff > 0L) replay = false
                        }
                    } catch (cause: Exception) {
                        if (cause is CancellationException || cause is VectraHttpException && cause.authenticated && cause.status == 401) throw cause
                    }
                    kotlinx.coroutines.delay(backoff)
                    backoff = (backoff * 2).coerceAtMost(8000L)
                }
            } catch (cause: Exception) {
                if (cause is CancellationException) throw cause
                loadingChat = false
                failureMessage(cause)?.let { error = it }
            }
        }
    }

    fun openBot(bot: VectraBot, thread: String? = null, returnToGroup: Boolean = false) {
        inChat = true
        groupOpen = false
        fromGroup = returnToGroup
        pane = "Chat"
        openAgent(bot.workspaceId, bot.agentId, thread)
    }

    fun openGroup(id: String) {
        if (chatId.isNotBlank()) draftByThread = draftByThread + (chatId to draft)
        eventsJob?.cancel()
        notifications.cancelProgress(VectraThreadTarget(workspaceId, agentId, chatId))
        turn = VectraChatState()
        chatId = ""
        workspaceId = id
        groupOpen = true
        fromGroup = false
        inChat = true
        pane = "Chat"
    }

    suspend fun loadBots() {
        val token = api.token
        loadingBots = true
        rosterError = null
        try {
            val loaded = withContext(Dispatchers.IO) { api.dashboard() }
            if (api.token != token) return
            dashboard = loaded
            val rows = collectBots(loaded.workspaces)
            if (api.token == token) {
                bots = rows
                agents = rows.map { VectraAgent(it.agentId, it.name) }
            }
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

    LaunchedEffect(signedIn, dashboard?.workspaces) {
        val targets = dashboard?.workspaces.orEmpty().filter { !it.pastDue && it.state != "destroyed" }.take(8)
        if (!signedIn) return@LaunchedEffect
        val available = mutableSetOf<String>()
        for (workspace in targets) {
            try {
                if (withContext(Dispatchers.IO) { api.cliVersion(workspace.id).flag("updateAvailable") } == true) {
                    available += workspace.id
                }
            } catch (cause: Exception) {
                if (cause is CancellationException) throw cause
                if (cause is VectraHttpException && cause.authenticated && cause.status == 401) {
                    failureMessage(cause)
                    return@LaunchedEffect
                }
            }
        }
        cliUpdates = available
    }

    LaunchedEffect(signedIn, activity?.vectraPollinationsReturned) {
        if (signedIn && activity?.vectraPollinationsReturned == true) {
            activity.vectraPollinationsReturned = false
            eventsJob?.cancel()
            inChat = false
            destination = VectraDestination.Connected
        }
    }

    LaunchedEffect(turn.working, turn.label, chatId, notify) {
        if (!turn.working || chatId.isBlank()) return@LaunchedEffect
        val lines = listOf("Thinking", "Reading the workspace", "Putting it together", "Checking the files", "Looking at the screen", "Working")
        val target = VectraThreadTarget(workspaceId, agentId, chatId)
        val name = bots.firstOrNull { it.workspaceId == workspaceId && it.agentId == agentId }?.name ?: "Vectrabot"
        val explicit = turn.label
        if (explicit != null) {
            workLabel = explicit
            if (notify) notifications.progress(target, name, explicit)
        } else {
            var index = 0
            while (true) {
                workLabel = lines[index++ % lines.size]
                if (notify) notifications.progress(target, name, workLabel)
                kotlinx.coroutines.delay(1400)
            }
        }
    }

    LaunchedEffect(turn.working, chatId) {
        if (!turn.working || chatId.isBlank()) return@LaunchedEffect
        val thread = chatId
        while (turn.working && chatId == thread) {
            kotlinx.coroutines.delay(5500)
            if (sendPending) continue
            try {
                val status = withContext(Dispatchers.IO) { api.chatStatus(workspaceId, thread) }
                if (chatId == thread && status.flag("busy") == false && status.flag("queued") != true) updateTurn(turn.stop())
            } catch (cause: Exception) {
                if (cause is CancellationException || (cause is VectraHttpException && cause.authenticated && cause.status == 401)) failureMessage(cause)
            }
        }
    }

    LaunchedEffect(signedIn, activity?.vectraThreadTarget) {
        val target = activity?.vectraThreadTarget
        if (signedIn && target != null) {
            activity.vectraThreadTarget = null
            inChat = true
            groupOpen = false
            pane = "Chat"
            openAgent(target.workspace, target.bot, target.thread)
        }
    }

    fun openTool(name: String) {
        menuOpen = false
        browserControlActive = false
        if (name == "Files") {
            pane = "Files"
            return
        }
        computerTab = when (name) {
            "Terminal" -> VectraComputerTab.Terminal
            "Preview" -> VectraComputerTab.Preview
            else -> VectraComputerTab.Agent
        }
        pane = "Computer"
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
        fun backHome() { destination = VectraDestination.Home }
        fun purchase(workspace: VectraWorkspace? = null, name: String? = null, plan: VectraPlan? = null) {
            val selected = plan ?: vectraPlans.firstOrNull { it.id == workspace?.planId } ?: vectraPlans[1]
            billingTarget = VectraBillingTarget(selected, name, workspace)
            destination = VectraDestination.Billing
        }
        fun openWorkspace(workspace: VectraWorkspace) {
            if (workspace.pastDue) {
                purchase(workspace)
                return
            }
            openGroup(workspace.id)
        }
        CompanionTheme(darkTheme = true) {
            when (destination) {
                VectraDestination.Home, VectraDestination.Workspaces -> VectraHome(
                    dashboard = dashboard,
                    bots = bots,
                    cliUpdates = cliUpdates,
                    loading = loadingBots || homeAction != null,
                    message = homeAction ?: rosterError,
                    workspacesOnly = destination == VectraDestination.Workspaces,
                    onNavigate = { destination = it },
                    onOpenBot = { openBot(it) },
                    onOpenWorkspace = ::openWorkspace,
                    onSettings = {
                        settingsTarget = it
                        destination = VectraDestination.Settings
                    },
                    onRefresh = { scope.launch { if (signedIn && !loadingBots) loadBots() } },
                    onCreate = { name, plan, paid ->
                        if (paid) purchase(name = name, plan = plan)
                        else scope.launch {
                            if (homeAction != null) return@launch
                            homeAction = "Provisioning sandbox…"
                            rosterError = null
                            try {
                                val created = withContext(Dispatchers.IO) { api.createWorkspace(name) }
                                loadBots()
                                if (signedIn) openWorkspace(created)
                            } catch (cause: VectraHttpException) {
                                if (cause.status == 402) purchase(name = name, plan = plan)
                                else rosterError = failureMessage(cause)
                            } catch (cause: Exception) {
                                rosterError = failureMessage(cause)
                            } finally {
                                homeAction = null
                            }
                        }
                    },
                    onPurchase = { purchase(it) },
                    onAction = { workspace, action ->
                        scope.launch {
                            if (homeAction != null) return@launch
                            homeAction = when (action) {
                                WorkspaceAction.Wake -> "Waking ${workspace.name}…"
                                WorkspaceAction.Restart -> "Restarting ${workspace.name}…"
                                WorkspaceAction.Destroy -> "Destroying ${workspace.name}…"
                            }
                            rosterError = null
                            try {
                                withContext(Dispatchers.IO) {
                                    when (action) {
                                        WorkspaceAction.Wake -> api.wake(workspace.id)
                                        WorkspaceAction.Restart -> api.restartWorkspace(workspace.id)
                                        WorkspaceAction.Destroy -> api.deleteWorkspace(workspace.id)
                                    }
                                }
                                loadBots()
                            } catch (cause: Exception) {
                                rosterError = failureMessage(cause)
                            } finally {
                                homeAction = null
                            }
                        }
                    },
                )
                VectraDestination.Settings -> settingsTarget?.let { workspace ->
                    VectraWorkspaceSettings(
                        api = api,
                        workspace = workspace,
                        failure = ::failureMessage,
                        onBack = ::backHome,
                        onChat = { openWorkspace(workspace) },
                        onFiles = {
                            workspaceId = workspace.id
                            agentId = bots.firstOrNull { it.workspaceId == workspace.id }?.agentId.orEmpty()
                            groupOpen = false
                            inChat = true
                            filesStandalone = true
                            openTool("Files")
                        },
                        onBilling = { purchase(workspace) },
                        onPollinations = { destination = VectraDestination.Pollinations },
                        onDestroyed = {
                            backHome()
                            scope.launch { loadBots() }
                        },
                    )
                }
                VectraDestination.Billing -> VectraBilling(api, activity, billingTarget, email, ::failureMessage, ::backHome) { workspace ->
                    scope.launch {
                        backHome()
                        loadBots()
                        if (workspace != null && signedIn) openWorkspace(workspace)
                    }
                }
                VectraDestination.Pollinations, VectraDestination.Connected -> VectraPollinations(
                    api, destination == VectraDestination.Connected, ::failureMessage, ::backHome,
                )
                VectraDestination.Marketplace -> VectraMarketplace(api, dashboard?.workspaces.orEmpty(), ::failureMessage, ::backHome)
                VectraDestination.Account -> VectraAccountLanding(
                    api,
                    email,
                    ::failureMessage,
                    ::backHome,
                    onPollinations = { destination = VectraDestination.Pollinations },
                    onSignOut = ::forgetSession,
                )
            }
        }
        return
    }

    if (groupOpen) {
        CompanionTheme(darkTheme = true) {
            VectraGroupChat(api, workspaceId, bots.filter { it.workspaceId == workspaceId }, ::failureMessage,
                onBack = { groupOpen = false; inChat = false },
                onOpenBot = { bot, thread -> openBot(bot, thread, returnToGroup = true) },
            )
        }
        return
    }

    val computerFeed = rememberVectraComputerFeed(api, workspaceId, agentId, pane != "Files" && !browserControlActive, ::failureMessage)
    if (pane == "Computer") {
        CompanionTheme(darkTheme = true) {
            VectraComputerPage(
                api, workspaceId, dashboard?.workspaces?.firstOrNull { it.id == workspaceId }?.name ?: "Workspace",
                agentId, chatId, computerTab, { computerTab = it }, computerFeed, ::failureMessage,
                onHandoffLock = { browserControlActive = it },
                onContinue = { prompt ->
                    val workspace = workspaceId
                    val bot = agentId
                    val thread = chatId
                    withContext(Dispatchers.IO) { api.send(workspace, bot, thread, prompt) }
                },
                onClose = { browserControlActive = false; pane = "Chat" },
            )
        }
        return
    }
    if (pane == "Files") {
        CompanionTheme(darkTheme = true) {
            VectraFiles(api, workspaceId, ::failureMessage) {
                pane = "Chat"
                if (filesStandalone) {
                    filesStandalone = false
                    inChat = false
                }
            }
        }
        return
    }

    val openedBot = bots.firstOrNull { it.workspaceId == workspaceId && it.agentId == agentId }
    val agentName = openedBot?.name ?: agents.firstOrNull { it.id == agentId }?.name ?: "Vectrabot"
    val mark = Color(openedBot?.mark ?: 0xFF3D5AFE.toInt())
    val needle = chatQuery.trim()
    val shown = if (needle.isBlank() || !finding) messages else messages.filter { it.text.contains(needle, ignoreCase = true) }
    fun closeSearch() {
        finding = false
        chatQuery = ""
    }
    fun leaveChat() {
        if (!turn.working) eventsJob?.cancel()
        if (chatId.isNotBlank()) draftByThread = draftByThread + (chatId to draft)
        menuOpen = false
        closeSearch()
        if (fromGroup) groupOpen = true else inChat = false
    }
    val focus = LocalFocusManager.current
    val listState = rememberLazyListState()
    var agentPicker by remember { mutableStateOf(false) }
    var showTasks by remember { mutableStateOf(false) }
    val attachPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) {
            pickingAttachments = true
            scope.launch {
                try {
                    val selected = withContext(Dispatchers.IO) { uris.take(12).map { readVectraAttachment(context, it) } }
                    if ((attachments + selected).sumOf { it.bytes.size } > 3 * 1024 * 1024) {
                        error = "Keep each upload under 3 MB in total."
                    } else attachments = (attachments + selected).take(12)
                } catch (cause: Exception) {
                    error = cause.message?.takeIf { it.startsWith("Select files") } ?: failureMessage(cause)
                } finally { pickingAttachments = false }
            }
        }
    }
    LaunchedEffect(chatId, shown.size, finding, needle) {
        if (shown.isNotEmpty()) listState.scrollToItem(if (finding) 0 else shown.lastIndex)
    }
    fun newConversation() {
        val id = workspaceId
        val bot = agentId
        scope.launch {
            try {
                val created = withContext(Dispatchers.IO) { api.newConversation(id, bot) }
                if (workspaceId == id && agentId == bot && inChat) openAgent(id, bot, created)
            } catch (cause: Exception) { error = failureMessage(cause) }
        }
    }
    fun post(input: String = draft) {
        val text = input.trim()
        if ((text.isEmpty() && attachments.isEmpty()) || chatId.isEmpty() || sendPending) return
        when (text.lowercase()) {
            "/history" -> { draft = ""; chatTool = VectraChatTool.History; return }
            "/new" -> { draft = ""; newConversation(); return }
            "/commands" -> { draft = ""; chatTool = VectraChatTool.Commands; return }
        }
        val workspace = workspaceId
        val bot = agentId
        val thread = chatId
        val files = attachments
        val wasWorking = turn.working
        if (wasWorking && (text.isBlank() || files.isNotEmpty())) return
        val optimistic = "local-${UUID.randomUUID()}"
        error = null
        recentKickoff = System.currentTimeMillis()
        workLabel = "Thinking"
        if (!wasWorking) updateTurn(turn.start(text, optimistic))
        sendPending = true
        draft = ""
        attachments = emptyList()
        focus.clearFocus()
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (wasWorking) api.steer(workspace, bot, thread, text)
                    else api.send(workspace, bot, thread, text, files)
                }
            } catch (cause: Exception) {
                if (cause is CancellationException) throw cause
                val message = failureMessage(cause)
                if (chatId == thread && signedIn) {
                    if (!wasWorking) updateTurn(turn.stop().copy(messages = turn.messages.filterNot { it.id == optimistic }))
                    if (draft.isBlank()) draft = text
                    if (attachments.isEmpty()) attachments = files
                    error = message
                }
            } finally { if (chatId == thread) sendPending = false }
        }
    }
    fun stopTurn() {
        if (stopPending || chatId.isBlank()) return
        val workspace = workspaceId
        val bot = agentId
        val thread = chatId
        stopPending = true
        scope.launch {
            try {
                withContext(Dispatchers.IO) { api.stop(workspace, bot, thread) }
                if (chatId == thread) updateTurn(turn.stop())
            } catch (cause: Exception) { error = failureMessage(cause) }
            finally { stopPending = false }
        }
    }
    BackHandler {
        when {
            chatTool != null -> chatTool = null
            toolsOpen -> toolsOpen = false
            menuOpen -> menuOpen = false
            finding -> closeSearch()
            else -> leaveChat()
        }
    }
    CompanionTheme(darkTheme = true) {
        Column(
            Modifier.fillMaxSize().background(Color(0xFF111419)).imePadding().navigationBarsPadding(),
        ) {
            VectraChatHeader(
                title = agentName,
                mark = mark,
                expanded = menuOpen,
                onBack = ::leaveChat,
                onMenu = { menuOpen = it },
                onAction = {
                    if (it == "Search in chat") finding = true
                    else {
                        filesStandalone = false
                        openTool(it)
                    }
                },
            )
            if (configuredProvider.isNotBlank() || configuredModel.isNotBlank()) {
                TextButton(onClick = { chatTool = VectraChatTool.Models }, modifier = Modifier.padding(start = 16.dp)) {
                    Text(listOf(configuredProvider, configuredModel).filter(String::isNotBlank).joinToString(" · "), maxLines = 1)
                }
            }
            if (finding) {
                VectraTranscriptSearch(chatQuery, { chatQuery = it }, ::closeSearch)
            } else {
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { openGroup(workspaceId) }) { Text("Group chat") }
                    TextButton(onClick = { chatTool = VectraChatTool.History }, enabled = chatId.isNotBlank()) { Text("History") }
                    turn.usage?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall) }
                }
            }
            LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (loadingChat) item { Text("Loading chat…", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (finding && needle.isNotBlank() && shown.isEmpty() && !loadingChat) item {
                    Text("No messages match.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(shown) { message ->
                    if (message.kind == "text") {
                        Box(Modifier.fillMaxWidth(), contentAlignment = if (message.role == "user") Alignment.CenterEnd else Alignment.CenterStart) {
                            SelectionContainer {
                                val body = safeVectraText(message.text)
                                val bubble = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(20.dp))
                                        .background(if (message.role == "user") Color(0xFFD84F8B) else Color(0xFF2C2C31))
                                        .padding(horizontal = 14.dp, vertical = 10.dp)
                                if (message.role == "agent" && (body.contains('\n') || body.contains("](") || body.contains("**"))) {
                                    CompositionLocalProvider(LocalContentColor provides Color(0xFFF2F2F4)) {
                                        MarkdownText(body, bubble, openLink = { link -> error = openVectraUrl(context, link) })
                                    }
                                } else Text(body, color = Color(0xFFF2F2F4), modifier = bubble)
                            }
                        }
                    } else {
                        VectraActionCard(message, api, workspaceId, ::failureMessage)
                    }
                }
            }
            if (turn.tasks.isNotEmpty()) {
                TextButton(onClick = { showTasks = !showTasks }, modifier = Modifier.padding(horizontal = 8.dp)) {
                    Text("${turn.tasks.size} background ${if (turn.tasks.size == 1) "task" else "tasks"} running")
                }
                if (showTasks) turn.tasks.forEach { task ->
                    val label = task.string("title") ?: task.string("command") ?: task.string("status") ?: "Background task"
                    Text(safeVectraText(label), Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            (error ?: turn.problem)?.let { Text(safeVectraText(it), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp)) }
            if (turn.working) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(28.dp).clip(RoundedCornerShape(9.dp)).background(mark), contentAlignment = Alignment.Center) {
                        Text(agentName.take(1).uppercase(), color = Color.White, style = MaterialTheme.typography.labelSmall)
                    }
                    Text(turn.label ?: workLabel, color = Color(0xFFE7E7EA), modifier = Modifier.padding(start = 10.dp).weight(1f))
                    IconButton(onClick = ::stopTurn, enabled = !stopPending) { Icon(VectraIcons.Square, contentDescription = "Stop", tint = Color(0xFFE7E7EA)) }
                }
            }
            VectraComputerBar(latestUserMessage?.trim()?.takeIf(String::isNotEmpty)?.let(::safeVectraText) ?: "Computer", computerFeed) { openTool("Computer") }
            if (attachments.isNotEmpty() || pickingAttachments) {
                optionsRow {
                    if (pickingAttachments) Text("Reading attachments…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    attachments.forEach { file ->
                        TextButton(onClick = { attachments = attachments.filterNot { it === file } }) { Text("${file.name}  ×") }
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).clip(RoundedCornerShape(28.dp))
                    .background(Color(0xFF1C1C22)).padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box {
                    IconButton(onClick = { toolsOpen = true }, enabled = !loadingChat) {
                        Icon(VectraIcons.Plus, contentDescription = "Chat tools", tint = Color(0xFF9A9AA3))
                    }
                    DropdownMenu(expanded = toolsOpen, onDismissRequest = { toolsOpen = false }) {
                        DropdownMenuItem(text = { Text("Attach files") }, enabled = !turn.working, onClick = {
                            toolsOpen = false
                            attachPicker.launch(arrayOf("*/*"))
                        })
                        listOf(
                            VectraChatTool.History to "Conversation history",
                            VectraChatTool.Commands to "Commands",
                            VectraChatTool.Models to "Models",
                            VectraChatTool.Agent to "Manage agents",
                            VectraChatTool.GitHub to "GitHub CLI",
                            VectraChatTool.Notifications to "Notifications",
                        ).forEach { (tool, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = { toolsOpen = false; chatTool = tool })
                        }
                    }
                }
                OutlinedTextField(
                    draft, { draft = it }, modifier = Modifier.weight(1f),
                    placeholder = { Text("Ask $agentName", color = Color(0xFF9A9AA3)) },
                    shape = RoundedCornerShape(24.dp), maxLines = 4,
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color.Transparent, unfocusedBorderColor = Color.Transparent,
                        focusedTextColor = Color.White, unfocusedTextColor = Color.White, cursorColor = Color(0xFFD84F8B),
                    ),
                )
                TextButton(onClick = { agentPicker = true }) { Text("@") }
                IconButton(onClick = { post() }, enabled = !loadingChat && !sendPending && (draft.isNotBlank() || attachments.isNotEmpty())) {
                    Icon(VectraIcons.Send, contentDescription = if (turn.working) "Steer reply" else "Send", tint = Color(0xFF8EB4FF))
                }
            }
        }
        when (val tool = chatTool) {
            VectraChatTool.History, VectraChatTool.Commands, VectraChatTool.Models -> VectraChatChoices(
                tool, api, workspaceId, agentId, chatId, ::failureMessage, onDismiss = { chatTool = null },
                onThread = { if (it != chatId) openAgent(workspaceId, agentId, it) },
                onCommand = { command -> if (command.startsWith("/model ")) post(command) else draft = command },
                onNew = ::newConversation,
            )
            VectraChatTool.Agent -> VectraAgentDialog(api, workspaceId, agentId, ::failureMessage, { chatTool = null }) { updated ->
                scope.launch {
                    loadBots()
                    val updatedBot = bots.firstOrNull { it.workspaceId == workspaceId && it.agentId == (updated ?: agentId) }
                        ?: bots.firstOrNull { it.workspaceId == workspaceId }
                    if (updatedBot != null && updatedBot.agentId != agentId) openBot(updatedBot)
                }
            }
            VectraChatTool.GitHub -> AlertDialog(
                onDismissRequest = { chatTool = null },
                title = { Text("GitHub CLI") },
                text = { Column { VectraGitHubSettings(api, workspaceId, ::failureMessage, chatId.takeIf { agentId == "github" }) } },
                confirmButton = { TextButton(onClick = { chatTool = null }) { Text("Close") } },
            )
            VectraChatTool.Notifications -> AlertDialog(
                onDismissRequest = { chatTool = null },
                title = { Text("Notifications") },
                text = {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Replies, questions, and approvals", Modifier.weight(1f))
                        Switch(checked = notify, onCheckedChange = { enable ->
                            if (enable && Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            else {
                                notify = enable
                                prefs.edit().putBoolean("chatNotifications", enable).apply()
                                if (!enable) notifications.cancelProgress(VectraThreadTarget(workspaceId, agentId, chatId))
                            }
                        })
                    }
                },
                confirmButton = { TextButton(onClick = { chatTool = null }) { Text("Close") } },
            )
            null -> Unit
        }
        if (agentPicker) AlertDialog(
            title = { Text("Open agent") },
            onDismissRequest = { agentPicker = false },
            text = { Column { bots.filter { it.workspaceId == workspaceId }.forEach { bot ->
                TextButton(onClick = { agentPicker = false; if (bot.agentId != agentId) openBot(bot) }) { Text(bot.name) }
            } } },
            confirmButton = { TextButton(onClick = { agentPicker = false }) { Text("Close") } },
        )
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
        Text("Vectrabot", color = Color.White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold)
        Text(
            when {
                daemon -> "Connect to a Supercharge daemon on your VPS or local network."
                register -> "Create your Vectrabot account."
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
            label = { Text(if (daemon) "Use email instead" else "Use my own server") },
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

internal data class VectraBot(
    val workspaceId: String,
    val agentId: String,
    val name: String,
    val color: String,
    val preview: String,
    val mark: Int,
)
