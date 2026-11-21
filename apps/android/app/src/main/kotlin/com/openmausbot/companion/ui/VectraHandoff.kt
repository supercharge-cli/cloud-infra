package com.openmausbot.companion.ui

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraHttpException
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.obj
import com.openmausbot.companion.core.string
import java.net.URI
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private data class HandoffLease(val id: String, val expiresAt: Long)
private val handoffIdPattern = Regex("[A-Za-z0-9_-]{16,128}")
private class HandoffUnavailable(message: String) : Exception(message)

private fun requireHandoff(available: Boolean, message: String) {
    if (!available) throw HandoffUnavailable(message)
}

private fun verifyTurn(api: VectraApi, workspace: String, chat: String): Boolean {
    val state = api.chatStatus(workspace, chat)
    val otherWork = listOf("activeBotChats", "queuedBotChats").any { field ->
        (state[field] as? JsonArray).orEmpty().any { (it as? JsonPrimitive)?.content != chat }
    }
    requireHandoff(!otherWork, "Another agent is working or queued. Stop that task in its chat first.")
    val tasks = state["backgroundTasks"]
    requireHandoff(tasks == null || tasks is JsonArray && tasks.isEmpty(), "Stop the background tasks before taking browser control.")
    return state.obj("turn").flag("busy") ?: throw HandoffUnavailable("Could not verify the agent’s turn state.")
}

@Composable
internal fun VectraHandoff(
    api: VectraApi,
    workspace: String,
    bot: String,
    chat: String,
    exitRequest: Int,
    failure: (Throwable) -> String?,
    onLock: (Boolean) -> Unit,
    onExit: () -> Unit,
    onContinue: suspend (String) -> Unit,
    watch: @Composable (Modifier) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var lease by remember(workspace, bot, chat) { mutableStateOf<HandoffLease?>(null) }
    var wsUrl by remember { mutableStateOf<String?>(null) }
    var web by remember { mutableStateOf<WebView?>(null) }
    var busy by remember { mutableStateOf(false) }
    var canContinue by remember { mutableStateOf(false) }
    var wasBusy by remember { mutableStateOf(false) }
    var competitor by remember { mutableStateOf(false) }
    var released by remember { mutableStateOf(false) }
    var autoReleasedId by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var foreground by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    var notes by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf<String?>(null) }

    fun describe(cause: Throwable) = if (cause is HandoffUnavailable) cause.message else failure(cause)

    suspend fun suspendViewer() {
        val active = web
        if (active != null) {
            active.evaluateJavascript("window.SuperchargeBrowser?.suspend()", null)
            withTimeoutOrNull(2_500L) {
                while (!active.desktopInputStopped()) delay(50)
            }
            active.stopLoading()
            active.loadUrl("about:blank")
        }
        wsUrl = null
    }

    fun release(continueTask: Boolean = false, leave: Boolean = false, expired: Boolean = false) {
        if (busy) return
        val owned = lease ?: return
        busy = true
        confirm = false
        errorText = null
        scope.launch {
            try {
                suspendViewer()
                withContext(Dispatchers.IO) { api.stopBrowserHandoff(workspace, owned.id, bot) }
                lease = null
                released = true
                val resume = continueTask && canContinue && owned.expiresAt > System.currentTimeMillis() && foreground
                canContinue = false
                onLock(false)
                if (expired) errorText = "Browser control expired."
                if (resume) {
                    val prompt = buildString {
                        append("Manual browser work is complete and control has been returned. ")
                        if (wasBusy) append("The running task was interrupted for this manual step. ")
                        append("Continue the original task in the same E2B desktop and browser session. ")
                        append("First use desktop_observe for a fresh screenshot and inspect the active window, tab and desktop state. ")
                        append("Preserve manual changes and login state. Do not replay manual actions or request, repeat or expose secrets.")
                        notes.trim().takeIf(String::isNotEmpty)?.let { append("\n\nUser notes about the manual changes:\n").append(it) }
                    }
                    try {
                        onContinue(prompt)
                    } catch (cause: Exception) {
                        val detail = failure(cause)
                        if (detail != null) errorText = "Control was released. The task could not resume. $detail"
                        return@launch
                    }
                }
                notes = ""
                if (leave) onExit()
            } catch (cause: Exception) {
                canContinue = false
                val detail = failure(cause)
                if (detail != null) errorText = "Could not confirm release. Retry Release. $detail"
            } finally { busy = false }
        }
    }

    fun connect(owned: HandoffLease) {
        if (busy || !canContinue || !foreground || owned.expiresAt <= System.currentTimeMillis()) return
        busy = true
        errorText = null
        scope.launch {
            try {
                suspendViewer()
                val ticket = withContext(Dispatchers.IO) {
                    requireHandoff(!verifyTurn(api, workspace, chat), "The agent is still working. Desktop input is disabled.")
                    api.browserVncTicket(workspace, owned.id, bot)
                }
                if (foreground && owned.expiresAt > System.currentTimeMillis()) wsUrl = ticket
            } catch (cause: Exception) { errorText = describe(cause) }
            finally { busy = false }
        }
    }

    fun take(force: Boolean) {
        if (busy || lease != null || !foreground || chat.isBlank()) return
        busy = true
        competitor = false
        released = false
        errorText = null
        onLock(true)
        scope.launch {
            var acquiring: String? = null
            var agentStopped = false
            try {
                val computer = withContext(Dispatchers.IO) { api.computerStatus(workspace, bot) }
                requireHandoff(bot == "main" || computer.string("botId") == bot || computer.obj("desktop").string("botId") == bot,
                    "This agent’s desktop is unavailable.")
                val existing = computer.string("handoffId")
                if (computer.flag("handoff") == true) {
                    competitor = true
                    if (!force || existing == null || !handoffIdPattern.matches(existing)) {
                        throw HandoffUnavailable("Another viewer already has browser control.")
                    }
                    withContext(Dispatchers.IO) { api.stopBrowserHandoff(workspace, existing, bot) }
                } else requireHandoff(computer.flag("handoff") == false, "Could not verify that browser control is available.")
                competitor = false
                wasBusy = withContext(Dispatchers.IO) {
                    val active = verifyTurn(api, workspace, chat)
                    api.stop(workspace, bot, chat)
                    active
                }
                agentStopped = true
                val idle = withTimeoutOrNull(12_000L) {
                    while (withContext(Dispatchers.IO) { verifyTurn(api, workspace, chat) }) delay(250)
                    true
                }
                requireHandoff(idle == true, "The agent did not become idle in time.")
                if (!foreground) return@launch

                val id = UUID.randomUUID().toString()
                acquiring = id
                val expiry = withContext(Dispatchers.IO) { api.startBrowserHandoff(workspace, id, bot, chat) }
                val owned = HandoffLease(id, expiry)
                lease = owned
                acquiring = null
                requireHandoff(expiry > System.currentTimeMillis(), "Browser control expired.")
                val ticket = withContext(Dispatchers.IO) {
                    requireHandoff(!verifyTurn(api, workspace, chat), "The agent is still working. Desktop input is disabled.")
                    api.browserVncTicket(workspace, id, bot)
                }
                canContinue = true
                if (foreground && expiry > System.currentTimeMillis()) wsUrl = ticket
            } catch (cause: Exception) {
                val uncertainId = acquiring
                if (uncertainId != null && (cause !is VectraHttpException || cause.status >= 500)) {
                    withContext(NonCancellable + Dispatchers.IO) { runCatching { api.stopBrowserHandoff(workspace, uncertainId, bot) } }
                }
                val detail = describe(cause)
                if (detail != null) errorText = detail + if (agentStopped && lease == null) " The agent remains stopped." else ""
            } finally {
                busy = false
                if (lease == null) onLock(false)
            }
        }
    }

    DisposableEffect(lifecycle, workspace, bot, chat) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> foreground = true
                Lifecycle.Event.ON_STOP -> {
                    foreground = false
                    web?.evaluateJavascript("window.SuperchargeBrowser?.suspend()", null)
                }
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            val id = lease?.id
            if (id != null) CoroutineScope(Dispatchers.IO).launch {
                runCatching { api.stopBrowserHandoff(workspace, id, bot) }
            }
        }
    }
    LaunchedEffect(lease, busy, foreground) {
        val owned = lease ?: return@LaunchedEffect
        if (busy || autoReleasedId == owned.id) return@LaunchedEffect
        if (foreground) delay((owned.expiresAt - System.currentTimeMillis()).coerceAtLeast(0))
        autoReleasedId = owned.id
        release(expired = foreground)
    }
    LaunchedEffect(exitRequest) {
        if (exitRequest > 0 && lease != null && !busy) {
            suspendViewer()
            leaving = true
            confirm = true
        }
    }

    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val address = wsUrl
        val owned = lease
        if (address != null && owned != null) {
            key(address) { VectraDesktopViewer(address, owned.expiresAt, Modifier.fillMaxWidth().weight(1f)) { web = it } }
        } else {
            watch(Modifier.fillMaxWidth().weight(1f))
        }
        if (busy) Text("Updating desktop control…")
        if (released) Text("Browser control released")
        errorText?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        optionsRow {
            if (owned == null || competitor) {
                Button(enabled = !busy && chat.isNotBlank() && owned == null, onClick = { take(false) }) { Text("Take over") }
                if (competitor) TextButton(enabled = !busy, onClick = { take(true) }) { Text("Force access") }
            }
            if (owned != null) {
                if (canContinue) TextButton(enabled = !busy, onClick = { connect(owned) }) { Text("Reconnect desktop") }
                Button(enabled = !busy, onClick = {
                    scope.launch {
                        suspendViewer()
                        leaving = false
                        confirm = true
                    }
                }) { Text("Release") }
            }
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false; lease?.let(::connect) },
            title = { Text("Return control?") },
            text = {
                OutlinedTextField(notes, { notes = it.take(4000) }, label = { Text("What did you change? (optional)") },
                    supportingText = { Text("Keep passwords and codes out of notes.") }, minLines = 2, maxLines = 4)
            },
            dismissButton = { TextButton(onClick = { confirm = false; lease?.let(::connect) }) { Text("Keep control") } },
            confirmButton = {
                Column {
                    if (canContinue) TextButton(onClick = { release(continueTask = true, leave = leaving) }) { Text("Return & continue") }
                    TextButton(onClick = { release(leave = leaving) }) { Text("Exit without resuming") }
                }
            },
        )
    }
}

private suspend fun WebView.desktopInputStopped(): Boolean = suspendCancellableCoroutine { pending ->
    evaluateJavascript("!window.SuperchargeBrowser || window.SuperchargeBrowser.suspended") { result ->
        if (pending.isActive) pending.resume(result == "true")
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun VectraDesktopViewer(url: String, expiry: Long, modifier: Modifier, onView: (WebView?) -> Unit) {
    val origin = "https://viewer.vectra.invalid"
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                setBackgroundColor(android.graphics.Color.rgb(11, 20, 26))
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                        request.url.toString() !in setOf("$origin/", "about:blank")

                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                        when (request.url.toString()) {
                            "$origin/" -> WebResourceResponse("text/html", "UTF-8", desktopDocument(context, url, expiry).byteInputStream())
                            "$origin/rfb.mjs" -> WebResourceResponse("text/javascript", "UTF-8", context.assets.open("vectra/rfb.mjs"))
                            else -> null
                        }
                }
                loadUrl("$origin/")
                onView(this)
            }
        },
        onRelease = { view ->
            onView(null)
            view.stopLoading()
            view.destroy()
        },
    )
}

private fun desktopDocument(context: Context, url: String, expiry: Long): String {
    val html = context.assets.open("vectra/browser-handoff.html").bufferedReader().use { it.readText() }
    val socket = URI(url).let { "${it.scheme}://${it.rawAuthority}" }
    val session = buildJsonObject { put("wsUrl", url); put("expiresAt", expiry) }.toString().replace("<", "\\u003c")
    return html.replace("VECTRA_SOCKET", socket).replace("/*VECTRA_LEASE*/", session)
}
