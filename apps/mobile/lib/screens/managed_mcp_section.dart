import 'dart:async';
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
  List<String> bots = const ['main'];
  String botId = 'main';
  String? pluginId;
  String? serverId;
  Map<String, dynamic> bindings = {};
  List<Map<String, dynamic>> plugins = [];
  String? error;
  bool busy = false;
  Timer? poll;
  int requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    if (widget.superchargeRuntime) {
      unawaited(_loadBots());
      unawaited(_status());
    }
  }

  @override
  void dispose() {
    poll?.cancel();
    sessionController.dispose();
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
    final selected = plugins
        .where((plugin) => plugin['id'] == pluginId)
        .firstOrNull;
    final manifest = selected?['manifest'];
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
        TextButton(
          onPressed: busy ? null : () => unawaited(_status()),
          child: const Text('Refresh status'),
        ),
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
                  }),
          ),
        if (selected != null) ...[
          const SizedBox(height: 8),
          Text(
            'Permissions: ${((manifest as Map?)?['permissions'] as List?)?.join(', ') ?? 'none'} · ${selected['trusted'] == true ? 'trusted' : 'needs approval'} · ${selected['enabled'] == true ? 'enabled' : 'disabled'}',
            style: const TextStyle(color: Vc.muted, fontSize: 12),
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
        TextField(
          controller: sessionController,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'Conversation session ID',
          ),
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
          'Review, configure, trust, enable and verify tools from the web dashboard. This device never receives Plugin API credentials or sandbox management tokens.',
          style: TextStyle(color: Vc.muted, fontSize: 11),
        ),
      ],
    );
  }
}
