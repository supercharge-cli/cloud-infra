import 'package:flutter/material.dart';

import '../api/client.dart';
import '../theme.dart';

/// Managed MCP (isolated Plugin API) controls for one owned instance.
///
/// The app is only a controller: it sends owner-checked actions to the Vectra
/// API and never receives or stores Plugin API credentials, bridge tokens, or
/// sandbox target identity. Applied state comes from the sandbox daemon.
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
  List<String> bots = const ['main'];
  String botId = 'main';
  String? statusLine;
  String? error;
  String sessionId = '';
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _loadBots();
  }

  Future<void> _loadBots() async {
    if (!widget.superchargeRuntime) return;
    try {
      final data = await widget.api.listBots(widget.instanceId);
      final list = (data['bots'] as List<dynamic>? ?? const [])
          .map((bot) => '${(bot as Map)['id'] ?? ''}')
          .where((id) => id.isNotEmpty)
          .toList();
      if (!mounted) return;
      setState(() {
        bots = list.isEmpty ? const ['main'] : list;
        if (!bots.contains(botId)) botId = bots.first;
      });
    } catch (_) {
      // Bot list is a convenience; actions still fail closed per bot.
    }
  }

  Future<void> _run(String action, Map<String, dynamic> extra) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final data = await widget.api.botManagedMcp(widget.instanceId, botId, {
        'action': action,
        ...extra,
      });
      if (!mounted) return;
      final binding =
          data['bindings'] is Map && (data['bindings'] as Map).isNotEmpty
          ? (data['bindings'] as Map).values.first as Map?
          : data['binding'] as Map?;
      setState(() {
        statusLine = binding == null
            ? 'Not configured'
            : 'Sandbox state: ${binding['status'] ?? 'unknown'}${binding['lastError'] != null ? ' · ${binding['lastError']}' : ''}';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => error = e.toString());
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          initialValue: botId,
          decoration: const InputDecoration(labelText: 'Bot'),
          items: [
            for (final id in bots)
              DropdownMenuItem(value: id, child: Text(id == 'main' ? 'Main' : id)),
          ],
          onChanged: (value) {
            if (value == null || value == botId) return;
            setState(() {
              botId = value;
              statusLine = null;
            });
            _run('status', const {});
          },
        ),
        const SizedBox(height: 8),
        Text(
          statusLine ?? 'Load status to see the sandbox binding state.',
          style: const TextStyle(color: Vc.muted, fontSize: 12),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              error!,
              style: const TextStyle(color: Vc.red, fontSize: 12),
            ),
          ),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton(
              onPressed: busy ? null : () => _run('status', const {}),
              child: const Text('Status'),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                onChanged: (value) => sessionId = value.trim(),
                decoration: const InputDecoration(
                  labelText: 'Conversation session id',
                  isDense: true,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            FilledButton(
              onPressed: busy || sessionId.isEmpty
                  ? null
                  : () => _run('apply', {
                      'sessionId': sessionId,
                      'expectedRevision': null,
                    }),
              child: Text(busy ? 'Working…' : 'Apply'),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: busy || sessionId.isEmpty ? null : () => _run('remove', {'sessionId': sessionId}),
              child: const Text('Remove'),
            ),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Install and verify managed MCP definitions from the web dashboard; '
          'this surface applies or removes the bridge for one conversation. '
          'Credentials never reach the app.',
          style: TextStyle(color: Vc.muted, fontSize: 11),
        ),
      ],
    );
  }
}
