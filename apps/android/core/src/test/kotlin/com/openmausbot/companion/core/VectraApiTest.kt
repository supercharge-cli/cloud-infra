package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class VectraApiTest {
    @Test
    fun registrationUsesThePublicAccountEndpoint() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"token":"new-account"}"""))
            val api = VectraApi(origin = server.url("/").toString(), token = "old-session")

            assertEquals("new-account", api.login("new@example.test", "password", register = true))

            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/auth/register", request.path)
            assertNull(request.getHeader("Authorization"))
            assertEquals("""{"email":"new@example.test","password":"password"}""", request.body.readUtf8())
        }
    }

    @Test
    fun authenticationFailuresUseTheHttpStatusEvenForPlainTextBodies() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"401 Unauthorized"}"""))
            server.enqueue(MockResponse().setResponseCode(401).setBody("Unauthorized"))
            val api = VectraApi(origin = server.url("/").toString(), token = "saved")

            val unavailable = assertFailsWith<VectraHttpException> { api.workspaces() }
            assertEquals(503, unavailable.status)
            val unauthorized = assertFailsWith<VectraHttpException> { api.workspaces() }
            assertEquals(401, unauthorized.status)
            assertEquals(true, unauthorized.authenticated)
        }
    }

    @Test
    fun hiddenTurnsStayOffTheTranscript() {
        val json = Json.parseToJsonElement("""{"type":"thinking","text":"secret"}""").jsonObject
        assertNull(visibleVectraEvent(json))
        val reply = Json.parseToJsonElement("""{"type":"text","id":"4","text":"Hello"}""").jsonObject
        assertEquals(VectraMessage("4", "agent", "Hello"), visibleVectraEvent(reply))
    }

    @Test
    fun signInAgentsSendAndStream() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("""{"token":"tok","user":{"email":"a@b.c"}}"""))
            server.enqueue(MockResponse().setBody("""{"instances":[{"id":"vm","name":"Desk"}]}"""))
            server.enqueue(MockResponse().setBody("""{"bots":[{"id":"main","name":"Chief"}]}"""))
            server.enqueue(MockResponse().setBody("""{"conversations":[]}"""))
            server.enqueue(MockResponse().setBody("""{"active":"chat-1"}"""))
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            server.enqueue(MockResponse().setBody("""{"entries":[{"name":"README.md"}]}"""))
            server.enqueue(MockResponse().setBody("""{"host":"https://3000-vm.e2b.app"}"""))
            server.enqueue(MockResponse().setBody("""{"status":"ready"}"""))
            val api = VectraApi(OkHttpClient(), server.url("/").toString().trimEnd('/'))
            api.login("a@b.c", "pw")
            assertEquals("tok", api.token)
            assertEquals("Desk", api.workspaces().single().name)
            assertEquals("Chief", api.agents("vm").single().name)
            assertEquals("chat-1", api.conversation("vm", "main"))
            api.send("vm", "main", "chat-1", "hi")
            assertEquals(listOf("README.md"), api.files("vm"))
            assertEquals("https://3000-vm.e2b.app", api.preview("vm"))
            assertEquals("ready", api.computer("vm", "main"))
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            server.enqueue(MockResponse().setBody("""{"skills":[{"name":"github"}]}"""))
            server.enqueue(MockResponse().setBody("""{"url":"https://pollinations.ai/connect"}"""))
            server.enqueue(MockResponse().setBody("""{"orderId":"order_1"}"""))
            api.wake("vm")
            assertEquals(listOf("github"), api.skills())
            assertEquals("https://pollinations.ai/connect", api.pollenConnect("vm"))
            assertEquals("order_1", api.createOrder("vm", "hosting-2c4g"))
            server.enqueue(MockResponse().setHeader("content-type", "application/json").setBody("""{"streamUrl":"${server.url("/chat/stream")}"}"""))
            val request = api.openEvents("vm", "main", "chat-1")
            assertEquals("/chat/stream", request.url.encodedPath)
        } finally {
            server.shutdown()
        }
    }
}
