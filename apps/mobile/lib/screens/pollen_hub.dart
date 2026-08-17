import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

class PollenHubScreen extends StatefulWidget {
  const PollenHubScreen({super.key});

  @override
  State<PollenHubScreen> createState() => _PollenHubScreenState();
}

class _PollenHubScreenState extends State<PollenHubScreen> {
  Map<String, dynamic>? st;
  String? msg;
  String? overlay;

  VectraClient get api => context.read<SessionController>().client;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await api.pollinationsStatus();
      if (mounted) setState(() => st = data);
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
  }

  Future<void> _run(String label, Future<void> Function() fn) async {
    setState(() {
      overlay = label;
      msg = null;
    });
    try {
      await fn();
    } catch (e) {
      msg = e.toString();
    }
    if (mounted) setState(() => overlay = null);
  }

  Future<void> _connect() => _run('Opening Pollinations…', () async {
        final url = await api.pollinationsConnectUrl();
        final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        if (!ok) throw ApiException(0, 'Could not open the browser');
        msg = 'Finish in the browser. Vectra will open when Pollen is connected.';
      });

  Future<void> _disconnect() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disconnect Pollinations?'),
        content: const Text('New workspaces will not get this key. Existing VMs keep it until it expires.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Disconnect')),
        ],
      ),
    );
    if (ok != true) return;
    await _run('Disconnecting…', () async {
      await api.pollinationsDisconnect();
      await _load();
      msg = 'Disconnected.';
    });
  }

  Future<void> _apply() => _run('Applying to all workspaces…', () async {
        final r = await api.pollinationsApplyAll();
        await _load();
        msg = 'Applied to ${r['applied'] ?? 0} of ${r['total'] ?? 0} workspaces.';
      });

  @override
  Widget build(BuildContext context) {
    final connected = st?['connected'] == true;
    final expired = st?['expired'] == true;
    final workspaces = st?['workspaces'] is Map ? Map<String, dynamic>.from(st!['workspaces'] as Map) : null;
    final title = '${st?['name'] ?? st?['username'] ?? st?['email'] ?? 'Pollinations'}';

    return AppScaffold(
      appBar: AppBar(title: const Text('Pollinations')),
      body: Stack(
        children: [
          ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                decoration: BoxDecoration(
                  color: const Color(0xFF102216),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Vc.green.withValues(alpha: 0.35)),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'BEST · CHEAPEST',
                      style: TextStyle(
                        color: Vc.greenSoft,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.2,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Connect once. Every VM you create uses your Pollen — GPT, Claude, Gemini, Qwen. No per-workspace key.',
                      style: TextStyle(color: Colors.white, height: 1.4, fontSize: 14),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              VcPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (connected) ...[
                      const Text('CONNECTED', style: TextStyle(color: Vc.green, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.3)),
                      const SizedBox(height: 6),
                      Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text(
                        [
                          if (st?['expiresAt'] != null) 'Expires ${_shortDate('${st!['expiresAt']}')}',
                          if (workspaces != null) '${workspaces['applied'] ?? 0}/${workspaces['total'] ?? 0} workspaces',
                        ].join(' · '),
                        style: const TextStyle(color: Vc.muted, fontSize: 13),
                      ),
                      const SizedBox(height: 14),
                      FilledButton(
                        onPressed: overlay != null ? null : _apply,
                        child: const SizedBox(width: double.infinity, child: Text('Apply to all workspaces', textAlign: TextAlign.center)),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: overlay != null ? null : _connect,
                        child: const SizedBox(width: double.infinity, child: Text('Reconnect', textAlign: TextAlign.center)),
                      ),
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: overlay != null ? null : _disconnect,
                        child: const SizedBox(
                          width: double.infinity,
                          child: Text('Disconnect', textAlign: TextAlign.center, style: TextStyle(color: Vc.red)),
                        ),
                      ),
                    ] else ...[
                      Text(
                        expired ? 'Key expired — reconnect to keep using Pollinations.' : 'Not connected yet.',
                        style: const TextStyle(height: 1.4),
                      ),
                      const SizedBox(height: 14),
                      FilledButton.icon(
                        onPressed: overlay != null || st?['configured'] == false ? null : _connect,
                        icon: const Icon(Icons.eco_outlined, size: 18),
                        label: const Text('Connect with Pollinations'),
                      ),
                    ],
                    if (msg != null) ...[
                      const SizedBox(height: 10),
                      Text(msg!, style: const TextStyle(color: Vc.muted, fontSize: 12)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const SectionTitle('Pollen', subtitle: 'Live from your Pollinations key'),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _chip('Left', _pollen((st?['balance'] as Map?)?['remaining'])),
                  _chip('Paid', _pollen((st?['balance'] as Map?)?['paid'])),
                  _chip('Quest', _pollen((st?['balance'] as Map?)?['quest'])),
                  _chip('Workspaces', workspaces == null ? '—' : '${workspaces['applied'] ?? 0}/${workspaces['total'] ?? 0}'),
                ],
              ),
              if (st?['scopeHint'] != null) ...[
                const SizedBox(height: 10),
                Text('${st!['scopeHint']}', style: const TextStyle(color: Vc.amber, fontSize: 12)),
              ],
              if ((st?['daily'] as List?)?.isNotEmpty == true) ...[
                const SizedBox(height: 18),
                const SectionTitle('Daily spend'),
                for (final row in (st!['daily'] as List).take(10))
                  if (row is Map)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text('${row['day'] ?? '—'}'),
                      trailing: Text(
                        '${_pollen(row['cost'])} · ${row['requests'] ?? 0} req',
                        style: const TextStyle(color: Vc.muted),
                      ),
                    ),
              ],
              if ((st?['recent'] as List?)?.isNotEmpty == true) ...[
                const SizedBox(height: 10),
                const SectionTitle('Recent requests'),
                for (final row in (st!['recent'] as List).take(15))
                  if (row is Map)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text('${row['model'] ?? row['kind'] ?? 'request'}'),
                      subtitle: Text('${row['at'] ?? ''}', style: const TextStyle(color: Vc.faint, fontSize: 11)),
                      trailing: Text(_pollen(row['cost']), style: const TextStyle(color: Vc.greenSoft)),
                    ),
              ],
              if ((st?['models'] as List?)?.isNotEmpty == true) ...[
                const SizedBox(height: 10),
                const SectionTitle('Model costing', subtitle: 'Text = pollen / 1M tokens · image = pollen / image'),
                for (final row in (st!['models'] as List).take(40))
                  if (row is Map)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text('${row['name']}'),
                      subtitle: Text('${row['category'] ?? ''}', style: const TextStyle(color: Vc.faint, fontSize: 11)),
                      trailing: SizedBox(
                        width: 150,
                        child: Text(
                          '${row['label'] ?? ''}',
                          textAlign: TextAlign.right,
                          style: const TextStyle(color: Vc.greenSoft, fontSize: 12),
                        ),
                      ),
                    ),
              ],
            ],
          ),
          if (overlay != null) BusyOverlay(message: overlay!),
        ],
      ),
    );
  }

  Widget _chip(String label, String value) {
    return Container(
      width: (MediaQuery.sizeOf(context).width - 40) / 2,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: Vc.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Vc.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: const TextStyle(color: Vc.faint, fontSize: 10, letterSpacing: 0.8, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(value, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

String _pollen(Object? v) {
  if (v is! num) return '—';
  final n = v.toDouble();
  if (n.abs() >= 100) return n.toStringAsFixed(1);
  if (n.abs() >= 1) return n.toStringAsFixed(3).replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  return n.toStringAsPrecision(3);
}

String _shortDate(String raw) {
  final d = DateTime.tryParse(raw);
  if (d == null) return raw;
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
