import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/marketplace.dart';
import '../state/marketplace.dart';
import '../theme.dart';
import '../widgets/marketplace.dart';

class MarketplaceDiscoveryDetail extends StatelessWidget {
  const MarketplaceDiscoveryDetail({
    super.key,
    required this.plugin,
    required this.source,
  });

  final DiscoveryPlugin plugin;
  final Map<String, dynamic> source;

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(plugin.url);
    final sourceUrl =
        uri != null &&
            (uri.scheme == 'https' || uri.scheme == 'http') &&
            uri.host.isNotEmpty &&
            uri.userInfo.isEmpty
        ? uri
        : null;
    return Scaffold(
      appBar: AppBar(title: const Text('Plugin discovery')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Text(
            plugin.name,
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text('${plugin.publisher} · ${plugin.category}'),
          const SizedBox(height: 20),
          Text(plugin.description),
          const SizedBox(height: 20),
          const MarketplaceMessage(
            'Browse only — not supported in VM. This community listing is not a reviewed release and cannot be installed, configured, approved, enabled or attached here.',
          ),
          Text('Upstream authentication policy: ${plugin.auth} (not connected here)'),
          Text('Source: ${source['repository']} @ ${source['commit']}'),
          if (sourceUrl != null)
            TextButton.icon(
              onPressed: () =>
                  launchUrl(sourceUrl, mode: LaunchMode.externalApplication),
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open source link'),
            ),
        ],
      ),
    );
  }
}

class MarketplaceDetail extends StatelessWidget {
  const MarketplaceDetail({
    super.key,
    required this.controller,
    required this.pluginId,
  });
  final MarketplaceController controller;
  final String pluginId;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final plugin = controller.plugin(pluginId);
      return Scaffold(
        appBar: AppBar(title: const Text('Plugin details')),
        body: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                if (plugin != null) ...[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      MarketplaceIcon(plugin: plugin, size: 64),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              plugin.name,
                              style: const TextStyle(
                                fontSize: 26,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              plugin.publisher,
                              style: const TextStyle(color: Vc.muted),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              '${plugin.category} · ${plugin.version}',
                              style: const TextStyle(color: Vc.muted),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Text(plugin.description, style: const TextStyle(height: 1.5)),
                  if (plugin.catalog['version'] != null &&
                      plugin.installed != null &&
                      plugin.catalog['version'] != plugin.version)
                    MarketplaceMessage(
                      'Catalog release: ${plugin.catalog['version']}. Installed release: ${plugin.version}. The VM inventory controls the actions below.',
                    ),
                  if (plugin.capabilities.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    const Text(
                      'Catalog capabilities',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      plugin.capabilities.join(', '),
                      style: const TextStyle(color: Vc.muted),
                    ),
                  ],
                ] else
                  const MarketplaceMessage(
                    'This plugin is not in the loaded catalog or this bot’s inventory. Return to Marketplace or refresh the selected target.',
                  ),
                const SizedBox(height: 28),
                MarketplaceTarget(controller: controller),
                const SizedBox(height: 20),
                if (plugin != null)
                  _PluginFlow(
                    key: ValueKey(
                      '${controller.targetEpoch}-$pluginId-${plugin.installed?['revision']}',
                    ),
                    controller: controller,
                    pluginId: pluginId,
                  ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

class _PluginFlow extends StatefulWidget {
  const _PluginFlow({
    super.key,
    required this.controller,
    required this.pluginId,
  });
  final MarketplaceController controller;
  final String pluginId;

  @override
  State<_PluginFlow> createState() => _PluginFlowState();
}

class _PluginFlowState extends State<_PluginFlow> {
  final fields = <String, TextEditingController>{};
  String? approvedFingerprint;
  String? verifyFingerprint;
  String? sessionId;
  String? serverId;

  @override
  void dispose() {
    for (final field in fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  Widget _heading(String text) => Padding(
    padding: const EdgeInsets.only(top: 26, bottom: 10),
    child: Text(
      text,
      style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final p = c.plugin(widget.pluginId)!;
    final fingerprint = c.reviewFingerprint(p.id);
    if (approvedFingerprint != fingerprint) approvedFingerprint = null;
    if (!c.inventoryKnown) {
      approvedFingerprint = null;
      verifyFingerprint = null;
      for (final field in fields.values) {
        field.clear();
      }
    }
    final canAct = c.canAct && p.reviewedInstallation;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading('Install in this VM'),
        if (p.installed == null) ...[
          const Text(
            'Install the pinned release disabled and untrusted. You will review the installed manifest before it can run.',
            style: TextStyle(color: Vc.muted, height: 1.45),
          ),
          if (!p.supportsVm)
            const MarketplaceMessage(
              'This catalog release does not support Supercharge VMs.',
            ),
          if (p.auth == 'oauth')
            const MarketplaceMessage(
              'OAuth sign-in is not implemented. Installation is unavailable until a supported connection flow exists.',
            ),
          if (p.digest != null) ...[
            const SizedBox(height: 12),
            const Text(
              'Archive SHA-256',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            SelectableText(
              p.digest!,
              style: const TextStyle(color: Vc.muted, fontSize: 12),
            ),
          ] else
            const MarketplaceMessage(
              'No installable pinned release is available for this entry.',
            ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: canAct && p.digest != null && p.supportsVm && p.auth != 'oauth'
                ? () => c.install(p.id)
                : null,
            icon: const Icon(Icons.download_outlined),
            label: const Text('Install in selected bot VM'),
          ),
          const MarketplaceMessage(
            'Exact permissions and required configuration will be read from the VM after installation. No permission consent is assumed from catalog metadata.',
          ),
        ] else ...[
          Text(
            'Installed ${p.version} · ${p.trusted ? 'permissions approved' : 'untrusted'} · ${p.enabled ? 'enabled' : 'disabled'}',
            style: const TextStyle(color: Vc.greenSoft),
          ),
          if (!p.reviewedInstallation)
            const MarketplaceMessage(
              'This installed release does not match the reviewed catalog content digest. Marketplace actions are blocked; manage it in Managed MCP settings.',
              error: true,
            ),
          _heading('Configure'),
          if (p.auth == 'oauth')
            const MarketplaceMessage(
              'OAuth sign-in is not implemented in the mobile marketplace. This release cannot be enabled or attached here, even if configuration fields are present.',
            ),
          if (p.auth != 'none' &&
              p.auth != 'oauth' &&
              p.auth != 'secrets' &&
              p.auth != 'unspecified')
            MarketplaceMessage(
              'Authentication method “${p.auth}” is not supported by this screen.',
            ),
          if (p.config.isEmpty)
            const Text(
              'This installed manifest declares no configuration fields.',
              style: TextStyle(color: Vc.muted, height: 1.45),
            ),
          if (p.config.isNotEmpty) ...[
            const Text(
              'Values are write-only and saved in the selected VM. This device does not store or read them back.',
              style: TextStyle(color: Vc.muted, height: 1.45),
            ),
            const SizedBox(height: 12),
            for (final entry in p.config.entries) ...[
              TextField(
                key: ValueKey('config-${entry.key}'),
                controller: fields.putIfAbsent(
                  entry.key,
                  TextEditingController.new,
                ),
                enabled: canAct,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                enableIMEPersonalizedLearning: false,
                decoration: InputDecoration(
                  labelText:
                      '${entry.key}${marketplaceMap(entry.value)['required'] == true ? ' (required)' : ''}',
                  helperText: p.configuredKeys.contains(entry.key)
                      ? 'Configured in VM · leave blank to keep'
                      : 'Not configured',
                ),
              ),
              const SizedBox(height: 12),
            ],
            OutlinedButton(
              onPressed: canAct && p.reviewable
                  ? () async {
                      final values = <String, String>{
                        for (final entry in fields.entries)
                          if (p.config.containsKey(entry.key) &&
                              entry.value.text.isNotEmpty)
                            entry.key: entry.value.text,
                      };
                      if (values.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Enter a value in a declared configuration field.',
                            ),
                          ),
                        );
                        return;
                      }
                      final action = c.configure(p.id, values);
                      for (final field in fields.values) {
                        field.clear();
                      }
                      await action;
                    }
                  : null,
              child: const Text('Save write-only configuration'),
            ),
          ],
          if (p.missingConfiguration.isNotEmpty)
            MarketplaceMessage(
              'Required before enabling: ${p.missingConfiguration.join(', ')}.',
            ),
          if (!p.authenticationSupported)
            const MarketplaceMessage(
              'Enabling is blocked: this authentication method has no supported configuration contract in the installed manifest.',
            ),
          _heading('Review permissions'),
          if (!p.reviewable)
            const MarketplaceMessage(
              'The VM did not return a reviewable manifest and revision. Refresh VM status; approval and enable are blocked.',
              error: true,
            )
          else ...[
            const Text(
              'These permissions come from the installed VM release, not the catalog.',
              style: TextStyle(color: Vc.muted, height: 1.45),
            ),
            const SizedBox(height: 12),
            if (p.permissions.isEmpty) const Text('No permissions declared.'),
            for (final permission in p.permissions)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.shield_outlined,
                      size: 19,
                      color: Vc.muted,
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(permission)),
                  ],
                ),
              ),
            if (!p.trusted) ...[
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: approvedFingerprint != null,
                onChanged: canAct
                    ? (value) => setState(
                        () => approvedFingerprint = value == true
                            ? fingerprint
                            : null,
                      )
                    : null,
                title: const Text(
                  'I approve these exact permissions for this bot',
                ),
              ),
              OutlinedButton(
                onPressed: canAct && approvedFingerprint != null
                    ? () {
                        final consent = approvedFingerprint!;
                        setState(() => approvedFingerprint = null);
                        c.approve(p.id, consent);
                      }
                    : null,
                child: const Text('Approve permissions'),
              ),
            ] else
              const Text(
                'Permissions approved in this VM.',
                style: TextStyle(color: Vc.greenSoft),
              ),
          ],
          _heading('Enable'),
          FilledButton(
            onPressed:
                canAct &&
                    p.reviewable &&
                    (p.enabled ||
                        (p.trusted &&
                            p.authenticationSupported &&
                            p.missingConfiguration.isEmpty))
                ? () => c.setEnabled(p.id, !p.enabled)
                : null,
            child: Text(p.enabled ? 'Disable in VM' : 'Enable in VM'),
          ),
          _heading('Attach to a conversation'),
          if (p.servers.isEmpty)
            const MarketplaceMessage(
              'No MCP servers are declared in this installed manifest. Skills and other non-MCP capabilities cannot be attached by this screen.',
            )
          else
            ..._attachment(c, p),
        ],
      ],
    );
  }

  List<Widget> _attachment(MarketplaceController c, MarketplacePlugin p) {
    if (!c.conversations.any((row) => row['sessionId'] == sessionId)) {
      sessionId = null;
      verifyFingerprint = null;
    }
    final server = p.servers.contains(serverId) ? serverId : p.servers.first;
    final binding = marketplaceMap(c.bindings[sessionId]);
    final matches =
        binding['pluginId'] == p.id && binding['serverId'] == server;
    final revision = binding['revision'];
    final echo = marketplaceRows(binding['tools'])
        .where(
          (row) =>
              row['name'] is String &&
              p.id == 'vectra-echo' &&
              server == 'echo' &&
              '${row['description']}'.startsWith('vectra-echo/echo/echo:'),
        )
        .firstOrNull;
    final verification =
        '${c.targetEpoch}-${p.id}-$sessionId-$server-$revision-${echo?['name']}';
    if (verification != verifyFingerprint) verifyFingerprint = null;
    final waiting = ['waiting', 'removing'].contains(binding['status']);
    return [
      const Text(
        'The bridge belongs to one conversation. Attaching does not verify readiness.',
        style: TextStyle(color: Vc.muted, height: 1.45),
      ),
      const SizedBox(height: 14),
      DropdownButtonFormField<String>(
        key: ValueKey('server-$server'),
        initialValue: server,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'MCP server'),
        items: [
          for (final id in p.servers)
            DropdownMenuItem(
              value: id,
              child: Text(id, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: c.canAct
            ? (value) => setState(() {
                serverId = value;
                verifyFingerprint = null;
              })
            : null,
      ),
      const SizedBox(height: 12),
      if (c.loadingConversations)
        const LinearProgressIndicator(semanticsLabel: 'Loading conversations'),
      if (c.conversationError != null)
        MarketplaceMessage(c.conversationError!, error: true),
      if (c.conversations.isEmpty &&
          !c.loadingConversations &&
          c.conversationError == null)
        const MarketplaceMessage(
          'No conversations for this bot. Start a direct chat, then refresh conversations.',
        ),
      if (c.conversations.isNotEmpty)
        DropdownButtonFormField<String>(
          key: ValueKey('conversation-$sessionId'),
          initialValue: sessionId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Existing conversation'),
          items: [
            for (final row in c.conversations)
              DropdownMenuItem(
                value: row['sessionId'] as String,
                child: Text(
                  '${row['title'] ?? row['sessionId']}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: c.canAct
              ? (value) => setState(() {
                  sessionId = value;
                  verifyFingerprint = null;
                })
              : null,
        ),
      TextButton(
        onPressed: c.busy || c.loadingConversations
            ? null
            : () => c.loadConversations(),
        child: const Text('Refresh conversations'),
      ),
      if (sessionId != null && binding.isNotEmpty) ...[
        MarketplaceMessage(
          matches
              ? 'Conversation bridge: ${binding['status'] ?? 'unknown'}'
              : 'This conversation has another plugin or server attached. Remove its bridge in Managed MCP settings before replacing it.',
        ),
        if (binding['lastError'] != null)
          MarketplaceMessage('${binding['lastError']}', error: true),
      ],
      FilledButton(
        onPressed:
            c.canAct &&
                p.enabled &&
                p.trusted &&
                p.reviewedInstallation &&
                p.authenticationSupported &&
                sessionId != null &&
                !waiting &&
                (binding.isEmpty ||
                    binding['configured'] == false ||
                    binding['status'] == 'removed')
            ? () => c.attach(p.id, server!, sessionId!)
            : null,
        child: const Text('Attach to conversation'),
      ),
      if (matches && revision is int)
        Wrap(
          spacing: 8,
          children: [
            if (binding['status'] == 'failed')
              OutlinedButton(
                onPressed: c.canAct && p.reviewedInstallation
                    ? () => c.bindingAction(p.id, sessionId!, 'retry')
                    : null,
                child: const Text('Retry attachment'),
              ),
            if (binding['status'] != 'removed')
              OutlinedButton(
                onPressed: c.canAct && !waiting
                    ? () => c.bindingAction(p.id, sessionId!, 'remove')
                    : null,
                child: const Text('Remove bridge'),
              ),
          ],
        ),
      if (matches && binding['status'] == 'ready')
        const MarketplaceMessage('Verified by the VM for this conversation.'),
      if (matches && binding['status'] == 'applied') ...[
        if (p.id == 'vectra-echo' && echo != null) ...[
          const MarketplaceMessage(
            'Optional check: call the discovered Echo tool once with “managed MCP check”. This executes plugin code in the selected VM.',
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: verifyFingerprint != null,
            onChanged: c.canAct
                ? (value) => setState(
                    () =>
                        verifyFingerprint = value == true ? verification : null,
                  )
                : null,
            title: const Text('I consent to this one Echo verification call'),
          ),
          OutlinedButton(
            onPressed: c.canAct && verifyFingerprint == verification
                ? () {
                    setState(() => verifyFingerprint = null);
                    c.bindingAction(
                      p.id,
                      sessionId!,
                      'verify',
                      tool: echo['name'] as String,
                      consent: true,
                    );
                  }
                : null,
            child: const Text('Verify Echo connection'),
          ),
        ] else
          const MarketplaceMessage(
            'Attached, not verified. No supported safe Echo check was discovered. Use the web dashboard for separately consented verification.',
          ),
      ],
    ];
  }
}
