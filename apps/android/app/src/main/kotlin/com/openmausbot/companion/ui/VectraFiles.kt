package com.openmausbot.companion.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraFile
import com.openmausbot.companion.core.VectraFileBody
import com.openmausbot.companion.core.VectraFileException
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val workspaceRoot = "/home/user/workspace"
private val rasterExtensions = setOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "avif")

private fun VectraFileBody.imageData(name: String): String? = when {
    mime?.startsWith("image/") == true -> base64 ?: text
    name.substringAfterLast('.', "").lowercase() in rasterExtensions -> base64 ?: text
    else -> null
}

private fun VectraFileBody.bytes(): ByteArray = base64?.let { Base64.decode(it, Base64.DEFAULT) } ?: text.toByteArray(Charsets.UTF_8)

@Composable
internal fun VectraFiles(api: VectraApi, workspaceId: String, failure: (Throwable) -> String?, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var folder by remember(workspaceId) { mutableStateOf(workspaceRoot) }
    var entries by remember(workspaceId) { mutableStateOf(emptyList<VectraFile>()) }
    var file by remember(workspaceId) { mutableStateOf<VectraFile?>(null) }
    var contents by remember(workspaceId) { mutableStateOf<VectraFileBody?>(null) }
    var loading by remember { mutableStateOf(true) }
    var exporting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableStateOf(0) }
    var filter by remember(folder) { mutableStateOf("") }
    var menu by remember(folder) { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<VectraFileBody?>(null) }
    var pendingExport by remember { mutableStateOf(false) }
    val activeFile = file
    val fullPath = activeFile?.let { "$folder/${it.name}" }
    val visibleEntries = entries.filter { it.name.contains(filter.trim(), ignoreCase = true) }

    fun describe(cause: Throwable) = if (cause is VectraFileException) cause.message else failure(cause)
    fun clipboard(label: String, value: String) {
        (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, value))
    }

    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val output = pending
        val archive = pendingExport
        pending = null
        pendingExport = false
        if (uri != null && (archive || output != null)) {
            exporting = true
            scope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        val sink = context.contentResolver.openOutputStream(uri)
                            ?: throw IOException("Could not open the selected destination.")
                        sink.use {
                            if (archive) api.writeWorkspaceArchive(workspaceId, it)
                            else if (output != null) it.write(output.bytes())
                        }
                    }
                    message = if (archive) "Workspace exported." else "File saved."
                } catch (cause: Exception) {
                    message = describe(cause)
                } finally {
                    exporting = false
                }
            }
        }
    }
    fun saveFile(target: VectraFile, alreadyLoaded: VectraFileBody? = null) {
        if (exporting) return
        val path = "$folder/${target.name}"
        exporting = true
        scope.launch {
            try {
                pending = alreadyLoaded ?: withContext(Dispatchers.IO) { api.workspaceFile(workspaceId, path) }
                pendingExport = false
                save.launch(target.name)
            } catch (cause: Exception) {
                message = describe(cause)
            } finally {
                exporting = false
            }
        }
    }
    fun copyLink(path: String) {
        if (exporting) return
        exporting = true
        scope.launch {
            try {
                val url = withContext(Dispatchers.IO) { api.shareWorkspaceFile(workspaceId, path) }
                clipboard("Workspace file link", url)
                message = "Share link copied."
            } catch (cause: Exception) {
                message = describe(cause)
            } finally {
                exporting = false
            }
        }
    }
    LaunchedEffect(workspaceId, folder, fullPath, refresh) {
        message = null
        loading = true
        contents = null
        try {
            if (fullPath == null) {
                entries = withContext(Dispatchers.IO) { api.workspaceFiles(workspaceId, folder) }
                    .sortedWith(compareByDescending<VectraFile> { it.directory }.thenBy { it.name.lowercase() })
            } else {
                contents = withContext(Dispatchers.IO) { api.workspaceFile(workspaceId, fullPath) }
            }
        } catch (cause: Exception) {
            message = describe(cause)
        } finally {
            loading = false
        }
    }
    fun back() {
        if (file != null) file = null
        else if (folder != workspaceRoot) folder = folder.substringBeforeLast('/')
        else onClose()
    }
    fun open(entry: VectraFile) {
        menu = null
        if (entry.directory) folder += "/${entry.name}" else file = entry
    }
    VectraPage(activeFile?.name ?: "Files", ::back) {
        if (activeFile == null) {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(enabled = folder != workspaceRoot, onClick = ::back) { Text("Parent folder") }
                TextButton(enabled = !loading, onClick = { refresh++ }) { Text("Refresh") }
                TextButton(enabled = !exporting, onClick = {
                    pending = null
                    pendingExport = true
                    save.launch("workspace-$workspaceId.tar.gz")
                }) { Text("Export workspace") }
            }
            SelectionContainer { Text(folder, Modifier.padding(horizontal = 16.dp), fontFamily = FontFamily.Monospace) }
            OutlinedTextField(filter, { filter = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                label = { Text("Filter files") }, singleLine = true)
        } else {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                TextButton(enabled = contents != null && !exporting, onClick = { saveFile(activeFile, contents) }) { Text("Save file") }
                TextButton(enabled = !exporting && fullPath != null, onClick = { fullPath?.let(::copyLink) }) { Text("Copy share link") }
            }
        }
        message?.let { Text(it, Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
        if (loading) {
            Text(if (activeFile == null) "Loading files…" else "Opening file…", Modifier.padding(16.dp))
        } else if (activeFile == null) {
            LazyColumn(Modifier.fillMaxSize()) {
                if (visibleEntries.isEmpty() && message == null) item {
                    Text(if (entries.isEmpty()) "This folder is empty." else "No matching files.", Modifier.padding(16.dp))
                }
                items(visibleEntries, key = { it.name }) { entry ->
                    Box {
                        ListItem(
                            headlineContent = { Text(entry.name) },
                            supportingContent = entry.size?.takeIf { !entry.directory }?.let { size -> { Text("$size bytes") } },
                            leadingContent = { Icon(if (entry.directory) VectraIcons.Folder else VectraIcons.File, contentDescription = null) },
                            trailingContent = {
                                if (entry.directory) Icon(VectraIcons.ChevronRight, contentDescription = null)
                                else TextButton(enabled = !exporting, onClick = { saveFile(entry) }) { Text("Save") }
                            },
                            modifier = Modifier.combinedClickable(onLongClick = { menu = entry.name }, onClick = { open(entry) }),
                        )
                        DropdownMenu(expanded = menu == entry.name, onDismissRequest = { menu = null }) {
                            DropdownMenuItem(text = { Text("Open") }, onClick = { open(entry) })
                            if (!entry.directory) DropdownMenuItem(text = { Text("Save as…") }, enabled = !exporting, onClick = {
                                menu = null
                                saveFile(entry)
                            })
                            DropdownMenuItem(text = { Text("Copy path") }, onClick = {
                                menu = null
                                clipboard("Workspace path", "$folder/${entry.name}")
                            })
                            if (!entry.directory) DropdownMenuItem(text = { Text("Create share link") }, enabled = !exporting, onClick = {
                                menu = null
                                copyLink("$folder/${entry.name}")
                            })
                        }
                    }
                }
            }
        } else {
            val body = contents
            if (body != null) VectraFilePreview(body, activeFile.name)
            else if (message != null) TextButton(onClick = { refresh++ }) { Text("Retry") }
        }
    }
}

@Composable
internal fun VectraFilePreview(body: VectraFileBody, name: String) {
    val imageData = body.imageData(name)
    var image by remember(body, name) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var decoded by remember(body, name) { mutableStateOf(imageData == null) }
    LaunchedEffect(body, name) {
        if (imageData != null) {
            image = withContext(Dispatchers.Default) { decodeVectraImage(imageData) }
            decoded = true
        }
    }
    val bitmap = image
    if (bitmap != null) {
        Image(bitmap.asImageBitmap(), "Image contents: $name", Modifier.fillMaxSize().padding(12.dp), contentScale = ContentScale.Fit)
    } else if (decoded) {
        val text = when {
            imageData != null -> "This image could not be decoded."
            body.base64 != null && body.mime?.startsWith("text/") == true -> runCatching { body.bytes().toString(Charsets.UTF_8) }.getOrDefault("")
            body.base64 != null -> "This file can be saved to open with another app."
            else -> body.text.ifEmpty { "Empty file" }
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
            SelectionContainer { Text(text, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace) }
        }
    }
}
