import 'package:flutter/material.dart';

import '../api/marketplace.dart';
import '../state/marketplace.dart';
import '../theme.dart';

class MarketplaceIcon extends StatelessWidget {
  const MarketplaceIcon({super.key, required this.plugin, this.size = 48});
  final MarketplacePlugin plugin;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      color: Vc.greenDim,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Icon(plugin.icon, color: Vc.greenSoft, size: size * .52),
  );
}

class MarketplaceMessage extends StatelessWidget {
  const MarketplaceMessage(
    this.text, {
    super.key,
    this.error = false,
    this.action,
    this.onAction,
  });
  final String text;
  final bool error;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: TextStyle(color: error ? Vc.red : Vc.muted, height: 1.45),
          ),
          if (action != null)
            TextButton(onPressed: onAction, child: Text(action!)),
        ],
      ),
    ),
  );
}

class MarketplaceTarget extends StatelessWidget {
  const MarketplaceTarget({super.key, required this.controller});
  final MarketplaceController controller;

  @override
  Widget build(BuildContext context) {
    final c = controller;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Install destination',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
        ),
        const SizedBox(height: 6),
        const Text(
          'Plugins run in this bot’s isolated VM store, not on this device or in Supercharge desktop.',
          style: TextStyle(color: Vc.muted, height: 1.4),
        ),
        const SizedBox(height: 14),
        if (c.loadingWorkspaces)
          const LinearProgressIndicator(
            semanticsLabel: 'Loading owned workspaces',
          ),
        if (c.workspaceError != null)
          MarketplaceMessage(
            c.workspaceError!,
            error: true,
            action: 'Retry workspaces',
            onAction: () => c.loadWorkspaces(),
          ),
        if (!c.loadingWorkspaces &&
            c.workspaceError == null &&
            c.workspaces.isEmpty)
          const MarketplaceMessage(
            'No owned workspaces yet. Create a Supercharge workspace from Chats to install plugins.',
          ),
        if (c.workspaces.isNotEmpty && !c.loadingWorkspaces)
          DropdownButtonFormField<String>(
            key: ValueKey('workspace-${c.instanceId}'),
            initialValue: c.instanceId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Owned workspace'),
            items: [
              for (final item in c.workspaces)
                DropdownMenuItem(
                  value: item.id,
                  child: Text(
                    '${item.name} · ${item.runtimeLabel}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: c.busy ? null : (id) => c.selectWorkspace(id),
          ),
        if (c.workspace != null && !c.supported)
          const MarketplaceMessage(
            'Unsupported runtime. Marketplace installation requires a Supercharge VM. Select another workspace.',
          ),
        if (c.supported) ...[
          const SizedBox(height: 12),
          if (c.loadingBots)
            const LinearProgressIndicator(semanticsLabel: 'Loading bots'),
          if (!c.loadingBots && c.bots.isEmpty && c.targetError == null)
            const MarketplaceMessage(
              'No bots found in this VM. Create a bot and retry target discovery.',
            ),
          if (c.bots.isNotEmpty)
            DropdownButtonFormField<String>(
              key: ValueKey('bot-${c.instanceId}-${c.botId}'),
              initialValue: c.botId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Bot'),
              items: [
                for (final row in c.bots)
                  DropdownMenuItem(
                    value: row['id'] as String,
                    child: Text(
                      '${row['name'] ?? row['id']}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: c.busy ? null : (id) => c.selectBot(id),
            ),
          if (c.loadingInventory)
            const Padding(
              padding: EdgeInsets.only(top: 12),
              child: LinearProgressIndicator(
                semanticsLabel: 'Loading VM inventory',
              ),
            ),
          if (c.targetError != null)
            MarketplaceMessage(c.targetError!, error: true),
          TextButton.icon(
            onPressed: c.busy || c.loadingBots || c.loadingInventory
                ? null
                : () => c.botId == null
                      ? c.selectWorkspace(c.instanceId)
                      : c.refreshInventory(),
            icon: const Icon(Icons.refresh, size: 18),
            label: Text(
              c.botId == null ? 'Retry target discovery' : 'Refresh VM status',
            ),
          ),
        ],
        if (c.actionError != null)
          MarketplaceMessage(c.actionError!, error: true),
        if (c.notice != null) MarketplaceMessage(c.notice!),
        if (c.busy)
          const LinearProgressIndicator(semanticsLabel: 'Updating selected VM'),
      ],
    );
  }
}
