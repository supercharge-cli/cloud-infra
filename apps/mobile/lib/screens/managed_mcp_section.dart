import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';

import '../api/client.dart';
import '../theme.dart';

class ManagedMcpSection extends StatefulWidget {
  const ManagedMcpSection({
    super.key,
    required this.api,
    required this.instanceId,
    required this.superchargeRuntime,
  });

  final VectraClient api;
  final String instanceId;
  final bool superchargeRuntime;

  @override
  State<ManagedMcpSection> createState() => _ManagedMcpSectionState();
}

class _ManagedMcpSectionState extends State<ManagedMcpSection> {
  final sessionController = TextEditingController();
  final configurationController = TextEditingController();
  bool permissionsApproved = false;
  List<String> bots = const ['main'];
  String botId = 'main';
  String? pluginId;
  String? serverId;
  Map<String, dynamic> bindings = {};
  List<Map<String, dynamic>> plugins = [];
  List<Map<String, dynamic>> catalog = [];
  List<Map<String, dynamic>> conversations = [];
  String? catalogId;
  String? notice;
  String? error;
  bool busy = false;
  Timer? poll;
  int requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    if (widget.superchargeRuntime) {
      unawaited(_loadBots());
      unawaited(_loadCatalog());
      unawaited(_loadConversations());
      unawaited(_status());
    }
  }

  @override
  void dispose() {
    poll?.cancel();
    sessionController.dispose();
    configurationController.dispose();
    super.dispose();
  }

  Future<void> _loadBots() async {
    try {
      final response = await widget.api.listBots(widget.instanceId);
      final loaded = (response['bots'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map((bot) => '${bot['id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toList();
      if (!mounted) return;
      setState(() {
        bots = loaded.isEmpty ? const ['main'] : loaded;
        if (!bots.contains(botId)) botId = bots.first;
      });
    } catch (_) {
      if (mounted) {
        setState(() => error = 'Could not load bots. Refresh when connected.');
      }
    }
  }

  Future<void> _loadCatalog() async {
    try {
      final response = await widget.api.managedMcpCatalog();
      final entries = response['plugins'];
      if (!mounted) return;
      setState(() {
        catalog = entries is List
            ? entries
                  .whereType<Map>()
                  .map((entry) => Map<String, dynamic>.from(entry))
                  .toList()
            : [];
        if (!catalog.any((entry) => entry['id'] == catalogId)) {
          catalogId = catalog.isEmpty ? null : '${catalog.first['id']}';
        }
      });
    } catch (failure) {
      if (mounted) setState(() => error = '$failure');
    }
  }

  Future<void> _loadConversations() async {
    final selectedBot = botId;
    try {
      final response = await widget.api.listConversations(
        widget.instanceId,
        botId: selectedBot,
      );
      if (!mounted || selectedBot != botId) return;
      final entries = response['conversations'];
      setState(
        () => conversations = entries is List
            ? entries
                  .whereType<Map>()
                  .map((entry) => Map<String, dynamic>.from(entry))
                  .where(
                    (entry) =>
                        entry['botId'] == selectedBot &&
                        entry['source'] != 'group',
                  )
                  .toList()
            : [],
      );
    } catch (failure) {
      if (mounted && selectedBot == botId) setState(() => error = '$failure');
    }
  }

  Future<void> _status() async {
    final generation = ++requestGeneration;
    try {
      final response = await widget.api.botManagedMcp(
        widget.instanceId,
        botId,
        {'action': 'status'},
      );
      if (!mounted || generation != requestGeneration) return;
      final inventory = response['inventory'];
      final items = inventory is Map ? inventory['plugins'] : null;
      setState(() {
        bindings = Map<String, dynamic>.from(
          response['bindings'] as Map? ?? const {},
        );
        plugins = items is List
            ? items
                  .whereType<Map>()
                  .map((item) => Map<String, dynamic>.from(item))
                  .toList()
            : [];
        if (!plugins.any((item) => item['id'] == pluginId)) {
          pluginId = plugins.isEmpty ? null : '${plugins.first['id']}';
          serverId = null;
        }
        error = null;
      });
    } catch (failure) {
      if (mounted && generation == requestGeneration) {
        setState(() => error = '$failure');
      }
    }
  }

  Future<void> _pluginAction(String action, Map<String, dynamic> input) async {
    final selected = plugins
        .where((plugin) => plugin['id'] == pluginId)
        .firstOrNull;
    if (selected == null || selected['revision'] is! int) return;
    await _act('pluginAction', {
      'pluginId': selected['id'],
      'pluginAction': {
        'action': action,
        'expectedRevision': selected['revision'],
        ...input,
      },
      'requestId': DateTime.now().microsecondsSinceEpoch.toString(),
    });
  }

  Future<void> _act(String action, Map<String, dynamic> input) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.api.botManagedMcp(widget.instanceId, botId, {
        'action': action,
        ...input,
      });
      if (!mounted) return;
      setState(
        () => notice = action == 'installCatalog'
            ? 'Installed disabled and untrusted. Review permissions and configure before enabling.'
            : action == 'apply'
            ? 'Binding requested. Wait for agent discovery before verification.'
            : null,
      );
      await _status();
    } catch (failure) {
      if (mounted) {
        setState(
          () => error =
              '$failure Refresh status before retrying an unknown outcome.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.superchargeRuntime) {
      return const Text(
        'Managed MCP is available on Supercharge sandboxes only.',
        style: TextStyle(color: Vc.muted),
      );
    }
    final selectedCatalog = catalog
        .where((entry) => entry['id'] == catalogId)
        .firstOrNull;
    final installedCatalog = plugins
        .where((plugin) => plugin['id'] == catalogId)
        .firstOrNull;
    final selected = plugins
        .where((plugin) => plugin['id'] == pluginId)
        .firstOrNull;
    final manifest = selected?['manifest'];
    final declaredConfig = manifest is Map ? manifest['userConfig'] : null;
    final definitions = manifest is Map ? manifest['mcpServers'] : null;
    final servers = definitions is Map
        ? definitions.keys.map((key) => '$key').toList()
        : <String>[];
    final activeServer = servers.contains(serverId)
        ? serverId
        : servers.firstOrNull;
    final sessionId = sessionController.text.trim();
    final binding = bindings[sessionId];
    final bindingMap = binding is Map
        ? Map<String, dynamic>.from(binding)
        : null;
    final revision = bindingMap?['revision'];
    final state = '${bindingMap?['status'] ?? 'not configured'}';
    final needsPoll = state == 'waiting' || state == 'removing';
    if (needsPoll && poll == null) {
      poll = Timer.periodic(const Duration(seconds: 2), (_) {
        if (!busy) unawaited(_status());
      });
    } else if (!needsPoll && poll != null) {
      poll?.cancel();
      poll = null;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          initialValue: botId,
          decoration: const InputDecoration(labelText: 'Bot'),
          items: [
            for (final id in bots)
              DropdownMenuItem(
                value: id,
                child: Text(id == 'main' ? 'Main' : id),
              ),
          ],
          onChanged: busy
              ? null
              : (value) {
                  if (value == null || value == botId) return;
                  requestGeneration++;
                  setState(() {
                    botId = value;
                    pluginId = null;
                    serverId = null;
                    bindings = {};
                    plugins = [];
                  });
                  unawaited(_status());
                  unawaited(_loadConversations());
                },
        ),
        const SizedBox(height: 8),
        Text(
          'Conversation state: $state',
          style: const TextStyle(color: Vc.muted, fontSize: 12),
        ),
        if (bindingMap?['lastError'] != null)
          Text(
            '${bindingMap!['lastError']}',
            style: const TextStyle(color: Vc.red, fontSize: 12),
          ),
        if (error != null)
          Text(error!, style: const TextStyle(color: Vc.red, fontSize: 12)),
        if (notice != null)
          Text(notice!, style: const TextStyle(color: Vc.muted, fontSize: 12)),
        TextButton(
          onPressed: busy ? null : () => unawaited(_status()),
          child: const Text('Refresh status'),
        ),
        const SizedBox(height: 12),
        const Text(
          'Shared reviewed catalog',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        const Text(
          'The same public list appears in Supercharge desktop. Connect installs this pinned release only in this bot VM.',
          style: TextStyle(color: Vc.muted, fontSize: 12),
        ),
        if (catalog.isNotEmpty)
          DropdownButtonFormField<String>(
            initialValue: selectedCatalog?['id'] as String?,
            decoration: const InputDecoration(labelText: 'Catalog plugin'),
            items: [
              for (final entry in catalog)
                DropdownMenuItem(
                  value: '${entry['id']}',
                  child: Text('${entry['name']} · ${entry['version']}'),
                ),
            ],
            onChanged: busy
                ? null
                : (value) => setState(() {
                    catalogId = value;
                    pluginId = value;
                    permissionsApproved = false;
                  }),
          ),
        if (selectedCatalog != null) ...[
          Text(
            '${selectedCatalog['description'] ?? ''} · permissions: ${((selectedCatalog['manifest'] as Map?)?['permissions'] as List?)?.join(', ') ?? 'none'} · SHA-256 ${((selectedCatalog['source'] as Map?)?['sha256'] ?? '').toString().substring(0, 16)}…',
            style: const TextStyle(color: Vc.muted, fontSize: 12),
          ),
          FilledButton(
            onPressed: busy || installedCatalog != null
                ? null
                : () => unawaited(
                    _act('installCatalog', {
                      'catalogId': selectedCatalog['id'],
                      'catalogSha256':
                          (selectedCatalog['source'] as Map)['sha256'],
                      'requestId': DateTime.now().microsecondsSinceEpoch
                          .toString(),
                    }),
                  ),
            child: Text(
              installedCatalog == null
                  ? 'Connect: install in this VM'
                  : 'Installed; review permissions below',
            ),
          ),
        ],
        const SizedBox(height: 12),
        if (plugins.isNotEmpty)
          DropdownButtonFormField<String>(
            initialValue: selected?['id'] as String?,
            decoration: const InputDecoration(labelText: 'Reviewed plugin'),
            items: [
              for (final plugin in plugins)
                DropdownMenuItem(
                  value: '${plugin['id']}',
                  child: Text(
                    '${(plugin['manifest'] as Map?)?['name'] ?? plugin['id']}',
                  ),
                ),
            ],
            onChanged: busy
                ? null
                : (value) => setState(() {
                    pluginId = value;
                    serverId = null;
                    permissionsApproved = false;
                  }),
          ),
        if (selected != null) ...[
          const SizedBox(height: 8),
          Text(
            'Permissions: ${((manifest as Map?)?['permissions'] as List?)?.join(', ') ?? 'none'} · ${selected['trusted'] == true ? 'trusted' : 'needs approval'} · ${selected['enabled'] == true ? 'enabled' : 'disabled'}',
            style: const TextStyle(color: Vc.muted, fontSize: 12),
          ),
          if (declaredConfig is Map && declaredConfig.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Declared configuration fields: ${declaredConfig.keys.join(', ')}. Values are write-only.',
              style: const TextStyle(color: Vc.muted, fontSize: 12),
            ),
            TextField(
              controller: configurationController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Configuration values (JSON object)',
              ),
            ),
            TextButton(
              onPressed: busy
                  ? null
                  : () {
                      try {
                        final parsed = jsonDecode(configurationController.text);
                        if (parsed is! Map ||
                            parsed.entries.any(
                              (entry) =>
                                  !declaredConfig.containsKey(entry.key) ||
                                  entry.value is! String,
                            )) {
                          throw const FormatException(
                            'Use only declared string fields',
                          );
                        }
                        unawaited(
                          _pluginAction('configure', {
                            'values': parsed,
                          }).then((_) => configurationController.clear()),
                        );
                      } catch (failure) {
                        setState(() => error = '$failure');
                      }
                    },
              child: const Text('Save write-only configuration'),
            ),
          ],
          CheckboxListTile(
            value: permissionsApproved,
            onChanged: busy
                ? null
                : (value) =>
                      setState(() => permissionsApproved = value == true),
            title: const Text('I reviewed these exact permissions'),
          ),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton(
                onPressed:
                    busy || selected['trusted'] == true || !permissionsApproved
                    ? null
                    : () => unawaited(
                        _pluginAction('trust', {
                          'permissions': (manifest as Map)['permissions'],
                        }),
                      ),
                child: const Text('Approve permissions'),
              ),
              FilledButton(
                onPressed:
                    busy ||
                        selected['enabled'] == true ||
                        selected['trusted'] != true
                    ? null
                    : () => unawaited(_pluginAction('enable', {})),
                child: const Text('Enable in VM'),
              ),
            ],
          ),
          if (servers.isNotEmpty)
            DropdownButtonFormField<String>(
              initialValue: activeServer,
              decoration: const InputDecoration(labelText: 'MCP server'),
              items: [
                for (final id in servers)
                  DropdownMenuItem(value: id, child: Text(id)),
              ],
              onChanged: busy
                  ? null
                  : (value) => setState(() => serverId = value),
            ),
        ],
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue:
              conversations.any(
                (thread) => thread['sessionId'] == sessionController.text,
              )
              ? sessionController.text
              : null,
          decoration: const InputDecoration(labelText: 'Existing conversation'),
          items: [
            for (final thread in conversations)
              DropdownMenuItem(
                value: '${thread['sessionId']}',
                child: Text(
                  '${thread['title'] ?? 'Conversation'} · ${thread['sessionId'].toString().substring(0, 12)}…',
                ),
              ),
          ],
          onChanged: busy
              ? null
              : (value) => setState(() => sessionController.text = value ?? ''),
        ),
        TextButton(
          onPressed: busy ? null : () => unawaited(_loadConversations()),
          child: const Text('Refresh conversations'),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton(
              onPressed:
                  busy ||
                      sessionId.isEmpty ||
                      selected?['enabled'] != true ||
                      selected?['trusted'] != true ||
                      activeServer == null
                  ? null
                  : () => unawaited(
                      _act('apply', {
                        'sessionId': sessionId,
                        'pluginId': selected!['id'],
                        'serverId': activeServer,
                        'expectedRevision': revision is int ? revision : null,
                      }),
                    ),
              child: Text(busy ? 'Working…' : 'Apply to conversation'),
            ),
            OutlinedButton(
              onPressed:
                  busy ||
                      sessionId.isEmpty ||
                      revision is! int ||
                      state != 'failed'
                  ? null
                  : () => unawaited(
                      _act('retry', {
                        'sessionId': sessionId,
                        'expectedRevision': revision,
                      }),
                    ),
              child: const Text('Retry'),
            ),
            OutlinedButton(
              onPressed: busy || sessionId.isEmpty || revision is! int
                  ? null
                  : () => unawaited(
                      _act('remove', {
                        'sessionId': sessionId,
                        'expectedRevision': revision,
                      }),
                    ),
              child: const Text('Remove'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        const Text(
          'Review, configure, trust, enable, and attach here. Run a separately consented non-destructive verification in the web dashboard before claiming readiness. This device never receives Plugin API management tokens.',
          style: TextStyle(color: Vc.muted, fontSize: 11),
        ),
      ],
    );
  }
}
