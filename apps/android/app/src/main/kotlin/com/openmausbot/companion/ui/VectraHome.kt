package com.openmausbot.companion.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.openmausbot.companion.core.VectraDashboard
import com.openmausbot.companion.core.VectraWorkspace

internal data class VectraPlan(val id: String, val size: String, val inr: String, val usd: String)

internal val vectraPlans = listOf(
    VectraPlan("hosting-2c4g", "2 vCPU · 4 GB", "₹199", "$2.29"),
    VectraPlan("hosting-4c8g", "4 vCPU · 8 GB", "₹399", "$4.59"),
    VectraPlan("hosting-8c8g", "8 vCPU · 8 GB", "₹599", "$6.79"),
    VectraPlan("hosting-16c16g", "16 vCPU · 16 GB", "₹1,199", "$13.49"),
)

internal data class VectraBillingTarget(
    val plan: VectraPlan = vectraPlans[1],
    val name: String? = null,
    val workspace: VectraWorkspace? = null,
)

internal enum class VectraDestination { Home, Workspaces, Settings, Billing, Pollinations, Connected, Marketplace, Account }
internal enum class WorkspaceAction { Wake, Restart, Destroy }

@Composable
internal fun VectraPage(title: String, onBack: (() -> Unit)? = null, body: @Composable () -> Unit) {
    BackHandler(enabled = onBack != null) { onBack?.invoke() }
    Surface(Modifier.fillMaxSize()) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onBack != null) {
                    IconButton(onClick = onBack) { Icon(VectraIcons.ArrowLeft, contentDescription = "Back") }
                }
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp))
            }
            body()
        }
    }
}

@Composable
internal fun VectraHome(
    dashboard: VectraDashboard?,
    bots: List<VectraBot>,
    cliUpdates: Set<String>,
    loading: Boolean,
    message: String?,
    workspacesOnly: Boolean,
    onNavigate: (VectraDestination) -> Unit,
    onOpenBot: (VectraBot) -> Unit,
    onOpenWorkspace: (VectraWorkspace) -> Unit,
    onSettings: (VectraWorkspace) -> Unit,
    onRefresh: () -> Unit,
    onCreate: (String, VectraPlan, Boolean) -> Unit,
    onPurchase: (VectraWorkspace?) -> Unit,
    onAction: (VectraWorkspace, WorkspaceAction) -> Unit,
) {
    var create by remember { mutableStateOf(false) }
    var destroy by remember { mutableStateOf<VectraWorkspace?>(null) }
    var query by remember { mutableStateOf("") }
    val workspaces = dashboard?.workspaces.orEmpty()
    val visibleBots = bots.filter { it.name.contains(query.trim(), ignoreCase = true) }
    if (!workspacesOnly && workspaces.isNotEmpty()) {
        Column(Modifier.fillMaxSize().background(Color(0xFF111111)).padding(horizontal = 20.dp)) {
            Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 28.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(onClick = { onNavigate(VectraDestination.Account) }, shape = CircleShape, color = Color(0xFF29292D), modifier = Modifier.size(48.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text("V", color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.Bold) }
                }
                Text("Vectrabot", Modifier.weight(1f).padding(start = 14.dp), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Surface(onClick = { onNavigate(VectraDestination.Workspaces) }, shape = CircleShape, color = Color(0xFF29292D), modifier = Modifier.size(48.dp)) {
                    Box(contentAlignment = Alignment.Center) { Icon(VectraIcons.Plus, contentDescription = "Workspaces", tint = Color.White) }
                }
            }
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visibleBots, key = { "${it.workspaceId}/${it.agentId}" }) { bot ->
                    Row(Modifier.fillMaxWidth().clickable { onOpenBot(bot) }.padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        val colors = listOf(Color(0xFFFF338A), Color(0xFF00C98D), Color(0xFFFF8B22), Color(0xFF31BEB5))
                        Surface(Modifier.size(55.dp), shape = RoundedCornerShape(20.dp), color = colors[(bot.name.hashCode() and Int.MAX_VALUE) % colors.size]) {
                            Box(contentAlignment = Alignment.Center) { Text(bot.name.take(1).uppercase(), color = Color(0xFF121212), fontSize = 24.sp, fontWeight = FontWeight.Bold) }
                        }
                        Column(Modifier.weight(1f).padding(start = 18.dp)) {
                            Text(bot.name, color = Color.White, fontSize = 20.sp, maxLines = 1)
                            Text(workspaces.firstOrNull { it.id == bot.workspaceId }?.name.orEmpty(), color = Color(0xFF99999F), fontSize = 15.sp, maxLines = 1)
                        }
                    }
                }
                if (visibleBots.isEmpty()) item { Text(if (loading) "Loading chats…" else "No chats found", color = Color(0xFF99999F)) }
                if (message != null) item { TextButton(onClick = onRefresh) { Text("Retry loading chats") } }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(onClick = { onNavigate(VectraDestination.Workspaces) }, shape = CircleShape, color = Color(0xFF29292D), modifier = Modifier.size(48.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text("☷", color = Color.White, fontSize = 24.sp) }
                }
                OutlinedTextField(query, { query = it }, Modifier.weight(1f), placeholder = { Text("Search") }, singleLine = true, shape = RoundedCornerShape(28.dp))
            }
        }
        return
    }
    VectraPage(
        if (workspacesOnly) "Workspaces" else "Vectrabot",
        onBack = if (workspacesOnly) ({ onNavigate(VectraDestination.Home) }) else null,
    ) {
        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (!workspacesOnly && workspaces.isNotEmpty()) {
                item {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Chats", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                        TextButton(onClick = { onNavigate(VectraDestination.Workspaces) }) { Text("Workspaces") }
                    }
                    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Search chats") }, singleLine = true)
                    if (!loading && visibleBots.isEmpty()) Text(if (query.isBlank()) "No chats yet." else "No matching chats.")
                }
                items(visibleBots, key = { "${it.workspaceId}/${it.agentId}" }) { bot ->
                    ListItem(
                        headlineContent = { Text(bot.name) },
                        supportingContent = { workspaces.firstOrNull { it.id == bot.workspaceId }?.let { Text(it.name) } },
                        leadingContent = {
                            Surface(Modifier.size(40.dp), shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.secondaryContainer) {
                                Column(verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(bot.name.take(1).uppercase(), fontWeight = FontWeight.SemiBold)
                                }
                            }
                        },
                        modifier = Modifier.clickable { onOpenBot(bot) },
                    )
                }
            }
            if (workspacesOnly || workspaces.isEmpty()) {
                item {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (dashboard != null && workspaces.isEmpty()) "Set up your first workspace" else "Your workspaces", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        TextButton(onClick = onRefresh, enabled = !loading) { Text("Refresh") }
                    }
                    if (dashboard != null && workspaces.isEmpty()) Text("A workspace is a cloud computer where your agents chat, run tasks and keep files.")
                    if (dashboard != null) Text("${dashboard.freeAvailable} of ${dashboard.freeLimit} free slots available")
                    Button(onClick = { create = true }, enabled = !loading) { Text("Create workspace") }
                    if (loading) Text("Loading workspaces…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (message != null) {
                        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        TextButton(onClick = onRefresh, enabled = !loading) { Text("Retry") }
                    }
                }
                items(workspaces, key = { "workspace/${it.id}" }) { item ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(
                                item.name,
                                Modifier.fillMaxWidth().clickable { onOpenWorkspace(item) }.padding(vertical = 6.dp),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                listOfNotNull(
                                    if (item.runtime == "supercharge") "Supercharge" else "XibeCode",
                                    item.state.replace('_', ' ').takeIf { it.isNotBlank() },
                                    "Free".takeIf { item.free },
                                    "Past due".takeIf { item.pastDue },
                                ).joinToString(" · "),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            item.paidUntil?.take(10)?.let { Text("Paid until $it") }
                            if (item.id in cliUpdates) Text("CLI update available")
                            (item.lastError ?: item.liveMessage)?.let { messageText ->
                                Text(vectraSafeStatus(messageText), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { onOpenWorkspace(item) }) { Text("Open chat") }
                                OutlinedButton(onClick = { onSettings(item) }) { Text("Settings") }
                            }
                            var expanded by remember { mutableStateOf(false) }
                            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Hide actions" else "More actions") }
                            if (expanded) {
                                Row {
                                    TextButton(onClick = { onAction(item, WorkspaceAction.Wake) }, enabled = !loading) { Text("Wake") }
                                    TextButton(onClick = { onAction(item, WorkspaceAction.Restart) }, enabled = !loading) { Text("Restart") }
                                    TextButton(onClick = { onPurchase(item) }, enabled = !loading) { Text("Renew") }
                                }
                                TextButton(onClick = { destroy = item }, enabled = !loading) { Text("Destroy", color = MaterialTheme.colorScheme.error) }
                            }
                        }
                    }
                }
            }
            if (!workspacesOnly) {
                item {
                    Text("Explore", style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { onPurchase(null) }) { Text("Billing") }
                        TextButton(onClick = { onNavigate(VectraDestination.Pollinations) }) { Text("Pollinations") }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { onNavigate(VectraDestination.Marketplace) }) { Text("Marketplace") }
                        TextButton(onClick = { onNavigate(VectraDestination.Account) }) { Text("Account") }
                    }
                }
            }
        }
    }
    if (create) {
        VectraCreateDialog(dashboard?.freeAvailable?.let { it > 0 } == true, onDismiss = { create = false }) { name, plan, paid ->
            create = false
            onCreate(name, plan, paid)
        }
    }
    destroy?.let { target ->
        VectraConfirm(
            "Destroy ${target.name}?",
            "This permanently deletes the sandbox and its files.",
            "Destroy",
            onDismiss = { destroy = null },
            onConfirm = {
                destroy = null
                onAction(target, WorkspaceAction.Destroy)
            },
        )
    }
}

@Composable
internal fun VectraConfirm(title: String, detail: String, action: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(detail) },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        confirmButton = { Button(onClick = onConfirm) { Text(action) } },
    )
}

@Composable
internal fun VectraPlanChoices(selected: VectraPlan, onPlan: (VectraPlan) -> Unit) {
    for (plan in vectraPlans) {
        Row(
            Modifier.fillMaxWidth().selectable(selected = plan == selected, onClick = { onPlan(plan) }, role = Role.RadioButton)
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(selected = plan == selected, onClick = null)
            Column {
                Text(plan.size)
                Text("${plan.inr} or ${plan.usd} / 30 days", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun VectraCreateDialog(freeAvailable: Boolean, onDismiss: () -> Unit, onCreate: (String, VectraPlan, Boolean) -> Unit) {
    var plan by remember { mutableStateOf(vectraPlans.first()) }
    var name by remember { mutableStateOf("workspace") }
    val free = freeAvailable && plan == vectraPlans.first()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create your workspace") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(64) }, label = { Text("Workspace name") }, singleLine = true)
                var sizes by remember { mutableStateOf(false) }
                Text(if (free) "Free workspace · ${plan.size}" else "${plan.size} · ${plan.inr} / 30 days")
                TextButton(onClick = { sizes = !sizes }) { Text(if (sizes) "Hide sizes" else "Change size") }
                if (sizes) VectraPlanChoices(plan) { plan = it }
                Text(if (free) "You can open a chat as soon as your workspace is ready." else "Billed monthly in INR or USD.")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        confirmButton = {
            Button(onClick = { onCreate(name.trim(), plan, !free) }, enabled = name.isNotBlank()) {
                Text(if (free) "Create free" else "Pay ${plan.inr}")
            }
        },
    )
}

internal fun vectraSafeStatus(message: String): String =
    if (message.contains("timeout", true) || message.contains("timed out", true)) "The workspace did not respond. Try again." else message
