package com.openmausbot.companion.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraHttpException
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.number
import com.openmausbot.companion.core.obj
import com.openmausbot.companion.core.string
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal enum class VectraComputerTab(val title: String) {
    Terminal("Terminal"), Agent("Agent computer"), Preview("Preview"),
}

internal data class VectraComputerFeed(val frame: Bitmap? = null, val connected: Boolean = false, val desktop: Boolean = false)

@Composable
internal fun rememberVectraComputerFeed(
    api: VectraApi,
    workspaceId: String,
    botId: String,
    active: Boolean,
    failure: (Throwable) -> String?,
): VectraComputerFeed {
    var feed by remember(workspaceId, botId) { mutableStateOf(VectraComputerFeed()) }
    LaunchedEffect(workspaceId, botId, active) {
        if (!active || workspaceId.isBlank() || botId.isBlank()) return@LaunchedEffect
        var waitMillis = 1500L
        while (true) {
            try {
                api.browserFrames(workspaceId, botId).collect { event ->
                    waitMillis = 1500L
                    when (event.string("type")) {
                        "frame" -> {
                            val frame = withContext(Dispatchers.Default) { decodeVectraImage(event.string("data")) }
                            if (frame != null) feed = feed.copy(frame = frame, connected = true)
                        }
                        "status" -> feed = feed.copy(
                            connected = event.flag("connected") == true,
                            desktop = event.flag("desktop") == true,
                        )
                    }
                }
            } catch (cause: Exception) {
                if (cause is CancellationException) throw cause
                if (cause is VectraHttpException) {
                    if (cause.status == 401) failure(cause)
                    if (cause.status in setOf(401, 402, 404, 409)) return@LaunchedEffect
                }
            }
            feed = feed.copy(connected = false)
            delay(waitMillis)
            waitMillis = (waitMillis * 2).coerceAtMost(15_000)
        }
    }
    return feed
}

internal fun decodeVectraImage(data: String?): Bitmap? {
    if (data.isNullOrBlank()) return null
    return runCatching {
        val bytes = Base64.decode(data.substringAfter(";base64,"), Base64.DEFAULT)
        val dimensions = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, dimensions)
        if (dimensions.outWidth < 1 || dimensions.outHeight < 1) return null
        var sample = 1
        while (maxOf(dimensions.outWidth, dimensions.outHeight) / sample > 4096) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }.getOrNull()
}

@Composable
internal fun VectraComputerBar(title: String, feed: VectraComputerFeed, onClick: () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
            .clip(shape).background(Color(0xFF1C1E24)).clickable(onClick = onClick)
            .padding(start = 8.dp, top = 8.dp, end = 10.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(width = 58.dp, height = 42.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFF09090B)),
            contentAlignment = Alignment.Center,
        ) {
            if (feed.frame != null) {
                Image(feed.frame.asImageBitmap(), contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Icon(VectraIcons.Monitor, contentDescription = null, tint = Color(0xFF8894A3), modifier = Modifier.size(20.dp))
            }
        }
        Text(title, Modifier.weight(1f), color = Color(0xFFD4D4D8), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
        Icon(VectraIcons.ChevronDown, contentDescription = "Open computer", tint = Color(0xFF94A0AD))
    }
}

@Composable
internal fun VectraComputerPage(
    api: VectraApi,
    workspaceId: String,
    workspaceName: String,
    botId: String,
    chatId: String,
    selected: VectraComputerTab,
    onSelect: (VectraComputerTab) -> Unit,
    feed: VectraComputerFeed,
    failure: (Throwable) -> String?,
    onHandoffLock: (Boolean) -> Unit,
    onContinue: suspend (String) -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var commands by remember(workspaceId) { mutableStateOf(emptyList<Pair<String, JsonObject>>()) }
    var command by remember { mutableStateOf("") }
    var running by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var locked by remember { mutableStateOf(false) }
    var exitRequest by remember { mutableStateOf(0) }
    fun close() {
        if (locked) exitRequest++ else onClose()
    }
    fun run() {
        val entered = command.trim()
        if (entered.isEmpty() || running) return
        running = true
        command = ""
        error = null
        focus.clearFocus()
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { api.exec(workspaceId, entered) }
                commands = (commands + (entered to result)).takeLast(30)
            } catch (cause: Exception) {
                error = failure(cause)
            } finally {
                running = false
            }
        }
    }
    BackHandler(onBack = ::close)
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onBackground) {
    Column(Modifier.fillMaxSize().background(Color(0xFF0B0B0D))) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = ::close) { Icon(VectraIcons.Close, contentDescription = "Close") }
            Text("$workspaceName’s computer", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
            VectraComputerTab.entries.forEachIndexed { index, tab ->
                SegmentedButton(
                    shape = SegmentedButtonDefaults.itemShape(index, VectraComputerTab.entries.size),
                    onClick = { onSelect(tab) },
                    enabled = !locked || selected == tab,
                    selected = selected == tab,
                    icon = {},
                    label = { Text(tab.title, maxLines = 1) },
                )
            }
        }
        when (selected) {
            VectraComputerTab.Terminal -> Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp)) {
                LazyColumn(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFF141518)).padding(12.dp)) {
                    if (commands.isEmpty()) item { Text("No commands yet", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(commands) { (entered, result) ->
                        Text(vectraSafeStatus("\$ $entered"), color = Color(0xFF82D9A0), fontFamily = FontFamily.Monospace)
                        val text = listOfNotNull(result.string("stdout"), result.string("stderr")).filter(String::isNotEmpty).joinToString("\n")
                        SelectionContainer { Text(vectraSafeStatus(text.ifBlank { "Exit ${result.number("exitCode") ?: "—"}" }), fontFamily = FontFamily.Monospace) }
                        HorizontalDivider(Modifier.padding(vertical = 10.dp))
                    }
                    if (running) item { Text("Running command…") }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        command, { command = it }, Modifier.weight(1f), label = { Text("Run a command") },
                        enabled = !running, singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { run() }),
                    )
                    Button(onClick = ::run, enabled = command.isNotBlank() && !running) { Text("Run") }
                }
            }
            VectraComputerTab.Agent -> VectraHandoff(
                api, workspaceId, botId, chatId, exitRequest, failure,
                onLock = { locked = it; onHandoffLock(it) },
                onExit = onClose,
                onContinue = onContinue,
            ) { modifier -> VectraAgentComputer(api, workspaceId, botId, feed, failure, modifier) }
            VectraComputerTab.Preview -> VectraPreview(api, workspaceId, failure)
        }
    }
    }
}

@Composable
private fun VectraAgentComputer(
    api: VectraApi,
    workspaceId: String,
    botId: String,
    feed: VectraComputerFeed,
    failure: (Throwable) -> String?,
    modifier: Modifier,
) {
    var status by remember(workspaceId, botId) { mutableStateOf<JsonObject?>(null) }
    var error by remember(workspaceId, botId) { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(workspaceId, botId, reload) {
        while (true) {
            try {
                status = withContext(Dispatchers.IO) { api.computerStatus(workspaceId, botId) }
                error = null
            } catch (cause: Exception) {
                if (cause is CancellationException) throw cause
                error = failure(cause)
            }
            delay(4000)
        }
    }
    val desktop = status?.obj("desktop")
    val url = status?.string("url") ?: status?.obj("browser")?.string("url")
    val heading = when {
        feed.connected || status?.flag("connected") == true -> "Live"
        status == null && error == null -> "Checking computer status…"
        else -> desktop?.string("status") ?: status?.string("status") ?: "Waiting for the agent computer"
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFF141518)), contentAlignment = Alignment.Center) {
            val image = feed.frame
            if (image != null) Image(image.asImageBitmap(), "Live agent computer", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            else Text(if (feed.desktop || desktop?.flag("available") == true) "Waiting for E2B desktop frames" else "No live frame yet")
        }
        Text(vectraSafeStatus(heading), style = MaterialTheme.typography.titleMedium)
        url?.takeIf(String::isNotBlank)?.let { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        TextButton(onClick = { reload++ }) { Text("Refresh status") }
    }
}

@Composable
private fun VectraPreview(api: VectraApi, workspaceId: String, failure: (Throwable) -> String?) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var address by remember { mutableStateOf("") }
    var page by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(true) }
    var progress by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var web by remember { mutableStateOf<WebView?>(null) }
    fun go(raw: String) {
        val trimmed = raw.trim()
        val url = (if ("://" in trimmed) trimmed else "https://$trimmed").toHttpUrlOrNull()
        if (url == null || url.username.isNotEmpty() || url.password.isNotEmpty()) {
            error = "Enter a valid preview address."
            return
        }
        focus.clearFocus()
        error = null
        address = url.toString()
        if (page == address) web?.reload() else page = address
    }
    suspend fun resolve(port: Int) {
        busy = true
        error = null
        try {
            go(withContext(Dispatchers.IO) { api.preview(workspaceId, port) })
        } catch (cause: Exception) {
            error = failure(cause)
        } finally {
            busy = false
        }
    }
    LaunchedEffect(workspaceId) { resolve(3000) }
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp)) {
        optionsRow {
            TextButton(enabled = web?.canGoBack() == true, onClick = { web?.goBack() }) { Text("Back") }
            TextButton(enabled = web?.canGoForward() == true, onClick = { web?.goForward() }) { Text("Forward") }
            TextButton(enabled = page.isNotBlank(), onClick = { error = null; web?.reload() }) { Text("Reload") }
            TextButton(enabled = page.isNotBlank(), onClick = { error = openVectraUrl(context, web?.url ?: page) }) { Text("Open in browser") }
        }
        OutlinedTextField(
            address, { address = it }, Modifier.fillMaxWidth(), label = { Text("Preview URL or port") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = {
                val port = address.toIntOrNull()
                if (port != null && port in 1..65535) scope.launch { resolve(port) } else go(address)
            }),
            trailingIcon = { IconButton(onClick = {
                val port = address.toIntOrNull()
                if (port != null && port in 1..65535) scope.launch { resolve(port) } else go(address)
            }) { Icon(VectraIcons.ChevronRight, contentDescription = "Go") } },
        )
        optionsRow {
            listOf(3000, 4173, 5173, 8000, 8080).forEach { port ->
                FilterChip(selected = address.contains("://$port-"), onClick = { scope.launch { resolve(port) } }, label = { Text(":$port") })
            }
        }
        if (busy || (page.isNotBlank() && progress in 1..99)) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 6.dp)) }
        if (page.isNotBlank()) {
            AndroidView(
                modifier = Modifier.fillMaxWidth().weight(1f),
                factory = { viewContext ->
                    WebView(viewContext).apply {
                        @Suppress("SetJavaScriptEnabled")
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.setSupportMultipleWindows(false)
                        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                                request.url.scheme !in setOf("http", "https")

                            override fun onPageFinished(view: WebView, url: String) {
                                if (url.startsWith("http")) address = url
                            }

                            override fun onReceivedError(view: WebView, request: WebResourceRequest, webError: WebResourceError) {
                                if (request.isForMainFrame) error = "Could not open the preview. Check that your server is running."
                            }

                            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                                if (request.isForMainFrame) error = "Preview returned HTTP ${response.statusCode}."
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView, newProgress: Int) { progress = newProgress }
                        }
                        web = this
                    }
                },
                update = { view ->
                    if (view.tag != page) {
                        view.tag = page
                        view.loadUrl(page)
                    }
                },
                onRelease = { view ->
                    web = null
                    view.stopLoading()
                    view.destroy()
                },
            )
        }
    }
}
