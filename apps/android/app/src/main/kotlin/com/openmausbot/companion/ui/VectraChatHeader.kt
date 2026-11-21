package com.openmausbot.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

private val chipSurface = Color(0xFF23262E)
private val menuText = Color(0xFFECEEF2)
private val menuIcon = Color(0xFFB4B9C5)
private val chatActions = listOf(
    "Files" to VectraIcons.Folder,
    "Computer" to VectraIcons.Monitor,
    "Preview" to VectraIcons.Browser,
    "Terminal" to VectraIcons.Terminal,
    "Search in chat" to VectraIcons.Search,
)

@Composable
internal fun VectraChatHeader(
    title: String,
    mark: Color,
    expanded: Boolean,
    modelLabel: String,
    historyEnabled: Boolean,
    onBack: () -> Unit,
    onMenu: (Boolean) -> Unit,
    onAction: (String) -> Unit,
) {
    val colors = IconButtonDefaults.iconButtonColors(containerColor = chipSurface, contentColor = menuText)
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack, colors = colors, modifier = Modifier.clip(CircleShape)) {
            Icon(VectraIcons.ArrowLeft, contentDescription = "Back")
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            Row(
                Modifier.clip(RoundedCornerShape(24.dp)).background(chipSurface)
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(26.dp).clip(RoundedCornerShape(8.dp)).background(mark),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(title.take(1).uppercase(), color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                }
                Text(title, color = menuText, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
            }
        }
        Box {
            IconButton(onClick = { onMenu(true) }, colors = colors, modifier = Modifier.clip(CircleShape)) {
                Icon(VectraIcons.Ellipsis, contentDescription = "More")
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { onMenu(false) }, containerColor = chipSurface) {
                DropdownMenuItem(
                    text = { androidx.compose.foundation.layout.Column {
                        Text("Provider & model", color = menuText)
                        if (modelLabel.isNotBlank()) Text(modelLabel, color = menuIcon, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    } },
                    onClick = { onMenu(false); onAction("Models") },
                )
                DropdownMenuItem(text = { Text("Group chat", color = menuText) }, onClick = { onMenu(false); onAction("Group chat") })
                DropdownMenuItem(text = { Text("History", color = menuText) }, enabled = historyEnabled, onClick = { onMenu(false); onAction("History") })
                chatActions.forEach { (label, icon) ->
                    DropdownMenuItem(
                        text = { Text(label, color = menuText) },
                        leadingIcon = { Icon(icon, contentDescription = null, tint = menuIcon) },
                        onClick = {
                            onMenu(false)
                            onAction(label)
                        },
                    )
                }
            }
        }
    }
}

@Composable
internal fun VectraTranscriptSearch(query: String, onChange: (String) -> Unit, onClose: () -> Unit) {
    val focus = LocalFocusManager.current
    val requester = remember { FocusRequester() }
    LaunchedEffect(requester) { requester.requestFocus() }
    OutlinedTextField(
        value = query,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(requester),
        singleLine = true,
        label = { Text("Find in chat") },
        leadingIcon = { Icon(VectraIcons.Search, contentDescription = null) },
        trailingIcon = {
            IconButton(onClick = {
                focus.clearFocus()
                onClose()
            }) { Icon(VectraIcons.Close, contentDescription = "Close search") }
        },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
    )
}
