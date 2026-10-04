import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/marketplace.dart';
import '../state/marketplace.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/marketplace.dart';
import '../widgets/side_panel.dart';
import 'marketplace_detail.dart';
import 'skillmd_detail.dart';

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

enum _Section { skills, installed, mcp }

class MarketplaceBrowser extends StatefulWidget {
  const MarketplaceBrowser({super.key, required this.controller});
  final MarketplaceController controller;

  @override
  State<MarketplaceBrowser> createState() => _MarketplaceBrowserState();
}

class _MarketplaceBrowserState extends State<MarketplaceBrowser> {
  final _search = TextEditingController();
  _Section _section = _Section.skills;
  String _mcpQuery = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller;
      final installedCount = c.inventory.length;
      return ListView(
        padding: const EdgeInsets.fromLTRB(18, 20, 18, 40),
        children: [
          const Text(
            'Skills for your agents',
            style: TextStyle(
              fontSize: 27,
              fontWeight: FontWeight.w700,
              letterSpacing: -.5,
            ),
          ),
          const SizedBox(height: 7),
          const Text(
            'Explore SkillMD skills. Review a complete bundle before installing it in your selected VM and bot.',
            style: TextStyle(color: Vc.muted, height: 1.4),
          ),
          const SizedBox(height: 20),
          MarketplaceTarget(controller: c),
          const SizedBox(height: 18),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Skills'),
                selected: _section == _Section.skills,
                onSelected: (_) => setState(() => _section = _Section.skills),
              ),
              ChoiceChip(
                label: Text(
                  'Installed${installedCount > 0 ? ' · $installedCount' : ''}',
                ),
                selected: _section == _Section.installed,
                onSelected: (_) =>
                    setState(() => _section = _Section.installed),
              ),
              ChoiceChip(
                label: const Text('MCP servers'),
                selected: _section == _Section.mcp,
                onSelected: (_) => setState(() => _section = _Section.mcp),
              ),
            ],
          ),
          const SizedBox(height: 22),
          if (_section == _Section.skills) _skills(c),
          if (_section == _Section.installed) _installed(c),
          if (_section == _Section.mcp) _mcp(c),
        ],
      );
    },
  );

  Widget _skills(MarketplaceController c) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text(
        'Browse SkillMD',
        style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 5),
      const Text(
        'Skills are fetched from SkillMD. Installation and approval happen inside the selected VM.',
        style: TextStyle(color: Vc.muted, height: 1.4),
      ),
      const SizedBox(height: 16),
      TextField(
        controller: _search,
        textInputAction: TextInputAction.search,
        onSubmitted: (_) => _searchSkills(c),
        decoration: InputDecoration(
          hintText: 'Search SkillMD skills',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: IconButton(
            tooltip: _search.text.isEmpty ? 'Search' : 'Search skills',
            icon: const Icon(Icons.arrow_forward),
            onPressed: () => _searchSkills(c),
          ),
        ),
        onChanged: (_) => setState(() {}),
      ),
      if (c.skillsQuery.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Results for “${c.skillsQuery}” · up to 48 from SkillMD',
                  style: const TextStyle(color: Vc.muted, fontSize: 12),
                ),
              ),
              TextButton(
                onPressed: () {
                  _search.clear();
                  c.loadSkills();
                },
                child: const Text('Clear'),
              ),
            ],
          ),
        ),
      if (c.loadingSkills)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: LinearProgressIndicator(
            semanticsLabel: 'Loading SkillMD skills',
          ),
        ),
      if (c.skillsError != null)
        MarketplaceMessage(
          c.skillsError!,
          error: true,
          action: 'Retry skills',
          onAction: c.loadingSkills
              ? null
              : () => c.loadSkills(query: c.skillsQuery),
        ),
      if (!c.loadingSkills && c.skills.isEmpty && c.skillsError == null)
        MarketplaceMessage(
          c.skillsQuery.isEmpty
              ? 'No skills available from SkillMD right now.'
              : 'No skills match this search.',
        ),
      for (final item in c.skills) _skillRow(c, item),
      if (c.nextSkillsOffset != null && c.skillsQuery.isEmpty)
        Center(
          child: Padding(
            padding: const EdgeInsets.only(top: 18),
            child: OutlinedButton.icon(
              onPressed: c.loadingMoreSkills
                  ? null
                  : () => c.loadSkills(more: true),
              icon: c.loadingMoreSkills
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more),
              label: const Text('Load more skills'),
            ),
          ),
        ),
      if (c.nextSkillsOffset == null &&
          c.skillsQuery.isEmpty &&
          c.skills.isNotEmpty)
        const Padding(
          padding: EdgeInsets.only(top: 15),
          child: Text(
            'End of SkillMD browse pages. Search can find skills beyond these pages.',
            style: TextStyle(color: Vc.muted, fontSize: 12),
          ),
        ),
    ],
  );

  void _searchSkills(MarketplaceController c) {
    FocusManager.instance.primaryFocus?.unfocus();
    final query = _search.text.trim();
    if (query.isNotEmpty && query.length < 2) return;
    unawaited(c.loadSkills(query: query));
  }

  Widget _skillRow(MarketplaceController c, SkillMdItem item) {
    final installed = c.installedSkill(item);
    return Card(
      margin: const EdgeInsets.only(top: 11),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _openSkill(c, item),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.menu_book_outlined, color: Vc.greenSoft),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${item.owner} · ${item.bundle ? 'Bundle' : 'Skill'}${item.verified ? ' · Verified' : ''}${item.category.isEmpty ? '' : ' · ${item.category}'}',
                      style: const TextStyle(color: Vc.greenSoft, fontSize: 12),
                    ),
                    if (item.description.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          item.description,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Vc.muted, height: 1.4),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Text(
                      c.supported && c.botId != null
                          ? installed == null
                                ? 'Review to install'
                                : installed.enabled
                                ? 'Enabled · Manage'
                                : 'Installed · Review'
                          : 'View on SkillMD · select a VM to install',
                      style: const TextStyle(color: Vc.greenSoft, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Vc.muted, size: 19),
            ],
          ),
        ),
      ),
    );
  }

  Widget _installed(MarketplaceController c) {
    if (!c.inventoryKnown) {
      return const MarketplaceMessage(
        'Choose a supported VM and bot, then refresh its inventory to see installed skills and servers.',
      );
    }
    if (c.inventory.isEmpty) {
      return const MarketplaceMessage(
        'Nothing installed yet. Browse skills, review a bundle, then install it for this bot.',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Installed for this bot',
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        const Text(
          'Installations stay on the selected VM and bot.',
          style: TextStyle(color: Vc.muted),
        ),
        for (final plugin in c.plugins.where((item) => item.installed != null))
          _installedRow(c, plugin),
      ],
    );
  }

  Widget _installedRow(MarketplaceController c, MarketplacePlugin plugin) {
    final name = plugin.manifest['name'];
    final skill =
        plugin.id.startsWith('skillmd-') &&
        name is String &&
        RegExp(r'^[A-Za-z0-9_.-]{1,80}/[A-Za-z0-9_.-]{1,120}$').hasMatch(name);
    return Card(
      margin: const EdgeInsets.only(top: 11),
      child: ListTile(
        leading: Icon(
          skill ? Icons.menu_book_outlined : Icons.extension_outlined,
          color: Vc.greenSoft,
        ),
        title: Text(plugin.name),
        subtitle: Text(
          '${plugin.enabled ? 'Enabled' : 'Disabled'} · ${plugin.trusted ? 'Approved' : 'Not approved'}',
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: skill
            ? () {
                final parts = name.split('/');
                _openSkill(
                  c,
                  SkillMdItem({
                    'id': 'skillmd:$name',
                    'pluginId': plugin.id,
                    'owner': parts[0],
                    'name': parts[1],
                  }),
                );
              }
            : () => _openPlugin(c, plugin.id),
      ),
    );
  }

  Widget _mcp(MarketplaceController c) {
    final plugins = c.plugins
        .where((plugin) => plugin.matches(_mcpQuery))
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Reviewed MCP servers',
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 5),
        const Text(
          'Reviewed, checksum-pinned releases. Their permissions and accounts are separate from SkillMD skills.',
          style: TextStyle(color: Vc.muted, height: 1.4),
        ),
        const SizedBox(height: 16),
        TextField(
          onChanged: (value) => setState(() => _mcpQuery = value),
          decoration: const InputDecoration(
            labelText: 'Search MCP servers',
            prefixIcon: Icon(Icons.search),
          ),
        ),
        if (c.loadingCatalog)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: LinearProgressIndicator(
              semanticsLabel: 'Loading reviewed servers',
            ),
          ),
        if (c.catalogError != null)
          MarketplaceMessage(
            c.catalogError!,
            error: true,
            action: 'Retry catalog',
            onAction: c.loadingCatalog ? null : c.loadCatalog,
          ),
        if (!c.loadingCatalog && plugins.isEmpty)
          const MarketplaceMessage(
            'No reviewed servers match. Retry the catalog if it could not load.',
          ),
        for (final plugin in plugins)
          Card(
            margin: const EdgeInsets.only(top: 11),
            child: ListTile(
              leading: MarketplaceIcon(plugin: plugin),
              title: Text(plugin.name),
              subtitle: Text(
                '${plugin.publisher} · ${plugin.version}\n${plugin.description}',
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _openPlugin(c, plugin.id),
            ),
          ),
      ],
    );
  }

  void _openSkill(MarketplaceController c, SkillMdItem item) {
    if (!c.supported || c.botId == null) {
      final uri = Uri.tryParse(item.sourceUrl);
      if (uri != null && uri.scheme == 'https' && uri.host == 'skillmd.com') {
        unawaited(launchUrl(uri, mode: LaunchMode.externalApplication));
      }
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SkillMdDetail(controller: c, item: item),
      ),
    );
  }

  void _openPlugin(MarketplaceController c, String id) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MarketplaceDetail(controller: c, pluginId: id),
      ),
    );
  }
}
