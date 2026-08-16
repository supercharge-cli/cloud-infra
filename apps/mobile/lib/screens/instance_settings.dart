import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/ui.dart';

class InstanceSettingsScreen extends StatefulWidget {
  const InstanceSettingsScreen({super.key, required this.instanceId, this.instance});
  final String instanceId;
  final CloudInstance? instance;

  @override
  State<InstanceSettingsScreen> createState() => _InstanceSettingsScreenState();
}

class _InstanceSettingsScreenState extends State<InstanceSettingsScreen> {
  final provider = TextEditingController(text: 'openai');
  final model = TextEditingController();
  final baseUrl = TextEditingController();
  final apiKey = TextEditingController();
  final telegram = TextEditingController();
  final discord = TextEditingController();
  final slackBot = TextEditingController();
  final slackApp = TextEditingController();
  final pairCode = TextEditingController();
  final cmd = TextEditingController();
  final cwd = TextEditingController(text: '/home/user/workspace');

  CloudInstance? inst;
  Map<String, dynamic>? config;
  Map<String, dynamic>? pairing;
  Map<String, dynamic>? cli;
  String logs = '';
  String logsSource = 'all';
  String? overlay;
  String? msg;
  bool loading = true;
  bool allowAll = false;
  ExecResult? lastExec;

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;

  @override
  void initState() {
    super.initState();
    inst = widget.instance;
    _load();
  }

  @override
  void dispose() {
    provider.dispose();
    model.dispose();
    baseUrl.dispose();
    apiKey.dispose();
    telegram.dispose();
    discord.dispose();
    slackBot.dispose();
    slackApp.dispose();
    pairCode.dispose();
    cmd.dispose();
    cwd.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      msg = null;
    });
    try {
      final cfg = await api.getConfig(id);
      config = cfg;
      final stored = cfg['stored'] as Map<String, dynamic>? ?? {};
      final sandbox = cfg['sandbox'] as Map<String, dynamic>? ?? {};
      provider.text = '${sandbox['provider'] ?? stored['provider'] ?? 'openai'}';
      model.text = '${sandbox['model'] ?? stored['model'] ?? ''}';
      baseUrl.text = '${sandbox['baseUrl'] ?? stored['baseUrl'] ?? ''}';
      allowAll = sandbox['allowAllUsers'] == true || stored['allowAllUsers'] == true;
      pairing = await api.pairing(id).catchError((_) => <String, dynamic>{});
      cli = await api.cliVersion(id).catchError((_) => <String, dynamic>{});
    } catch (e) {
      msg = e.toString();
    }
    if (mounted) setState(() => loading = false);
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

  Future<void> _save() async {
    await _run('Saving config & restarting daemon…', () async {
      await api.saveConfig(id, {
        'provider': provider.text.trim(),
        'model': model.text.trim(),
        'baseUrl': baseUrl.text.trim(),
        if (apiKey.text.trim().isNotEmpty) 'apiKey': apiKey.text.trim(),
        if (telegram.text.trim().isNotEmpty) 'telegramBotToken': telegram.text.trim(),
        if (discord.text.trim().isNotEmpty) 'discordBotToken': discord.text.trim(),
        if (slackBot.text.trim().isNotEmpty) 'slackBotToken': slackBot.text.trim(),
        if (slackApp.text.trim().isNotEmpty) 'slackAppToken': slackApp.text.trim(),
        'allowAllUsers': allowAll,
        'restart': true,
      });
      msg = 'Saved. Daemon restarted.';
      await _load();
    });
  }

  Future<void> _wake() => _run('Waking sandbox…', () async {
        await api.wake(id);
        msg = 'Wake sent.';
      });

  Future<void> _restart() => _run('Restarting daemon…', () async {
        await api.restart(id);
        msg = 'Daemon restarted.';
      });

  Future<void> _logs(String source) => _run('Pulling $source logs…', () async {
        final data = await api.logs(id, source: source);
        logsSource = source;
        logs = '${data['text'] ?? ((data['logs'] as List?) ?? const []).join('\n')}';
        if (logs.trim().isEmpty) logs = '(no log output)';
      });

  Future<void> _exec() async {
    final command = cmd.text.trim();
    if (command.isEmpty) return;
    await _run('Running command…', () async {
      lastExec = await api.exec(id, command: command, cwd: cwd.text.trim());
    });
  }

  Future<void> _pair() async {
    final code = pairCode.text.trim();
    if (code.isEmpty) return;
    await _run('Approving pair code…', () async {
      await api.approvePair(id, code: code);
      pairCode.clear();
      pairing = await api.pairing(id);
      msg = 'Pairing updated.';
    });
  }

  Future<void> _updateCli() => _run('Updating CLI (install + restart)…', () async {
        await api.cliUpdate(id);
        cli = await api.cliVersion(id);
        msg = 'CLI update finished.';
      });

  Future<void> _destroy() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Vc.card,
        title: const Text('Destroy sandbox?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Vc.red, foregroundColor: Colors.black),
            child: const Text('Destroy'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _run('Destroying instance…', () async {
      await api.destroy(id);
      if (mounted) context.go('/');
    });
  }

  @override
  Widget build(BuildContext context) {
    final root = pairing?['pairing'] is Map
        ? Map<String, dynamic>.from(pairing!['pairing'] as Map)
        : pairing;
    final pending = (root?['pending'] as List?) ?? const [];
    return Scaffold(
      appBar: AppBar(
        title: Text(inst?.name ?? 'Control'),
        actions: [
          IconButton(
            onPressed: () => context.push('/chat/$id', extra: inst),
            icon: const Icon(Icons.chat_bubble_outline),
          ),
        ],
      ),
      body: Stack(
        children: [
          if (loading)
            const Center(child: CircularProgressIndicator(color: Vc.green))
          else
            ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                if (msg != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(msg!, style: TextStyle(color: msg!.startsWith('Saved') || msg!.contains('OK') || msg!.contains('finished') || msg!.contains('sent') || msg!.contains('restarted') ? Vc.green : Vc.red)),
                  ),
                Row(
                  children: [
                    Text(inst?.name ?? id, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
                    const SizedBox(width: 8),
                    StateChip(inst?.displayState ?? 'unknown'),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    ControlButton(icon: Icons.bolt, label: 'Wake', onTap: _wake, color: Vc.amber),
                    const SizedBox(width: 8),
                    ControlButton(icon: Icons.restart_alt, label: 'Restart', onTap: _restart, color: Vc.blue),
                    const SizedBox(width: 8),
                    ControlButton(icon: Icons.delete_outline, label: 'Destroy', onTap: _destroy, color: Vc.red),
                  ],
                ),
                const SizedBox(height: 20),
                const SectionTitle('AI'),
                TextField(controller: provider, decoration: const InputDecoration(labelText: 'Provider')),
                const SizedBox(height: 8),
                TextField(controller: model, decoration: const InputDecoration(labelText: 'Model')),
                const SizedBox(height: 8),
                TextField(controller: baseUrl, decoration: const InputDecoration(labelText: 'Base URL')),
                const SizedBox(height: 8),
                TextField(controller: apiKey, obscureText: true, decoration: const InputDecoration(labelText: 'API key (leave blank to keep)')),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Allow all users (skip pairing)'),
                  value: allowAll,
                  activeThumbColor: Vc.green,
                  onChanged: (v) => setState(() => allowAll = v),
                ),
                FilledButton(onPressed: overlay == null ? _save : null, child: const Text('Save & restart daemon')),
                const SizedBox(height: 20),
                const SectionTitle('Chat channels (optional)'),
                TextField(controller: telegram, obscureText: true, decoration: const InputDecoration(labelText: 'Telegram bot token')),
                const SizedBox(height: 8),
                TextField(controller: discord, obscureText: true, decoration: const InputDecoration(labelText: 'Discord bot token')),
                const SizedBox(height: 8),
                TextField(controller: slackBot, obscureText: true, decoration: const InputDecoration(labelText: 'Slack bot token')),
                const SizedBox(height: 8),
                TextField(controller: slackApp, obscureText: true, decoration: const InputDecoration(labelText: 'Slack app token')),
                const SizedBox(height: 20),
                const SectionTitle('Pairing'),
                if (pending.isEmpty)
                  const Text('No pending codes.', style: TextStyle(color: Vc.muted))
                else
                  for (final p in pending)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text('${(p as Map)['code'] ?? ''}'),
                      subtitle: Text('${p['platform'] ?? ''} · ${p['userId'] ?? ''}'),
                    ),
                Row(
                  children: [
                    Expanded(
                      child: TextField(controller: pairCode, decoration: const InputDecoration(labelText: 'Approve code')),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(onPressed: overlay == null ? _pair : null, child: const Text('Approve')),
                  ],
                ),
                const SizedBox(height: 20),
                const SectionTitle('CLI'),
                Text(
                  cli == null
                      ? 'Version unknown'
                      : 'Sandbox ${cli!['current'] ?? '?'} · latest ${cli!['latest'] ?? '?'}${cli!['updateAvailable'] == true ? ' · update available' : ''}',
                  style: const TextStyle(color: Vc.muted),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: overlay == null ? _updateCli : null,
                  child: const Text('Update CLI & restart'),
                ),
                const SizedBox(height: 20),
                const SectionTitle('Logs'),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final s in ['all', 'daemon', 'agent', 'system'])
                      ChoiceChip(
                        label: Text(s),
                        selected: logsSource == s,
                        onSelected: (_) => _logs(s),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  constraints: const BoxConstraints(minHeight: 120, maxHeight: 240),
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF09090B),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Vc.cardBorder),
                  ),
                  child: SingleChildScrollView(
                    child: Text(
                      logs.isEmpty ? 'Tap a source to pull logs.' : logs,
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Vc.muted),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                const SectionTitle('Shell'),
                TextField(controller: cwd, decoration: const InputDecoration(labelText: 'cwd')),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: cmd,
                        decoration: const InputDecoration(labelText: 'Command'),
                        onSubmitted: (_) => _exec(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(onPressed: overlay == null ? _exec : null, child: const Text('Run')),
                  ],
                ),
                if (lastExec != null) ...[
                  const SizedBox(height: 8),
                  Text('exit ${lastExec!.exitCode ?? '?'}', style: TextStyle(color: lastExec!.ok ? Vc.green : Vc.red)),
                  if (lastExec!.stdout.isNotEmpty)
                    Text(lastExec!.stdout, style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
                  if (lastExec!.stderr.isNotEmpty)
                    Text(lastExec!.stderr, style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Vc.red)),
                ],
                const SizedBox(height: 20),
                OutlinedButton(
                  onPressed: () => context.push('/billing', extra: id),
                  child: const Text('Billing / renew'),
                ),
              ],
            ),
          if (overlay != null) BusyOverlay(message: overlay!, detail: 'Please wait — sandbox ops can take a minute'),
        ],
      ),
    );
  }
}
