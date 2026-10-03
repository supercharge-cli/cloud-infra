import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/marketplace.dart';
import '../state/marketplace.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/marketplace.dart';
import '../widgets/side_panel.dart';
import 'marketplace_detail.dart';

class MarketplaceScreen extends StatefulWidget {
  const MarketplaceScreen({
    super.key,
    this.initialInstanceId,
    this.initialBotId,
  });
  final String? initialInstanceId;
  final String? initialBotId;

  @override
  State<MarketplaceScreen> createState() => _MarketplaceScreenState();
}

class _MarketplaceScreenState extends State<MarketplaceScreen> {
  late final MarketplaceController controller;

  @override
  void initState() {
    super.initState();
    controller = MarketplaceController(
      context.read<SessionController>().client,
    );
    unawaited(
      controller.load(
        initialInstanceId: widget.initialInstanceId,
        initialBotId: widget.initialBotId,
      ),
    );
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) => AppScaffold(
      currentInstanceId: controller.instanceId,
      appBar: AppBar(title: const Text('Marketplace')),
      body: MarketplaceBrowser(controller: controller),
    ),
  );
}

class MarketplaceBrowser extends StatefulWidget {
  const MarketplaceBrowser({super.key, required this.controller});
  final MarketplaceController controller;

  @override
  State<MarketplaceBrowser> createState() => _MarketplaceBrowserState();
}

class _MarketplaceBrowserState extends State<MarketplaceBrowser> {
  String query = '';
  bool installedOnly = false;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller;
      final plugins = c.plugins
          .where(
            (plugin) =>
                plugin.matches(query) &&
                (!installedOnly || plugin.installed != null),
          )
          .toList();
      final categories =
          plugins.map((plugin) => plugin.category).toSet().toList()..sort();
      return ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          const Text(
            'Give your bot new tools',
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w700,
              letterSpacing: -.5,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            "Install reviewed VM plugins, connect accounts when needed, and attach their tools to your bot's conversations.",
            style: TextStyle(color: Vc.muted, height: 1.45),
          ),
          const SizedBox(height: 24),
          TextField(
            onChanged: (value) => setState(() => query = value),
            decoration: const InputDecoration(
              labelText: 'Search plugins',
              hintText: 'Name, publisher or category',
              prefixIcon: Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Discover'),
                selected: !installedOnly,
                onSelected: (_) => setState(() => installedOnly = false),
              ),
              ChoiceChip(
                label: const Text('Installed'),
                selected: installedOnly,
                onSelected: (_) => setState(() => installedOnly = true),
              ),
            ],
          ),
          const SizedBox(height: 24),
          MarketplaceTarget(controller: c),
          const SizedBox(height: 24),
          if (c.loadingCatalog)
            const LinearProgressIndicator(
              semanticsLabel: 'Loading marketplace catalog',
            ),
          if (c.catalogError != null)
            MarketplaceMessage(
              c.catalogError!,
              error: true,
              action: 'Retry catalog',
              onAction: c.loadingCatalog ? null : () => c.loadCatalog(),
            ),
          if (!c.loadingCatalog &&
              c.catalogError == null &&
              c.catalog.isEmpty &&
              !installedOnly)
            const MarketplaceMessage('No reviewed plugins are published yet.'),
          if (installedOnly && !c.inventoryKnown)
            const MarketplaceMessage(
              'Choose a supported VM and load its inventory to see installed plugins.',
            ),
          if (plugins.isEmpty &&
              !c.loadingCatalog &&
              (!installedOnly || c.inventoryKnown))
            MarketplaceMessage(
              query.trim().isNotEmpty
                  ? 'No plugins match your search.'
                  : installedOnly
                  ? 'No plugins installed in this bot VM. Browse Discover to install a reviewed release.'
                  : 'Nothing to show. Retry the catalog if it could not be loaded.',
            ),
          for (final category in categories) ...[
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Text(
                category,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            for (final plugin in plugins.where(
              (plugin) => plugin.category == category,
            ))
              _pluginRow(context, c, plugin),
            const SizedBox(height: 20),
          ],
          const Divider(),
          const SizedBox(height: 16),
          const Text(
            'About skills',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          const Text(
            'This marketplace connects VM-managed MCP tools. A skills install or activation flow is not available here. Capabilities are shown only when declared by the catalog or installed manifest.',
            style: TextStyle(color: Vc.muted, height: 1.45),
          ),
        ],
      );
    },
  );

  void _openPlugin(BuildContext context, MarketplaceController c, String id) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MarketplaceDetail(controller: c, pluginId: id),
      ),
    );
  }

  Widget _pluginRow(
    BuildContext context,
    MarketplaceController c,
    MarketplacePlugin plugin,
  ) => Column(
    children: [
      InkWell(
        onTap: () => _openPlugin(context, c, plugin.id),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              MarketplaceIcon(plugin: plugin),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      plugin.name,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      plugin.publisher,
                      style: const TextStyle(color: Vc.muted, fontSize: 12),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      plugin.description,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Vc.muted, height: 1.4),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${plugin.version} · ${plugin.installed == null
                          ? 'View plugin'
                          : plugin.enabled
                          ? 'Enabled in VM'
                          : 'Installed · disabled'}',
                      style: const TextStyle(color: Vc.greenSoft, fontSize: 12),
                    ),
                    TextButton(
                      onPressed: () => _openPlugin(context, c, plugin.id),
                      child: Text(
                        plugin.installed == null
                            ? 'View & install'
                            : 'Manage plugin',
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right, color: Vc.muted, size: 20),
            ],
          ),
        ),
      ),
      const Divider(),
    ],
  );
}
