package com.openmausbot.companion.core

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.URI
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class VectraAgent(val id: String, val name: String)
data class VectraWorkspace(
    val id: String,
    val name: String,
    val state: String = "",
    val runtime: String = "xibecode",
    val free: Boolean = false,
    val pastDue: Boolean = false,
    val planId: String? = null,
    val liveMessage: String? = null,
    val lastError: String? = null,
    val paidUntil: String? = null,
)
data class VectraDashboard(val workspaces: List<VectraWorkspace>, val freeAvailable: Int, val freeLimit: Int)
data class VectraMessage(
    val id: String,
    val role: String,
    val text: String,
    val kind: String = "text",
    val payload: JsonObject? = null,
)
data class VectraAttachment(val name: String, val mime: String?, val bytes: ByteArray)
data class VectraFile(val name: String, val directory: Boolean, val size: Int? = null)
data class VectraFileBody(val text: String, val base64: String?, val mime: String?)
class VectraFileException(message: String) : IOException(message)

class VectraHttpException(
    val status: Int,
    val authenticated: Boolean,
    message: String,
) : IOException(message)

const val VECTRA_API_ORIGIN = "https://infra.xibeai.in"

private val hiddenEvents = setOf("tool", "progress", "thinking", "reasoning", "status", "usage", "ready")
private val jsonMedia = "application/json".toMediaType()
private val vectraJson = Json { ignoreUnknownKeys = true }

fun visibleVectraEvent(event: JsonObject): VectraMessage? {
    val type = event.string("type") ?: return null
    if (type in hiddenEvents) return null
    if (type !in setOf("text", "user", "file", "approval", "ask", "error")) return null
    val text = event.string("text").orEmpty()
    if ((type == "text" || type == "user") && text.isBlank()) return null
    return VectraMessage(
        id = (event.string("messageId") ?: event.string("id")).orEmpty(),
        role = if (type == "user") "user" else "agent",
        text = text,
    )
}

class VectraApi(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(40, java.util.concurrent.TimeUnit.SECONDS)
        .build(),
    var origin: String = VECTRA_API_ORIGIN,
    var token: String = "",
) {
    private val eventHttp = http.newBuilder()
        .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
        .callTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
        .build()
    private val workspaceHttp = http.newBuilder()
        .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
        .build()
    private val provisionHttp = http.newBuilder()
        .readTimeout(280, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    fun login(email: String, password: String, register: Boolean = false): String {
        val body = buildJsonObject {
            put("email", email)
            put("password", password)
        }
        val path = if (register) "/api/auth/register" else "/api/auth/login"
        val payload = call("POST", path, body, authorized = false)
        token = payload.string("token")?.takeIf { it.isNotBlank() }
            ?: throw IOException("The server did not return a sign-in token.")
        return token
    }

    fun dashboard(): VectraDashboard {
        val payload = call("GET", "/api/instances")
        val quota = payload.obj("freeQuota")
        val limit = (quota["limit"] as? JsonPrimitive)?.intOrNull ?: 1
        val used = (quota["used"] as? JsonPrimitive)?.intOrNull ?: 0
        val available = (quota["available"] as? JsonPrimitive)?.intOrNull ?: (limit - used)
        val rows = payload.array("instances").mapNotNull { (it as? JsonObject)?.toWorkspace() }
        return VectraDashboard(rows, available, limit)
    }

    fun workspaces(): List<VectraWorkspace> = dashboard().workspaces

    fun cliVersion(instanceId: String) = call("GET", "/api/instances/${segment(instanceId)}/cli-version")
    fun cliUpdate(instanceId: String) =
        call("POST", "/api/instances/${segment(instanceId)}/cli-update", client = provisionHttp)

    fun workspace(instanceId: String): VectraWorkspace =
        call("GET", "/api/instances/${segment(instanceId)}", client = workspaceHttp)
            .obj("instance").toWorkspace() ?: throw IOException("Workspace information is missing.")

    fun recreateWorkspace(instanceId: String) =
        call("POST", "/api/instances/${segment(instanceId)}/recreate", client = provisionHttp)

    fun logs(instanceId: String, source: String) =
        call("GET", "/api/instances/${segment(instanceId)}/logs?source=${segment(source)}&lines=200", client = workspaceHttp)

    fun pairing(instanceId: String) =
        call("GET", "/api/instances/${segment(instanceId)}/pairing", client = workspaceHttp)

    fun approvePairing(instanceId: String, code: String) =
        call("POST", "/api/instances/${segment(instanceId)}/pairing", buildJsonObject {
            put("code", code)
            put("platform", "telegram")
        }, client = workspaceHttp)

    fun models(provider: String) =
        call("GET", "/api/models?provider=${segment(provider)}").objects("models")

    fun instanceModels(instanceId: String): List<String> {
        val data = call("GET", "/api/instances/${segment(instanceId)}/models", client = workspaceHttp)
        return (data.array("free") + data.array("models")).mapNotNull { item ->
            when (item) {
                is JsonPrimitive -> item.contentOrNull
                is JsonObject -> item.string("id") ?: item.string("name")
                else -> null
            }
        }.distinct()
    }

    fun githubStatus(instanceId: String) =
        call("GET", "/api/instances/${segment(instanceId)}/github-auth", client = workspaceHttp)

    fun githubStart(instanceId: String, requestId: String, conversationId: String? = null) =
        call("POST", "/api/instances/${segment(instanceId)}/github-auth", buildJsonObject {
            put("action", "start")
            put("requestId", requestId)
            conversationId?.let { put("conversationId", it) }
        }, client = workspaceHttp)

    fun githubDone(instanceId: String) =
        call("POST", "/api/instances/${segment(instanceId)}/github-auth", buildJsonObject { put("action", "done") }, client = workspaceHttp)

    fun githubCancel(instanceId: String) =
        call("DELETE", "/api/instances/${segment(instanceId)}/github-auth", client = workspaceHttp)

    fun githubToken(instanceId: String, chatId: String, source: String, requestId: String): String {
        require(source in setOf("cli", "mcp"))
        val result = call("POST", "/api/instances/${segment(instanceId)}/github-token", buildJsonObject {
            put("botId", "github")
            put("chatId", chatId)
            put("source", source)
            put("confirmation", "Send token to this chat")
            put("requestId", requestId)
        }, client = workspaceHttp)
        val credential = result.string("token")
        if (credential.isNullOrBlank() || result.string("botId") != "github" ||
            result.string("chatId") != chatId || result.string("source") != source
        ) throw IOException("The GitHub response could not be verified.")
        return credential
    }

    fun managedMcpCatalog() = call("GET", "/api/managed-mcp/catalog")

    fun managedMcp(instanceId: String, botId: String, action: JsonObject) =
        call("POST", "/api/instances/${segment(instanceId)}/bots/${segment(botId)}/plugin-api", action, client = workspaceHttp)

    fun conversations(instanceId: String, botId: String) =
        call("GET", "/api/instances/${segment(instanceId)}/chat/conversations?botId=${segment(botId)}")

    fun newConversation(instanceId: String, botId: String): String {
        val response = call(
            "POST", "/api/instances/${segment(instanceId)}/chat/conversations",
            buildJsonObject { put("botId", botId) }, client = workspaceHttp,
        )
        return response.string("active") ?: response.string("sessionId")
            ?: throw IOException("No new conversation was returned.")
    }

    fun transcript(instanceId: String, botId: String, chatId: String): List<VectraMessage> =
        call("GET", "/api/instances/${segment(instanceId)}/chat/conversations/${segment(chatId)}?botId=${segment(botId)}", client = workspaceHttp)
            .objects("messages").mapNotNull { message ->
                val role = when (message.string("role")) {
                    "user" -> "user"
                    "assistant", "agent", "error" -> "agent"
                    else -> return@mapNotNull null
                }
                if (message.flag("sensitive") == true && botId != "github") return@mapNotNull null
                val content = message.string("content")?.takeIf(String::isNotBlank) ?: return@mapNotNull null
                VectraMessage(message.string("id").orEmpty(), role, content)
            }.fold(mutableListOf<VectraMessage>()) { rows, row ->
                val previous = rows.lastOrNull()
                if (row.role != "agent" || previous?.role != "agent" || previous.text != row.text) rows.add(row)
                rows
            }

    fun agents(instanceId: String): List<VectraAgent> {
        val rows = call("GET", "/api/instances/${segment(instanceId)}/bots").array("bots")
        return rows.map { row ->
            val item = row.jsonObject
            VectraAgent(item.string("id").orEmpty(), item.string("name") ?: item.string("id").orEmpty())
        }.filter { it.id.isNotEmpty() }
    }

    fun conversation(instanceId: String, botId: String): String {
        val listed = conversations(instanceId, botId)
        val entries = listed.objects("conversations").filter { it.string("source") != "group" }
        val active = listed.string("active")
        if (!active.isNullOrBlank() && entries.any { it.string("sessionId") == active }) return active
        val existing = entries.firstOrNull { !it.string("sessionId").isNullOrEmpty() }
        existing?.string("sessionId")?.let { return it }
        return newConversation(instanceId, botId)
    }

    fun send(instanceId: String, botId: String, chatId: String, text: String, attachments: List<VectraAttachment> = emptyList()) {
        val files = attachments.take(12).map { attachment ->
            val publicUrl = if (attachment.mime?.startsWith("image/") == true) {
                runCatching { publishMedia(instanceId, attachment) }.getOrElse { cause ->
                    if (cause is VectraHttpException && cause.status == 401) throw cause
                    null
                }
            } else null
            buildJsonObject {
                put("name", attachment.name)
                attachment.mime?.let { put("mime", it) }
                if (publicUrl != null) put("url", publicUrl)
                else put("contentBase64", Base64.getEncoder().encodeToString(attachment.bytes))
            }
        }
        call(
            "POST",
            "/api/instances/${segment(instanceId)}/chat",
            buildJsonObject {
                if (text.isNotEmpty()) put("text", text)
                put("botId", botId)
                put("chatId", chatId)
                if (files.isNotEmpty()) put("files", kotlinx.serialization.json.JsonArray(files))
            },
            client = workspaceHttp,
        )
    }

    private fun publishMedia(instanceId: String, file: VectraAttachment): String? {
        val request = Request.Builder().url(origin.trimEnd('/') + "/api/instances/${segment(instanceId)}/media")
            .header("Authorization", "Bearer $token")
            .post(
                MultipartBody.Builder().setType(MultipartBody.FORM)
                    .addFormDataPart("file", file.name, file.bytes.toRequestBody(file.mime?.toMediaTypeOrNull()))
                    .build(),
            ).build()
        workspaceHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw VectraHttpException(response.code, true, "Could not upload the image.")
            return vectraJson.parseToJsonElement(response.body?.string().orEmpty()).jsonObject.string("url")
        }
    }

    fun chatStatus(id: String, chatId: String) =
        call("GET", "/api/instances/${segment(id)}/chat/status?sessionId=${segment(chatId)}")

    fun steer(id: String, botId: String, chatId: String, text: String) =
        call("POST", "/api/instances/${segment(id)}/chat/steer", buildJsonObject {
            put("botId", botId)
            put("chatId", chatId)
            put("text", text)
        })

    fun chatCommands(id: String) =
        call("GET", "/api/instances/${segment(id)}/chat/commands").objects("commands")

    fun group(id: String) = call("GET", "/api/instances/${segment(id)}/group")

    fun sendGroup(id: String, text: String, requestId: String, mentions: Set<String>) =
        call("POST", "/api/instances/${segment(id)}/group", buildJsonObject {
            put("text", text)
            put("requestId", requestId)
            put("mentions", kotlinx.serialization.json.JsonArray(mentions.map(::JsonPrimitive)))
        }, client = workspaceHttp)

    fun botProfiles(id: String) = call("GET", "/api/instances/${segment(id)}/bots").objects("bots")

    fun saveBot(id: String, botId: String?, fields: JsonObject) = if (botId == null) {
        call("POST", "/api/instances/${segment(id)}/bots", fields, client = workspaceHttp)
    } else {
        call("PATCH", "/api/instances/${segment(id)}/bots/${segment(botId)}", fields, client = workspaceHttp)
    }

    fun uploadBotAvatar(id: String, botId: String, file: VectraAttachment) {
        val request = Request.Builder().url(origin.trimEnd('/') + "/api/instances/${segment(id)}/bots/${segment(botId)}/avatar")
            .header("Authorization", "Bearer $token")
            .put(file.bytes.toRequestBody(file.mime?.toMediaTypeOrNull())).build()
        workspaceHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw VectraHttpException(response.code, true, "Could not upload the agent picture.")
        }
    }

    fun chatFile(id: String, fileId: String): VectraAttachment {
        val url = origin.trimEnd('/') + "/api/instances/${segment(id)}/chat/files/${segment(fileId)}"
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        workspaceHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw VectraHttpException(response.code, true, "Could not download the file.")
            val body = response.body ?: throw IOException("The file body is missing.")
            return VectraAttachment(fileId, response.header("Content-Type"), body.bytes())
        }
    }

    fun workspaceFiles(instanceId: String, path: String = "/home/user/workspace"): List<VectraFile> {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/workspace?path=${segment(path)}", client = workspaceHttp)
        val rows = payload.objects("entries").ifEmpty { payload.objects("files") }
        return rows.mapNotNull { row ->
            val name = (row.string("name") ?: row.string("path")?.substringAfterLast('/'))
                ?.takeIf { it.isNotBlank() && '/' !in it && it !in setOf(".", "..") } ?: return@mapNotNull null
            VectraFile(name, row.flag("isDirectory") == true || row.string("type") in setOf("directory", "dir", "folder"), row.number("size"))
        }.distinctBy(VectraFile::name)
    }

    fun files(instanceId: String, path: String = "/home/user/workspace"): List<String> =
        workspaceFiles(instanceId, path).map { it.name }

    fun workspaceFile(instanceId: String, path: String): VectraFileBody {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/workspace/file?path=${segment(path)}", client = workspaceHttp)
        if (payload.flag("success") == false || payload.flag("error") == true) {
            throw VectraFileException("Could not read this workspace file.")
        }
        val content = payload.string("content") ?: payload.string("text").orEmpty()
        val base64 = payload.string("base64") ?: payload.string("contentBase64")
            ?: content.takeIf { payload.string("encoding") == "base64" }
            ?: content.takeIf { it.startsWith("data:") && ";base64," in it }?.substringAfter(";base64,")
        val mime = payload.string("mime") ?: payload.string("mimeType")
            ?: content.takeIf { it.startsWith("data:") }?.substringAfter("data:")?.substringBefore(';')
        val imageMime = when (path.substringAfterLast('.', "").lowercase()) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "bmp" -> "image/bmp"
            "avif" -> "image/avif"
            else -> mime?.takeIf { it.startsWith("image/") && it != "image/svg+xml" }
        }
        if (base64 == null && imageMime != null) {
            return workspaceImage(instanceId, path, imageMime)
        }
        return VectraFileBody(content.takeIf { base64 == null }.orEmpty(), base64, mime)
    }

    private fun workspaceImage(instanceId: String, path: String, mime: String): VectraFileBody {
        if (!path.startsWith("/home/user/workspace/") || '\u0000' in path || path.split('/').any { it == "." || it == ".." }) {
            throw VectraFileException("Invalid workspace image path.")
        }
        val pathArgument = Base64.getEncoder().encodeToString(path.toByteArray(Charsets.UTF_8))
        // Exec caps stdout at 80,000 characters. Each 48 KiB chunk fits after base64 encoding.
        val chunkSize = 48 * 1024
        val maxSize = 8 * 1024 * 1024
        val reader = """
            import base64, os, pathlib, stat, sys
            root = pathlib.Path("/home/user/workspace").resolve()
            target = pathlib.Path(os.fsdecode(base64.b64decode(sys.argv[1]))).resolve(strict=True)
            if root not in target.parents or not target.is_file():
                sys.exit(3)
            with target.open("rb") as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode):
                    sys.exit(3)
                print(f"{info.st_size}:{info.st_ino}:{info.st_mtime_ns}")
                if info.st_size <= $maxSize:
                    source.seek(int(sys.argv[2]))
                    print(base64.b64encode(source.read($chunkSize)).decode("ascii"))
        """.trimIndent()
        val output = ByteArrayOutputStream()
        var revision: String? = null
        do {
            val offset = output.size()
            val result = exec(instanceId, "python3 -c '$reader' '$pathArgument' $offset")
            val stdout = result.string("stdout").orEmpty()
            val version = stdout.substringBefore('\n').trim()
            val size = version.substringBefore(':').toIntOrNull()
            if (result.number("exitCode") != 0 || size == null || size < 0) {
                throw VectraFileException("Could not read this workspace image.")
            }
            if (size > maxSize) throw VectraFileException("This image is larger than 8 MB.")
            if (revision != null && revision != version) {
                throw VectraFileException("The image changed while it was opening. Try again.")
            }
            revision = version
            val bytes = try {
                Base64.getDecoder().decode(stdout.substringAfter('\n', "").trim())
            } catch (_: IllegalArgumentException) {
                throw VectraFileException("The sandbox returned invalid image data.")
            }
            if (bytes.size != minOf(chunkSize, size - offset)) {
                throw VectraFileException("The sandbox returned incomplete image data.")
            }
            output.write(bytes)
        } while (output.size() < size)
        return VectraFileBody("", Base64.getEncoder().encodeToString(output.toByteArray()), mime)
    }

    fun file(instanceId: String, path: String): String = workspaceFile(instanceId, path).text

    fun shareWorkspaceFile(instanceId: String, path: String): String {
        val response = call("POST", "/api/instances/${segment(instanceId)}/workspace/share", buildJsonObject {
            put("path", path)
        })
        return response.obj("share").string("url") ?: response.string("url")
            ?: throw IOException("No share link was returned.")
    }

    fun writeWorkspaceArchive(instanceId: String, destination: OutputStream) {
        val request = Request.Builder()
            .url(origin.trimEnd('/') + "/api/instances/${segment(instanceId)}/workspace/export")
            .header("Authorization", "Bearer $token").header("Accept", "application/gzip").build()
        provisionHttp.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw VectraHttpException(response.code, true, "Could not export workspace (HTTP ${response.code}).")
            }
            val body = response.body ?: throw IOException("Workspace archive is missing.")
            body.byteStream().use { input -> input.copyTo(destination) }
        }
    }

    fun preview(instanceId: String, port: Int = 3000): String {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/preview?port=$port")
        return payload.string("host") ?: throw IOException("No preview host")
    }

    fun account() = call("GET", "/api/me").obj("user")
    fun accountEmail(): String = account().string("email").orEmpty()

    fun billingConfig() = call("GET", "/api/billing/config")

    fun saveProvider(instanceId: String, provider: String, model: String, apiKey: String) {
        call(
            "PUT",
            "/api/instances/${segment(instanceId)}/config",
            buildJsonObject {
                put("provider", provider)
                put("model", model)
                put("apiKey", apiKey)
                put("restart", true)
            },
        )
    }

    fun groupText(instanceId: String): String {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/group")
        return payload.array("messages").joinToString("\n") { row ->
            val item = row.jsonObject
            item.string("text") ?: ""
        }.trim()
    }

    fun createWorkspace(name: String): VectraWorkspace = call(
        "POST",
        "/api/instances",
        buildJsonObject {
            put("name", name)
            put("runtime", "supercharge")
        },
        client = workspaceHttp,
    ).obj("instance").toWorkspace() ?: throw IOException("The server did not return the new workspace.")

    fun wake(instanceId: String) = call("POST", "/api/instances/${segment(instanceId)}/wake", client = workspaceHttp)
    fun restartWorkspace(instanceId: String) = call("POST", "/api/instances/${segment(instanceId)}/restart", client = workspaceHttp)
    fun deleteWorkspace(instanceId: String) = call("DELETE", "/api/instances/${segment(instanceId)}", client = workspaceHttp)
    fun config(instanceId: String) = call("GET", "/api/instances/${segment(instanceId)}/config", client = workspaceHttp)
    fun saveConfig(instanceId: String, body: JsonObject) =
        call("PUT", "/api/instances/${segment(instanceId)}/config", body, client = workspaceHttp)

    fun exec(instanceId: String, command: String, cwd: String = "/home/user/workspace") = call(
        "POST",
        "/api/instances/${segment(instanceId)}/exec",
        buildJsonObject {
            put("command", command)
            put("cwd", cwd.ifBlank { "/home/user/workspace" })
            put("timeout", 120)
        },
        client = provisionHttp,
    )

    fun approve(instanceId: String, choice: String) = call(
        "POST",
        "/api/instances/${segment(instanceId)}/chat/approve",
        buildJsonObject { put("choice", choice) },
    )

    fun answer(instanceId: String, ref: String, answer: String, index: Int? = null) = call(
        "POST",
        "/api/instances/${segment(instanceId)}/chat/answer",
        buildJsonObject {
            put("id", ref)
            put("answer", answer)
            index?.let { put("index", it) }
        },
    )

    fun pick(instanceId: String, ref: String, value: String, kind: String?) = call(
        "POST", "/api/instances/${segment(instanceId)}/chat/pick", buildJsonObject {
            put("id", ref)
            put("value", value)
            kind?.let { put("kind", it) }
        },
    )

    fun startBrowserHandoff(instanceId: String, handoffId: String, botId: String, sessionId: String): Long {
        val result = call("POST", "/api/instances/${segment(instanceId)}/computer/handoff", buildJsonObject {
            put("action", "start")
            put("handoffId", handoffId)
            put("botId", botId)
            put("sessionId", sessionId)
            put("minutes", 10)
        })
        val expiry = (result["expiresAt"] as? JsonPrimitive)?.longOrNull
        if (result.flag("ok") != true || result.flag("handoff") != true ||
            result.string("handoffId") != handoffId || expiry == null
        ) throw IOException("The sandbox did not confirm browser control and its expiry.")
        return expiry
    }

    fun stopBrowserHandoff(instanceId: String, handoffId: String, botId: String) {
        val result = call("POST", "/api/instances/${segment(instanceId)}/computer/handoff", buildJsonObject {
            put("action", "stop")
            put("handoffId", handoffId)
            put("botId", botId)
        })
        if (result.flag("ok") != true || result.flag("handoff") != false || result.string("handoffId") != handoffId) {
            throw IOException("The sandbox did not confirm that browser control was returned.")
        }
    }

    fun browserVncTicket(instanceId: String, handoffId: String, botId: String): String {
        val result = call("POST", "/api/instances/${segment(instanceId)}/computer/vnc-ticket", buildJsonObject {
            put("handoffId", handoffId)
            put("botId", botId)
        })
        val address = result.string("wsUrl").orEmpty()
        val uri = runCatching { URI(address) }.getOrNull()
        if (uri?.scheme !in setOf("wss", "ws") || uri?.host.isNullOrBlank() ||
            uri?.rawUserInfo != null || uri?.rawFragment != null ||
            (uri?.scheme == "ws" && origin.startsWith("https:", ignoreCase = true))
        ) throw IOException("The sandbox returned an invalid desktop display address.")
        return address
    }

    fun skillCatalog(offset: Int = 0) = call("GET", "/api/marketplace/skills?limit=48&offset=$offset")

    fun searchSkills(query: String) = call("GET", "/api/marketplace/search?q=${segment(query)}")

    fun skill(owner: String, name: String) =
        call("GET", "/api/marketplace/items/${segment(owner)}/${segment(name)}")

    fun skills(): List<String> = skillCatalog().let { payload ->
        payload.objects("items").ifEmpty { payload.objects("skills") }
    }.mapNotNull { it.string("name") ?: it.string("id") }

    fun pluginRuntime(id: String) = call("GET", "/api/instances/${segment(id)}/plugin-runtime")

    fun updatePluginRuntime(id: String, botId: String) =
        call("POST", "/api/instances/${segment(id)}/plugin-runtime", buildJsonObject {
            put("botId", botId)
            put("confirm", true)
        }, client = provisionHttp)

    fun pollinationsStatus() = call("GET", "/api/pollinations/start")
    fun pollinationsApplyAll() = call("PUT", "/api/pollinations/start")
    fun pollinationsDisconnect() = call("DELETE", "/api/pollinations/start")

    fun pollenConnect(instanceId: String? = null): String {
        val payload = call("POST", "/api/pollinations/start", buildJsonObject {
            instanceId?.takeIf { it.isNotBlank() }?.let { put("instanceId", it) }
            put("fromApp", true)
        })
        return payload.string("url") ?: throw IOException("Connect URL missing")
    }

    fun createOrder(
        planId: String,
        currency: String,
        name: String? = null,
        instanceId: String? = null,
        runtime: String = "supercharge",
    ) = call("POST", "/api/billing/create-order", buildJsonObject {
        put("purpose", if (instanceId == null) "new_instance" else "renew")
        name?.let { put("name", it) }
        instanceId?.let { put("instanceId", it) }
        put("currency", currency)
        put("runtime", runtime)
        put("planId", planId)
    })

    fun verifyPayment(orderId: String, paymentId: String, signature: String) =
        call("POST", "/api/billing/verify", buildJsonObject {
            put("razorpay_order_id", orderId)
            put("razorpay_payment_id", paymentId)
            put("razorpay_signature", signature)
        }).obj("instance").toWorkspace()

    fun signOut() { token = "" }

    fun computerStatus(instanceId: String, botId: String): JsonObject =
        call("GET", "/api/instances/${segment(instanceId)}/computer/status?botId=${segment(botId)}")

    fun computer(instanceId: String, botId: String): String =
        computerStatus(instanceId, botId).let { it.string("status") ?: it.string("url") ?: it.toString() }

    fun browserFrames(instanceId: String, botId: String) =
        eventFlow(browserRequest(instanceId, botId)).buffer(Channel.CONFLATED)

    private fun browserRequest(instanceId: String, botId: String): Request {
        val url = origin.trimEnd('/') + "/api/instances/${segment(instanceId)}/computer/browser?botId=${segment(botId)}"
        return Request.Builder().url(url).header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream").build()
    }

    fun chatEvents(instanceId: String, botId: String, chatId: String, since: String? = null) =
        eventFlow(callForStreamRequest(instanceId, botId, chatId, since), allowTicket = true)

    private fun eventFlow(request: Request, allowTicket: Boolean = false) = callbackFlow {
        val stopped = AtomicBoolean(false)
        val call = eventHttp.newCall(request)
        val active = AtomicReference(call)
        val callback = object : Callback {
            override fun onFailure(call: Call, e: IOException) { close(e) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use {
                        if (!response.isSuccessful) {
                            throw VectraHttpException(response.code, call.request().header("Authorization") != null, "The live connection is unavailable.")
                        }
                        if (allowTicket && call.request() == request && response.header("Content-Type").orEmpty().contains("application/json")) {
                            val ticket = vectraJson.parseToJsonElement(response.body?.string().orEmpty()).jsonObject.string("streamUrl")
                                ?: throw IOException("No chat stream address was returned.")
                            val target = ticket.toHttpUrl()
                            if (!target.isHttps && target.host != request.url.host) throw IOException("The stream requires HTTPS.")
                            val next = eventHttp.newCall(Request.Builder().url(target).header("Accept", "text/event-stream").build())
                            active.set(next)
                            if (stopped.get()) next.cancel() else next.enqueue(this)
                            return
                        }
                        val source = response.body?.source() ?: return@use
                        val data = StringBuilder()
                        while (!call.isCanceled()) {
                            val line = source.readUtf8Line() ?: break
                            if (line.isEmpty()) {
                                if (data.isNotEmpty()) {
                                    runCatching { vectraJson.parseToJsonElement(data.toString()) as? JsonObject }
                                        .getOrNull()?.let { if (allowTicket) trySendBlocking(it) else trySend(it) }
                                    data.clear()
                                }
                            } else if (line.startsWith("data:")) {
                                if (data.isNotEmpty()) data.append('\n')
                                data.append(line.removePrefix("data:").removePrefix(" "))
                            }
                        }
                    }
                    close()
                } catch (cause: Exception) {
                    close(cause)
                }
            }
        }
        call.enqueue(callback)
        awaitClose {
            stopped.set(true)
            active.get().cancel()
        }
    }

    fun stop(instanceId: String, botId: String, chatId: String) {
        call(
            "POST",
            "/api/instances/${segment(instanceId)}/chat/stop",
            buildJsonObject {
                put("botId", botId)
                put("chatId", chatId)
            },
        )
    }

    fun openEvents(instanceId: String, botId: String, chatId: String): Request {
        val direct = callForStream(instanceId, botId, chatId)
        val type = direct.header("content-type").orEmpty()
        if (type.contains("application/json")) {
            val body = direct.body?.string().orEmpty()
            direct.close()
            val payload = vectraJson.parseToJsonElement(body).jsonObject
            val streamUrl = payload.string("streamUrl")
            if (streamUrl.isNullOrBlank() || !(streamUrl.startsWith("https://") || streamUrl.startsWith("http://"))) {
                throw IOException("Chat stream URL missing")
            }
            return Request.Builder().url(streamUrl).header("Accept", "text/event-stream").build()
        }
        direct.close()
        return callForStreamRequest(instanceId, botId, chatId)
    }

    private fun callForStreamRequest(instanceId: String, botId: String, chatId: String, since: String? = null): Request {
        val url = origin.trimEnd('/').toHttpUrl().newBuilder()
            .addPathSegments("api/instances/${segment(instanceId)}/chat/events".trimStart('/'))
            .addQueryParameter("botId", botId)
            .addQueryParameter("chatId", chatId)
            .apply { since?.let { addQueryParameter("since", it) } }
            .build()
        return Request.Builder().url(url).header("Accept", "application/json, text/event-stream").header("Authorization", "Bearer $token").build()
    }

    private fun callForStream(instanceId: String, botId: String, chatId: String) =
        eventHttp.newCall(callForStreamRequest(instanceId, botId, chatId)).execute().also { response ->
            if (!response.isSuccessful) response.use {
                throw VectraHttpException(response.code, true, "Chat stream could not connect.")
            }
        }

    private fun call(
        method: String,
        path: String,
        body: JsonObject? = null,
        authorized: Boolean = true,
        client: OkHttpClient = http,
    ): JsonObject {
        val url = if (path.startsWith("http")) path else origin.trimEnd('/') + path
        val request = Request.Builder().url(url).header("Accept", "application/json").apply {
            if (authorized && token.isNotEmpty()) header("Authorization", "Bearer $token")
            when (method) {
                "POST", "PUT", "PATCH" -> method(method, (body?.toString() ?: "{}").toRequestBody(jsonMedia))
                "DELETE" -> delete(body?.toString()?.toRequestBody(jsonMedia))
            }
        }.build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val message = runCatching {
                    vectraJson.parseToJsonElement(response.body?.string().orEmpty()).jsonObject.string("error")
                }.getOrNull()
                throw VectraHttpException(
                    response.code,
                    request.header("Authorization") != null,
                    message ?: "Request failed (${response.code}).",
                )
            }
            val text = response.body?.string().orEmpty()
            return if (text.isBlank()) JsonObject(emptyMap()) else vectraJson.parseToJsonElement(text).jsonObject
        }
    }
}

private fun segment(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

fun JsonObject.string(name: String) = (this[name] as? JsonPrimitive)?.contentOrNull

fun JsonObject.obj(name: String) = this[name] as? JsonObject ?: JsonObject(emptyMap())

private fun JsonObject.array(name: String) = this[name] as? kotlinx.serialization.json.JsonArray ?: kotlinx.serialization.json.JsonArray(emptyList())

fun JsonObject.objects(name: String) = array(name).filterIsInstance<JsonObject>()
fun JsonObject.flag(name: String) = (this[name] as? JsonPrimitive)?.booleanOrNull
fun JsonObject.number(name: String) = (this[name] as? JsonPrimitive)?.intOrNull

private fun JsonObject.toWorkspace(): VectraWorkspace? {
    val id = string("id")?.takeIf { it.isNotBlank() } ?: return null
    val free = (this["isFree"] as? JsonPrimitive)?.booleanOrNull == true
    val paid = (this["paid"] as? JsonPrimitive)?.booleanOrNull != false
    return VectraWorkspace(
        id = id,
        name = string("name") ?: id,
        state = string("liveState") ?: string("status").orEmpty(),
        runtime = string("runtime") ?: "xibecode",
        free = free,
        pastDue = string("billingStatus") in setOf("past_due", "suspended") || (!free && !paid),
        planId = string("plan"),
        liveMessage = string("liveMessage"),
        lastError = string("lastError"),
        paidUntil = string("paidUntil"),
    )
}
