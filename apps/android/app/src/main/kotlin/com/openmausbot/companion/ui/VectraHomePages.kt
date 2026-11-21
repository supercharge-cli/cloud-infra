package com.openmausbot.companion.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.core.net.toUri
import com.openmausbot.companion.MainActivity
import com.openmausbot.companion.core.VectraApi
import com.openmausbot.companion.core.VectraWorkspace
import com.openmausbot.companion.core.flag
import com.openmausbot.companion.core.number
import com.openmausbot.companion.core.obj
import com.openmausbot.companion.core.objects
import com.openmausbot.companion.core.string
import com.razorpay.Checkout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject

@Composable
internal fun VectraBilling(
    api: VectraApi,
    activity: MainActivity?,
    target: VectraBillingTarget,
    email: String,
    failure: (Throwable) -> String?,
    onBack: () -> Unit,
    onPaid: (VectraWorkspace?) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var config by remember { mutableStateOf<JsonObject?>(null) }
    var plan by remember(target) { mutableStateOf(target.plan) }
    var name by remember(target) { mutableStateOf(target.name ?: "workspace") }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var message by remember { mutableStateOf<String?>(null) }
    var pendingOrder by remember { mutableStateOf<String?>(null) }
    val result = activity?.vectraCheckoutResult
    val renew = target.workspace
    val autopay = config?.objects("plans")?.firstOrNull { it.string("id") == plan.id }?.flag("autopay") == true

    suspend fun load() {
        loading = true
        message = null
        try {
            config = withContext(Dispatchers.IO) { api.billingConfig() }
        } catch (cause: Exception) {
            message = failure(cause)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(api) { load() }
    LaunchedEffect(result) {
        if (activity == null || result == null || pendingOrder == null) return@LaunchedEffect
        val expected = pendingOrder
        pendingOrder = null
        val paymentId = result.paymentId
        val signature = result.signature
        if (result.cancelled) {
            message = "Checkout closed."
            busy = false
        } else if (result.orderId == expected && paymentId != null && signature != null && expected != null) {
            try {
                val workspace = withContext(Dispatchers.IO) { api.verifyPayment(expected, paymentId, signature) }
                onPaid(workspace)
            } catch (cause: Exception) {
                message = failure(cause)
            } finally {
                busy = false
            }
        } else {
            message = "Checkout did not return a payment receipt."
            busy = false
        }
        activity.vectraCheckoutResult = null
    }

    fun pay(currency: String) {
        if (busy || name.isBlank()) return
        if (activity == null) {
            message = "Could not open checkout."
            return
        }
        busy = true
        message = null
        scope.launch {
            try {
                val order = withContext(Dispatchers.IO) {
                    api.createOrder(plan.id, currency, name.trim().takeIf { renew == null }, renew?.id, renew?.runtime ?: "supercharge")
                }
                val key = order.string("keyId")
                val id = order.string("orderId")
                val amount = order.number("amount")
                if (key.isNullOrBlank() || id.isNullOrBlank() || amount == null || amount <= 0) {
                    message = "The server did not return a checkout order."
                    busy = false
                    return@launch
                }
                activity.vectraCheckoutResult = null
                pendingOrder = id
                val options = JSONObject()
                    .put("name", "Vectrabot Cloud")
                    .put("description", if (renew == null) "New workspace ${name.trim()}" else "Renew ${renew.name}")
                    .put("order_id", id)
                    .put("amount", amount)
                    .put("currency", order.string("currency") ?: currency)
                    .put("prefill", JSONObject().put("email", email))
                    .put("theme", JSONObject().put("color", "#22C55E"))
                Checkout().apply { setKeyID(key) }.open(activity, options)
            } catch (cause: Exception) {
                pendingOrder = null
                busy = false
                message = failure(cause)
            }
        }
    }

    VectraPage(if (renew == null) "Billing" else "Renew workspace", { if (!busy) onBack() }) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (loading) Text("Loading billing…")
            if (!loading && config == null) TextButton(onClick = { scope.launch { load() } }) { Text("Retry") }
            if (renew != null) {
                Text(renew.name, style = MaterialTheme.typography.titleMedium)
                renew.paidUntil?.take(10)?.let { Text("Paid until $it") }
            }
            if (renew != null || autopay) {
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        val url = api.origin.toHttpUrl().newBuilder().addPathSegment("dashboard")
                            .addQueryParameter("billing", "1")
                            .apply { renew?.id?.let { addQueryParameter("selected", it) } }
                            .build().toString()
                        message = openVectraUrl(context, url)
                    },
                ) { Text("Manage billing on the web") }
            }
            if (renew == null) {
                OutlinedTextField(name, { name = it.take(64) }, Modifier.fillMaxWidth(), label = { Text("Workspace name") }, enabled = !busy)
            }
            VectraPlanChoices(plan) { if (!busy) plan = it }
            val canPay = !loading && !busy && config != null && config?.flag("razorpayConfigured") != false && name.isNotBlank()
            Button(onClick = { pay("INR") }, enabled = canPay, modifier = Modifier.fillMaxWidth()) { Text("Pay ${plan.inr}") }
            OutlinedButton(onClick = { pay("USD") }, enabled = canPay, modifier = Modifier.fillMaxWidth()) { Text("Pay ${plan.usd}") }
            if (config?.flag("razorpayConfigured") == false) Text("Checkout is unavailable on this server.")
            if (busy) Text("Opening or verifying checkout…")
            message?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
internal fun VectraPollinations(api: VectraApi, returned: Boolean, failure: (Throwable) -> String?, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<JsonObject?>(null) }
    var busy by remember { mutableStateOf(true) }
    var message by remember { mutableStateOf<String?>(null) }
    var showConnected by remember { mutableStateOf(false) }
    var disconnect by remember { mutableStateOf(false) }

    suspend fun load() {
        status = withContext(Dispatchers.IO) { api.pollinationsStatus() }
    }

    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        message = null
        scope.launch {
            try {
                action()
            } catch (cause: Exception) {
                message = failure(cause)
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(returned) {
        busy = true
        try {
            load()
            if (returned && status?.flag("connected") == true) {
                showConnected = true
                delay(2400)
                showConnected = false
            }
        } catch (cause: Exception) {
            message = failure(cause)
        } finally {
            busy = false
        }
    }

    val data = status
    val connected = data?.flag("connected") == true
    val workspaces = data?.obj("workspaces")
    val balance = data?.obj("balance")
    fun connect() = run {
        val url = withContext(Dispatchers.IO) { api.pollenConnect() }
        message = openVectraUrl(context, url) ?: "Finish connecting in your browser."
    }

    VectraPage(if (showConnected) "Pollen connected" else "Pollinations", onBack) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (showConnected) {
                Text("Your workspaces can now use your Pollinations balance.")
            } else {
                Text("Connect once to use your Pollen balance across workspaces.")
                if (busy) Text("Checking Pollinations…")
                if (connected) {
                    Text(data?.string("name") ?: data?.string("username") ?: data?.string("email") ?: "Connected", style = MaterialTheme.typography.titleMedium)
                    data?.string("expiresAt")?.take(10)?.let { Text("Expires $it") }
                    Button(enabled = !busy, onClick = {
                        run {
                            val result = withContext(Dispatchers.IO) { api.pollinationsApplyAll() }
                            load()
                            message = "Applied to ${result.number("applied") ?: 0} of ${result.number("total") ?: 0} workspaces."
                        }
                    }) { Text("Apply to all workspaces") }
                    OutlinedButton(enabled = !busy, onClick = ::connect) { Text("Reconnect") }
                    OutlinedButton(enabled = !busy, onClick = { disconnect = true }) { Text("Disconnect") }
                } else {
                    Text(if (data?.flag("expired") == true) "Your key expired. Reconnect to continue." else "Not connected yet.")
                    Button(enabled = !busy && data != null && data.flag("configured") != false, onClick = ::connect) {
                        Text("Connect with Pollinations")
                    }
                    if (data == null && !busy) TextButton(onClick = { run { load() } }) { Text("Retry") }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text("Pollen", style = MaterialTheme.typography.titleMedium)
                Text("Left ${balance?.string("remaining") ?: "—"} · Paid ${balance?.string("paid") ?: "—"} · Quest ${balance?.string("quest") ?: "—"}")
                if (workspaces?.number("total") != null) Text("Workspaces ${workspaces.number("applied") ?: 0}/${workspaces.number("total")}")
                data?.string("scopeHint")?.let { Text(vectraSafeStatus(it)) }
                VectraPollinationsRows(data)
            }
        }
    }
    if (disconnect) {
        VectraConfirm(
            "Disconnect Pollinations?",
            "New workspaces will stop receiving this key. Existing workspaces keep it until it expires.",
            "Disconnect",
            onDismiss = { disconnect = false },
        ) {
            disconnect = false
            run {
                withContext(Dispatchers.IO) { api.pollinationsDisconnect() }
                load()
                message = "Disconnected."
            }
        }
    }
}

@Composable
private fun VectraPollinationsRows(data: JsonObject?) {
    val daily = data?.objects("daily").orEmpty().take(10)
    val recent = data?.objects("recent").orEmpty().take(15)
    val models = data?.objects("models").orEmpty().take(40)
    if (daily.isNotEmpty()) Text("Daily spend", style = MaterialTheme.typography.titleMedium)
    daily.forEach { Text("${it.string("day") ?: "—"} · ${it.string("cost") ?: "—"} pollen · ${it.number("requests") ?: 0} requests") }
    if (recent.isNotEmpty()) Text("Recent requests", style = MaterialTheme.typography.titleMedium)
    recent.forEach { Text("${it.string("model") ?: it.string("kind") ?: "Request"} · ${it.string("cost") ?: "—"} pollen") }
    if (models.isNotEmpty()) Text("Model costing", style = MaterialTheme.typography.titleMedium)
    models.forEach { Text(listOfNotNull(it.string("name"), it.string("category"), it.string("label")).joinToString(" · ")) }
}

@Composable
internal fun VectraAccountLanding(
    api: VectraApi,
    email: String,
    failure: (Throwable) -> String?,
    onBack: () -> Unit,
    onPollinations: () -> Unit,
    onSignOut: () -> Unit,
) {
    val context = LocalContext.current
    var account by remember { mutableStateOf(email) }
    var role by remember { mutableStateOf("user") }
    var message by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    LaunchedEffect(api) {
        try {
            val profile = withContext(Dispatchers.IO) { api.account() }
            profile.string("email")?.takeIf(String::isNotBlank)?.let { account = it }
            role = profile.string("role").orEmpty().ifBlank { "user" }
        } catch (cause: Exception) {
            message = failure(cause)
        }
    }
    VectraPage("Account", onBack) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Card(Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(account.ifBlank { "Vectrabot account" }) },
                    overlineContent = { Text("Signed in") },
                    supportingContent = { Text(role) },
                    leadingContent = { Text(account.firstOrNull()?.uppercase() ?: "?", style = MaterialTheme.typography.titleLarge) },
                )
            }
            TextButton(onClick = onPollinations) { Text("Pollinations") }
            TextButton(onClick = { message = openVectraUrl(context, "${api.origin.trimEnd('/')}/dashboard") }) { Text("Open website in browser") }
            OutlinedButton(onClick = { confirm = true }) { Text("Sign out") }
            message?.let { Text(it) }
        }
    }
    if (confirm) {
        VectraConfirm("Sign out?", "You will need to sign in again on this device.", "Sign out", { confirm = false }, onSignOut)
    }
}

internal fun openVectraUrl(context: Context, url: String): String? {
    val uri = url.toUri()
    if (uri.scheme !in listOf("https", "http") || uri.host.isNullOrBlank() || uri.userInfo != null) return "The server returned an invalid link."
    return try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        null
    } catch (_: android.content.ActivityNotFoundException) {
        "Could not open the browser."
    }
}
