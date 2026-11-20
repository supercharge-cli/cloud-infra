package com.openmausbot.companion.core

import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class VectraAgent(val id: String, val name: String)
data class VectraWorkspace(val id: String, val name: String)
data class VectraMessage(val id: String, val role: String, val text: String)

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
        id = event.string("id").orEmpty(),
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

    fun workspaces(): List<VectraWorkspace> {
        val rows = call("GET", "/api/instances").array("instances")
        return rows.map { row ->
            val item = row.jsonObject
            VectraWorkspace(item.string("id").orEmpty(), item.string("name") ?: item.string("id").orEmpty())
        }.filter { it.id.isNotEmpty() }
    }

    fun agents(instanceId: String): List<VectraAgent> {
        val rows = call("GET", "/api/instances/${segment(instanceId)}/bots").array("bots")
        return rows.map { row ->
            val item = row.jsonObject
            VectraAgent(item.string("id").orEmpty(), item.string("name") ?: item.string("id").orEmpty())
        }.filter { it.id.isNotEmpty() }
    }

    fun conversation(instanceId: String, botId: String): String {
        val listed = call("GET", "/api/instances/${segment(instanceId)}/chat/conversations?botId=${segment(botId)}")
        val existing = listed.array("conversations").map { it.jsonObject }
            .firstOrNull { it.string("source") != "group" && !it.string("sessionId").isNullOrEmpty() }
        existing?.string("sessionId")?.let { return it }
        val created = call(
            "POST",
            "/api/instances/${segment(instanceId)}/chat/conversations",
            buildJsonObject { put("botId", botId) },
        )
        return created.string("active") ?: throw IOException("No conversation is available for this agent.")
    }

    fun send(instanceId: String, botId: String, chatId: String, text: String) {
        call(
            "POST",
            "/api/instances/${segment(instanceId)}/chat",
            buildJsonObject {
                put("text", text)
                put("botId", botId)
                put("chatId", chatId)
            },
        )
    }

    fun files(instanceId: String, path: String = "/home/user/workspace"): List<String> {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/workspace?path=${segment(path)}")
        val rows = payload.array("entries").ifEmpty { payload.array("files") }
        return rows.map { row ->
            val item = row.jsonObject
            item.string("name") ?: item.string("path") ?: row.toString()
        }
    }

    fun file(instanceId: String, path: String): String {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/workspace/file?path=${segment(path)}")
        return payload.string("content") ?: payload.string("text") ?: payload.toString()
    }

    fun preview(instanceId: String, port: Int = 3000): String {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/preview?port=$port")
        return payload.string("host") ?: throw IOException("No preview host")
    }

    fun accountEmail(): String = call("GET", "/api/me").obj("user").string("email").orEmpty()

    fun planNames(): List<String> =
        call("GET", "/api/billing/config").array("plans").map { it.jsonObject.string("name") ?: it.jsonObject.string("id").orEmpty() }

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

    fun createWorkspace(name: String): JsonObject = call(
        "POST",
        "/api/instances",
        buildJsonObject {
            put("name", name)
            put("runtime", "supercharge")
        },
    )

    fun wake(instanceId: String) = call("POST", "/api/instances/${segment(instanceId)}/wake")
    fun restartWorkspace(instanceId: String) = call("POST", "/api/instances/${segment(instanceId)}/restart")
    fun deleteWorkspace(instanceId: String) = call("DELETE", "/api/instances/${segment(instanceId)}")
    fun config(instanceId: String) = call("GET", "/api/instances/${segment(instanceId)}/config")

    fun exec(instanceId: String, command: String) = call(
        "POST",
        "/api/instances/${segment(instanceId)}/exec",
        buildJsonObject { put("command", command) },
    )

    fun approve(instanceId: String, choice: String) = call(
        "POST",
        "/api/instances/${segment(instanceId)}/chat/approve",
        buildJsonObject { put("choice", choice) },
    )

    fun answer(instanceId: String, ref: String, answer: String) = call(
        "POST",
        "/api/instances/${segment(instanceId)}/chat/answer",
        buildJsonObject {
            put("id", ref)
            put("answer", answer)
        },
    )

    fun handoff(instanceId: String, action: String, handoffId: String, botId: String) = call(
        "POST",
        "/api/instances/${segment(instanceId)}/computer/handoff",
        buildJsonObject {
            put("action", action)
            put("handoffId", handoffId)
            put("botId", botId)
            put("minutes", 10)
        },
    )

    fun skills(): List<String> = call("GET", "/api/marketplace/skills").array("skills").map { row ->
        val item = row.jsonObject
        item.string("name") ?: item.string("id").orEmpty()
    }

    fun pollenConnect(instanceId: String): String {
        val payload = call("POST", "/api/pollinations/start", buildJsonObject {
            put("instanceId", instanceId)
            put("fromApp", true)
        })
        return payload.string("url") ?: throw IOException("Connect URL missing")
    }

    fun createOrder(instanceId: String, planId: String): String {
        val payload = call("POST", "/api/billing/create-order", buildJsonObject {
            put("purpose", "hosting")
            put("instanceId", instanceId)
            put("currency", "INR")
            put("runtime", "supercharge")
            put("planId", planId)
        })
        return payload.string("orderId") ?: payload.obj("order").string("id") ?: payload.toString()
    }

    fun signOut() { token = "" }

    fun computer(instanceId: String, botId: String): String {
        val payload = call("GET", "/api/instances/${segment(instanceId)}/computer/status?botId=${segment(botId)}")
        return payload.string("url") ?: payload.string("status") ?: payload.toString()
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

    private fun callForStreamRequest(instanceId: String, botId: String, chatId: String): Request {
        val url = origin.trimEnd('/').toHttpUrl().newBuilder()
            .addPathSegments("api/instances/${segment(instanceId)}/chat/events".trimStart('/'))
            .addQueryParameter("botId", botId)
            .addQueryParameter("chatId", chatId)
            .build()
        return Request.Builder().url(url).header("Accept", "application/json, text/event-stream").header("Authorization", "Bearer $token").build()
    }

    private fun callForStream(instanceId: String, botId: String, chatId: String) =
        eventHttp.newCall(callForStreamRequest(instanceId, botId, chatId)).execute().also { response ->
            if (!response.isSuccessful) response.use {
                throw VectraHttpException(response.code, true, "Chat stream could not connect.")
            }
        }

    private fun call(method: String, path: String, body: JsonObject? = null, authorized: Boolean = true): JsonObject {
        val url = if (path.startsWith("http")) path else origin.trimEnd('/') + path
        val request = Request.Builder().url(url).header("Accept", "application/json").apply {
            if (authorized && token.isNotEmpty()) header("Authorization", "Bearer $token")
            when (method) {
                "POST", "PUT", "PATCH" -> method(method, (body?.toString() ?: "{}").toRequestBody(jsonMedia))
                "DELETE" -> delete(body?.toString()?.toRequestBody(jsonMedia))
            }
        }.build()
        http.newCall(request).execute().use { response ->
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

private fun JsonObject.string(name: String) = (this[name] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.obj(name: String) = this[name]?.jsonObject ?: JsonObject(emptyMap())

private fun JsonObject.array(name: String) = this[name]?.jsonArray ?: kotlinx.serialization.json.JsonArray(emptyList())
