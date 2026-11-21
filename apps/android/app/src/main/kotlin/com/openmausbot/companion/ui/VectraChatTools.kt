package com.openmausbot.companion.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraAttachment
import com.openmausbot.companion.core.VectraMessage
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.objects
import com.openmausbot.companion.core.safeVectraText
import com.openmausbot.companion.core.string
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

internal enum class VectraChatTool { History, Commands, Models, Agent, GitHub, Notifications }

@Composable
internal fun VectraChatChoices(
    tool: VectraChatTool,
    api: VectraApi,
    workspace: String,
    bot: String,
    thread: String,
    failure: (Throwable) -> String?,
    onDismiss: () -> Unit,
    onThread: (String) -> Unit,
    onCommand: (String) -> Unit,
    onNew: () -> Unit,
) {
    var query by remember(tool) { mutableStateOf("") }
    var options by remember(tool) { mutableStateOf(emptyList<Triple<String, String, String>>()) }
    var ready by remember(tool) { mutableStateOf(false) }
    var error by remember(tool) { mutableStateOf<String?>(null) }
    LaunchedEffect(tool, workspace, bot) {
        try {
            options = withContext(Dispatchers.IO) {
                when (tool) {
                    VectraChatTool.History -> api.conversations(workspace, bot).objects("conversations")
                        .filter { it.string("source") != "group" }
                        .mapNotNull { row -> row.string("sessionId")?.let { Triple(it, row.string("title").orEmpty().ifBlank { "Conversation" }, "") } }
                    VectraChatTool.Commands -> api.chatCommands(workspace).mapNotNull { row ->
                        row.string("command")?.let { Triple(it.trimStart('/'), "/${it.trimStart('/')}", row.string("description").orEmpty()) }
                    }.ifEmpty { listOf(Triple("model", "/model", "Choose a model"), Triple("new", "/new", "Start a conversation")) }
                    VectraChatTool.Models -> api.instanceModels(workspace).map { Triple(it, it, "") }
                    else -> emptyList()
                }
            }
        } catch (cause: Exception) {
            error = failure(cause)
        } finally {
            ready = true
        }
    }
    val title = when (tool) {
        VectraChatTool.History -> "Conversation history"
        VectraChatTool.Commands -> "Commands"
        VectraChatTool.Models -> "Models"
        else -> tool.name
    }
    AlertDialog(
        title = { Text(title) },
        onDismissRequest = onDismiss,
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search ${title.lowercase()}") }, singleLine = true)
                if (!ready) Text("Loading…")
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                val rows = options.filter { it.second.contains(query, true) || it.third.contains(query, true) }
                if (ready && rows.isEmpty() && error == null) Text("No matches.")
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    items(rows) { (id, label, detail) ->
                        ListItem(
                            headlineContent = { Text(label) },
                            supportingContent = when {
                                tool == VectraChatTool.History && id == thread -> ({ Text("Current conversation") })
                                detail.isNotBlank() -> ({ Text(detail) })
                                else -> null
                            },
                            modifier = Modifier.clickable {
                                onDismiss()
                                if (tool == VectraChatTool.History) onThread(id)
                                else if (tool == VectraChatTool.Models) onCommand("/model $id")
                                else onCommand("/$id")
                            },
                        )
                    }
                }
                if (tool == VectraChatTool.Models && query.isNotBlank()) TextButton(onClick = {
                    onDismiss()
                    onCommand("/model ${query.trim()}")
                }) { Text("Use custom model") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        dismissButton = if (tool == VectraChatTool.History) ({
            Button(onClick = { onDismiss(); onNew() }) { Text("New conversation") }
        }) else null,
    )
}

@Composable
internal fun VectraActionCard(message: VectraMessage, api: VectraApi, workspace: String, failure: (Throwable) -> String?) {
    val event = message.payload ?: return
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var busy by remember(message.id) { mutableStateOf(false) }
    var resolved by remember(message.id) { mutableStateOf<String?>(null) }
    var error by remember(message.id) { mutableStateOf<String?>(null) }
    var page by remember(message.id) { mutableStateOf(0) }
    var custom by remember(message.id) { mutableStateOf(false) }
    var customValue by remember(message.id) { mutableStateOf("") }
    var downloaded by remember(message.id) { mutableStateOf<VectraAttachment?>(null) }
    var openFile by remember(message.id) { mutableStateOf(false) }
    val fileName = event.string("name") ?: "Attachment"
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val data = downloaded
        if (uri != null && data != null) scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val stream = context.contentResolver.openOutputStream(uri) ?: throw IOException("Could not save the file.")
                    stream.use { it.write(data.bytes) }
                }
                resolved = "File saved."
            } catch (cause: Exception) { error = failure(cause) }
        }
    }
    fun run(label: String? = null, action: () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) { action() }
                resolved = label
            } catch (cause: Exception) { error = failure(cause) }
            finally { busy = false }
        }
    }
    fun file(saveAs: Boolean, share: Boolean = false) {
        if (busy) return
        val fileId = event.string("fileId")
        val url = event.string("url")
        if (fileId == null) {
            if (url != null) error = openVectraUrl(context, url)
            return
        }
        busy = true
        scope.launch {
            try {
                downloaded = downloaded ?: withContext(Dispatchers.IO) { api.chatFile(workspace, fileId) }
                val loaded = downloaded
                when {
                    loaded == null -> Unit
                    share -> shareVectraAttachment(context, loaded, fileName)
                    saveAs -> save.launch(fileName)
                    else -> openFile = true
                }
            } catch (cause: Exception) {
                error = failure(cause)
            } finally { busy = false }
        }
    }
    val heading = when (message.kind) {
        "approve", "approval" -> "Approval needed"
        "ask" -> "The agent has a question"
        "picker" -> event.string("title") ?: "Choose an option"
        else -> fileName
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(heading, style = MaterialTheme.typography.titleSmall)
            if (message.text.isNotBlank()) Text(message.text)
            resolved?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (message.kind == "file") {
                optionsRow {
                    TextButton(enabled = !busy, onClick = { file(false) }) { Text("Open file") }
                    TextButton(enabled = !busy, onClick = { file(true) }) { Text("Save file") }
                    TextButton(enabled = !busy, onClick = { file(false, share = true) }) { Text("Share") }
                }
            } else if (resolved == null) {
                when (message.kind) {
                    "approve", "approval" -> optionsRow {
                        mapOf("once" to "Once", "session" to "Session", "always" to "Always", "deny" to "Deny").forEach { (key, label) ->
                            TextButton(enabled = !busy, onClick = { run(label) { api.approve(workspace, key) } }) { Text(label) }
                        }
                    }
                    "ask", "picker" -> {
                        val picks = if (message.kind == "ask") {
                            (event["choices"] as? JsonArray).orEmpty().mapIndexedNotNull { index, choice ->
                                (choice as? JsonPrimitive)?.contentOrNull?.let { Triple(it, it, index) }
                            }
                        } else event.objects("options").mapIndexedNotNull { index, option ->
                            option.string("value")?.let { Triple(it, option.string("label") ?: it, index) }
                        }
                        picks.drop(page * 10).take(10).forEach { (value, label, index) ->
                            OutlinedButton(enabled = !busy, onClick = {
                                if (value == "__custom__") custom = true
                                else if (message.kind == "ask") run("Answered: $label") { api.answer(workspace, message.id, value, index) }
                                else run("Selected: $label") { api.pick(workspace, message.id, value, event.string("kind")) }
                            }) { Text(label) }
                        }
                        if (picks.size > 10) optionsRow {
                            TextButton(enabled = page > 0, onClick = { page-- }) { Text("Previous") }
                            TextButton(enabled = (page + 1) * 10 < picks.size, onClick = { page++ }) { Text("Next") }
                        }
                        TextButton(enabled = !busy, onClick = { custom = true }) {
                            Text(if (message.kind == "ask") "Type your own" else "Custom option")
                        }
                    }
                }
            }
        }
    }
    if (custom) AlertDialog(
        title = { Text(heading) },
        text = { OutlinedTextField(customValue, { customValue = it }, label = { Text("Your answer") }) },
        onDismissRequest = { custom = false },
        dismissButton = { TextButton(onClick = { custom = false }) { Text("Cancel") } },
        confirmButton = { Button(enabled = customValue.isNotBlank(), onClick = {
            val value = customValue.trim()
            custom = false
            if (message.kind == "ask") run("Answered: $value") { api.answer(workspace, message.id, value) }
            else run("Selected: $value") { api.pick(workspace, message.id, value, event.string("kind")) }
        }) { Text("Use") } },
    )
    if (openFile) AlertDialog(
        title = { Text(fileName) },
        text = {
            val data = downloaded
            if (data != null) VectraDownloadedChatFile(data, fileName)
        },
        onDismissRequest = { openFile = false },
        confirmButton = { TextButton(onClick = { openFile = false }) { Text("Close") } },
    )
}

private suspend fun shareVectraAttachment(context: Context, data: VectraAttachment, name: String) {
    val displayName = name.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[\\x00-\\x1f]"), "_").take(180).ifBlank { "attachment" }
    val uri = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, "vectra-attachments").apply { mkdirs() }
        directory.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
        val safeName = displayName.takeUnless { it in setOf(".", "..") } ?: "attachment"
        val target = File(directory, safeName)
        target.writeBytes(data.bytes)
        FileProvider.getUriForFile(context, "${context.packageName}.transcripts", target)
    }
    val send = Intent(Intent.ACTION_SEND).apply {
        type = data.mime?.substringBefore(';') ?: "application/octet-stream"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, displayName)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, "Share attachment"))
}

@Composable
private fun VectraDownloadedChatFile(data: VectraAttachment, name: String) {
    if (data.mime?.startsWith("image/") == true) {
        VectraFilePreview(
            com.openmausbot.companion.core.VectraFileBody("", java.util.Base64.getEncoder().encodeToString(data.bytes), data.mime),
            name,
        )
    } else {
        val text = if (data.mime?.startsWith("text/") == true || name.substringAfterLast('.') in setOf("txt", "md", "json", "csv", "log")) {
            safeVectraText(data.bytes.toString(Charsets.UTF_8))
        } else "Save this attachment to open it with another app."
        SelectionContainer { Text(text.take(16_000)) }
    }
}

internal fun readVectraAttachment(context: Context, uri: Uri): VectraAttachment {
    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
    } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "attachment"
    val input = context.contentResolver.openInputStream(uri) ?: throw IOException("Could not open attachment.")
    val out = ByteArrayOutputStream()
    input.use {
        val buffer = ByteArray(8192)
        while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            if (out.size() + count > 3 * 1024 * 1024) throw IOException("Select files smaller than 3 MB.")
            out.write(buffer, 0, count)
        }
    }
    return VectraAttachment(name, context.contentResolver.getType(uri), out.toByteArray())
}
