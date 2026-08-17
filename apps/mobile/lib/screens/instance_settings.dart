import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/providers.dart';
import '../chat/cli_update.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

const _providers = [
  'pollinations',
  'openai',
  'anthropic',
  'routingrun',
  'openrouter',
  'grok',
  'google',
  'nous',
  'deepseek',
  'custom',
];

class InstanceSettingsScreen extends StatefulWidget {
  const InstanceSettingsScreen({super.key, required this.instanceId, this.instance});
  final String instanceId;
  final CloudInstance? instance;

  @override
  State<InstanceSettingsScreen> createState() => _InstanceSettingsScreenState();
}

class _InstanceSettingsScreenState extends State<InstanceSettingsScreen> {
  final provider = TextEditingController(text: 'pollinations');
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

  List<String> modelChoices = const [];
  List<Map<String, String>> savedProviders = [];
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
  bool byopReady = false;
  bool pastePollinationsKey = false;
  final history = <ExecResult>[];

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

  String _str(Map<String, dynamic> a, Map<String, dynamic> b, String key) {
    final first = a[key];
    if (first != null && '$first'.trim().isNotEmpty) return '$first'.trim();
    final second = b[key];
    if (second != null && '$second'.trim().isNotEmpty) return '$second'.trim();
    return '';
  }

  String _hint(Map<String, dynamic> sandbox, String key, String flag) {
    final hint = '${sandbox[key] ?? ''}'.trim();
    if (hint.isNotEmpty) return hint;
    if (sandbox[flag] == true) return 'Set on sandbox';
    return 'Not set';
  }

  String _slotId(String p, String url) {
    final id = p.trim().toLowerCase();
    if (id.isEmpty) return 'custom';
    if (id == 'custom' && url.trim().isNotEmpty) {
      try {
        return 'custom:${Uri.parse(url).host}';
      } catch (_) {
        return 'custom';
      }
    }
    return id;
  }

  Map<String, String> _snapshotCurrent() {
    return {
      'id': _slotId(provider.text, baseUrl.text),
      'provider': provider.text.trim().isEmpty ? 'custom' : provider.text.trim(),
      'model': model.text.trim(),
      'baseUrl': (baseUrl.text.trim().isEmpty
          ? stockBaseUrl(provider.text)
          : baseUrl.text.trim()),
      'apiKey': apiKey.text.trim(),
    };
  }

  List<Map<String, String>> _upsertLocal(List<Map<String, String>> list, Map<String, String> slot) {
    final id = slot['id'] ?? '';
    final idx = list.indexWhere((s) => s['id'] == id);
    if (idx < 0) return [...list, slot];
    final prev = list[idx];
    final next = {
      ...prev,
      ...slot,
      'apiKey': (slot['apiKey'] ?? '').isNotEmpty ? slot['apiKey']! : (prev['apiKey'] ?? ''),
    };
    return [for (var i = 0; i < list.length; i++) i == idx ? next : list[i]];
  }

  void _addAnotherProvider() {
    setState(() {
      savedProviders = _upsertLocal(savedProviders, _snapshotCurrent());
      provider.clear();
      model.clear();
      baseUrl.clear();
      apiKey.clear();
    });
  }

  void _applyProviderDefaults(String raw, {bool fillModel = true}) {
    final def = lookupProviderDefault(raw);
    if (def == null) return;
    if (def.baseUrl.isNotEmpty) baseUrl.text = def.baseUrl;
    if (fillModel && model.text.trim().isEmpty && def.defaultModel.isNotEmpty) {
      model.text = def.defaultModel;
    }
  }

  void _onProviderPicked(String v) {
    setState(() {
      provider.text = v;
      if (v.trim().toLowerCase() == 'custom') {
        final known = providerDefaults.values.any((d) => urlsMatch(baseUrl.text, d.baseUrl));
        if (known) baseUrl.clear();
        return;
      }
      _applyProviderDefaults(v);
    });
  }

  bool get _showBaseUrl => providerNeedsBaseUrl(provider.text, baseUrl.text);

  void _useSavedProvider(Map<String, String> slot) {
    setState(() {
      provider.text = slot['provider'] ?? '';
      model.text = slot['model'] ?? '';
      baseUrl.text = slot['baseUrl'] ?? '';
      if ((slot['apiKey'] ?? '').isNotEmpty) apiKey.text = slot['apiKey']!;
      if (baseUrl.text.trim().isEmpty) _applyProviderDefaults(provider.text, fillModel: false);
    });
  }

  void _removeSavedProvider(String id) {
    final next = savedProviders.where((s) => s['id'] != id).toList();
    final fill = _slotId(provider.text, baseUrl.text) == id && next.isNotEmpty ? next.first : null;
    setState(() {
      savedProviders = next;
      if (fill != null) {
        provider.text = fill['provider'] ?? '';
        model.text = fill['model'] ?? '';
        baseUrl.text = fill['baseUrl'] ?? '';
        if ((fill['apiKey'] ?? '').isNotEmpty) apiKey.text = fill['apiKey']!;
      }
    });
  }

  String get _secretCacheKey => 'instance-secrets:$id';

  Future<void> _cacheSecrets() async {
    const store = FlutterSecureStorage();
    await store.write(
      key: _secretCacheKey,
      value: jsonEncode({
        'apiKey': apiKey.text.trim(),
        'telegramBotToken': telegram.text.trim(),
        'discordBotToken': discord.text.trim(),
        'slackBotToken': slackBot.text.trim(),
        'slackAppToken': slackApp.text.trim(),
      }),
    );
  }

  Future<void> _fillFromCacheIfMissing() async {
    if (apiKey.text.trim().isNotEmpty &&
        telegram.text.trim().isNotEmpty &&
        discord.text.trim().isNotEmpty &&
        slackBot.text.trim().isNotEmpty &&
        slackApp.text.trim().isNotEmpty) {
      return;
    }
    const store = FlutterSecureStorage();
    final raw = await store.read(key: _secretCacheKey);
    if (raw == null || raw.isEmpty) return;
    try {
      final data = jsonDecode(raw);
      if (data is! Map) return;
      if (apiKey.text.trim().isEmpty) apiKey.text = '${data['apiKey'] ?? ''}';
      if (telegram.text.trim().isEmpty) telegram.text = '${data['telegramBotToken'] ?? ''}';
      if (discord.text.trim().isEmpty) discord.text = '${data['discordBotToken'] ?? ''}';
      if (slackBot.text.trim().isEmpty) slackBot.text = '${data['slackBotToken'] ?? ''}';
      if (slackApp.text.trim().isEmpty) slackApp.text = '${data['slackAppToken'] ?? ''}';
    } catch (_) {}
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      msg = null;
    });
    try {
      try {
        inst = await api.getInstance(id);
      } catch (_) {}
      final cfg = await api.getConfig(id);
      config = cfg;
      final stored = cfg['stored'] as Map<String, dynamic>? ?? {};
      final sandbox = cfg['sandbox'] as Map<String, dynamic>? ?? {};
      provider.text = _str(sandbox, stored, 'provider').isEmpty
          ? 'pollinations'
          : _str(sandbox, stored, 'provider');
      model.text = _str(sandbox, stored, 'model');
      baseUrl.text = _str(sandbox, stored, 'baseUrl');
      if (baseUrl.text.trim().isEmpty || model.text.trim().isEmpty) {
        _applyProviderDefaults(provider.text, fillModel: model.text.trim().isEmpty);
      }
      apiKey.text = _str(sandbox, stored, 'apiKey');
      final rawSaved = sandbox['savedProviders'] ?? stored['savedProviders'];
      savedProviders = [];
      if (rawSaved is List) {
        for (final item in rawSaved) {
          if (item is! Map) continue;
          savedProviders.add({
            'id': '${item['id'] ?? item['provider'] ?? ''}',
            'provider': '${item['provider'] ?? ''}',
            'model': '${item['model'] ?? ''}',
            'baseUrl': '${item['baseUrl'] ?? ''}',
            'apiKey': '${item['apiKey'] ?? ''}',
            'apiKeyHint': '${item['apiKeyHint'] ?? ''}',
          });
        }
      }
      telegram.text = _str(sandbox, stored, 'telegramBotToken');
      discord.text = _str(sandbox, stored, 'discordBotToken');
      slackBot.text = _str(sandbox, stored, 'slackBotToken');
      slackApp.text = _str(sandbox, stored, 'slackAppToken');
      allowAll = sandbox['allowAllUsers'] == true || stored['allowAllUsers'] == true;
      await _fillFromCacheIfMissing();
      await _cacheSecrets();
      modelChoices = await api.models(id).catchError((_) => <String>[]);
      pairing = await api.pairing(id).catchError((_) => <String, dynamic>{});
      cli = await api.cliVersion(id).catchError((_) => <String, dynamic>{});
      try {
        final st = await api.pollinationsStatus();
        byopReady = st['configured'] == true;
      } catch (_) {
        byopReady = false;
      }
      final info = CliVersion.fromJson(cli);
      if (info.updateAvailable) {
        await CliUpdateOffer.notifyOnce(instanceId: id, name: inst?.name ?? 'workspace', info: info);
      }
    } catch (e) {
      msg = e.toString();
      await _fillFromCacheIfMissing();
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

  Future<void> _connectPollinations() async {
    await _run('Opening Pollinations…', () async {
      final url = await api.pollinationsConnectUrl(id);
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) throw ApiException(0, 'Could not open the browser');
      msg = 'Finish in the browser. Vectra will open when Pollen is connected.';
    });
  }

  Future<void> _save() async {
    await _run('Saving config & restarting daemon…', () async {
      await api.saveConfig(id, {
        'provider': provider.text.trim(),
        'model': model.text.trim(),
        'baseUrl': (baseUrl.text.trim().isEmpty
                ? stockBaseUrl(provider.text)
                : baseUrl.text.trim()),
        'savedProviders': _upsertLocal(savedProviders, _snapshotCurrent()),
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
      final result = await api.exec(id, command: command, cwd: cwd.text.trim());
      history.insert(0, result);
      if (history.length > 12) history.removeLast();
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
        title: const Text('Destroy sandbox?'),
        content: const Text('This cannot be undone. Chat history on this phone stays, the cloud box is gone.'),
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

  Widget _secretStatus() {
    final sandbox = config?['sandbox'] as Map<String, dynamic>? ?? {};
    String bit(String label, String flag, String hintKey, String value) {
      if (value.trim().isNotEmpty) {
        final v = value.trim();
        final shown = v.length < 10 ? '••••' : '${v.substring(0, 4)}…${v.substring(v.length - 4)}';
        return '$label $shown';
      }
      if (sandbox[flag] == true) return '$label ${_hint(sandbox, hintKey, flag)}';
      return '$label —';
    }

    return Text(
      [
        bit('API', 'hasApiKey', 'apiKeyHint', apiKey.text),
        bit('TG', 'hasTelegramToken', 'telegramHint', telegram.text),
        bit('DC', 'hasDiscordToken', 'discordHint', discord.text),
        bit('SL', 'hasSlackToken', 'slackHint', slackBot.text),
      ].join('  ·  '),
      style: const TextStyle(color: Vc.muted, fontSize: 12, height: 1.4),
    );
  }

  @override
  Widget build(BuildContext context) {
    final root = pairing?['pairing'] is Map
        ? Map<String, dynamic>.from(pairing!['pairing'] as Map)
        : pairing;
    final pending = (root?['pending'] as List?) ?? const [];
    final approved = (root?['approved'] as List?) ?? const [];
    final updateReady = cli?['updateAvailable'] == true;
    final okMsg = msg != null &&
        (msg!.startsWith('Saved') ||
            msg!.contains('OK') ||
            msg!.contains('finished') ||
            msg!.contains('sent') ||
            msg!.contains('restarted') ||
            msg!.contains('updated'));
    return AppScaffold(
      currentInstanceId: id,
      appBar: AppBar(
        title: Text(inst?.name ?? 'Control'),
        actions: [
          IconButton(onPressed: overlay == null ? _load : null, icon: const Icon(Icons.refresh)),
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
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 36),
                children: [
                  if (msg != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(msg!, style: TextStyle(color: okMsg ? Vc.green : Vc.red)),
                    ),
                  VcPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            StatusDot(inst?.displayState ?? 'unknown'),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                inst?.name ?? id,
                                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18, letterSpacing: -0.3),
                              ),
                            ),
                            StateChip(inst?.displayState ?? 'unknown'),
                            if (inst?.isFree == true) ...[
                              const SizedBox(width: 6),
                              const StateChip('free'),
                            ],
                            if (inst?.pastDue == true) ...[
                              const SizedBox(width: 6),
                              const StateChip('past_due'),
                            ],
                          ],
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            ControlButton(icon: Icons.bolt, label: 'Wake', onTap: _wake, color: Vc.amber),
                            const SizedBox(width: 8),
                            ControlButton(icon: Icons.restart_alt, label: 'Restart', onTap: _restart, color: Vc.blue),
                            const SizedBox(width: 8),
                            ControlButton(icon: Icons.delete_outline, label: 'Destroy', onTap: _destroy, color: Vc.red),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (updateReady) ...[
                    const SizedBox(height: 12),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(16),
                      child: CliUpdateNote(
                        info: CliVersion.fromJson(cli),
                        busy: overlay != null,
                        onUpdate: _updateCli,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  const SectionTitle(
                    'AI',
                    subtitle: 'Pollinations is the default — cheapest huge model list. Connect once and chat.',
                  ),
                  VcPanel(
                    child: Column(
                      children: [
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                          decoration: BoxDecoration(
                            color: const Color(0xFF102216),
                            borderRadius: BorderRadius.circular(12),
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
                              SizedBox(height: 4),
                              Text(
                                'Pollinations — GPT / Claude / Gemini / Qwen and more on one cheap Pollen balance. Use this unless you already pay another API.',
                                style: TextStyle(color: Colors.white, height: 1.4, fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: provider,
                          decoration: InputDecoration(
                            labelText: 'Provider',
                            suffixIcon: PopupMenuButton<String>(
                              icon: const Icon(Icons.expand_more, color: Vc.muted),
                              onSelected: _onProviderPicked,
                              itemBuilder: (_) => [
                                for (final p in _providers)
                                  PopupMenuItem(
                                    value: p,
                                    child: Text(p == 'pollinations' ? 'pollinations  ·  recommended' : p),
                                  ),
                              ],
                            ),
                          ),
                          onChanged: (v) {
                            if (lookupProviderDefault(v) != null) {
                              _onProviderPicked(v);
                            } else {
                              setState(() {});
                            }
                          },
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: model,
                          decoration: InputDecoration(
                            labelText: 'Model',
                            hintText: 'pick or type a custom id',
                            suffixIcon: modelChoices.isEmpty
                                ? null
                                : PopupMenuButton<String>(
                                    icon: const Icon(Icons.expand_more, color: Vc.muted),
                                    onSelected: (v) => setState(() => model.text = v),
                                    itemBuilder: (_) => [
                                      for (final m in modelChoices.take(80))
                                        PopupMenuItem(value: m, child: Text(m, overflow: TextOverflow.ellipsis)),
                                    ],
                                  ),
                          ),
                        ),
                        if (_showBaseUrl) ...[
                          const SizedBox(height: 10),
                          TextField(
                            controller: baseUrl,
                            decoration: const InputDecoration(
                              labelText: 'Base URL',
                              hintText: 'https://…/v1',
                            ),
                            onChanged: (_) => setState(() {}),
                          ),
                        ],
                        if (provider.text.trim().toLowerCase() == 'pollinations') ...[
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: overlay != null || !byopReady ? null : _connectPollinations,
                            icon: const Icon(Icons.eco_outlined, size: 18),
                            label: Text(
                              byopReady ? 'Connect with Pollinations' : 'BYOP not configured on server',
                            ),
                          ),
                          const SizedBox(height: 6),
                          const Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              'Opens the site, you approve, then Vectra comes back connected. No key to paste.',
                              style: TextStyle(color: Vc.muted, fontSize: 12, height: 1.35),
                            ),
                          ),
                          Theme(
                            data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                            child: ExpansionTile(
                              tilePadding: EdgeInsets.zero,
                              childrenPadding: const EdgeInsets.only(bottom: 4),
                              initiallyExpanded: pastePollinationsKey || apiKey.text.trim().isNotEmpty,
                              onExpansionChanged: (open) => setState(() => pastePollinationsKey = open),
                              title: const Text(
                                'Or paste a secret key',
                                style: TextStyle(color: Vc.muted, fontSize: 13),
                              ),
                              children: [
                                SecretField(
                                  controller: apiKey,
                                  label: 'Pollinations secret key',
                                  hint: 'sk_… only if you already have one',
                                  helper: 'Skip this if you used Connect.',
                                ),
                              ],
                            ),
                          ),
                        ] else ...[
                          const SizedBox(height: 10),
                          SecretField(
                            controller: apiKey,
                            label: 'API key',
                            hint: 'sk-… or provider key',
                          ),
                        ],
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            'Saved providers keep their own key (like Hermes). Add another without wiping this one.',
                            style: const TextStyle(color: Vc.muted, fontSize: 12),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final s in savedProviders)
                              InputChip(
                                label: Text(
                                  [
                                    s['provider'] ?? s['id'] ?? '',
                                    if ((s['model'] ?? '').trim().isNotEmpty) s['model']!,
                                  ].join(' · '),
                                ),
                                selected: _slotId(provider.text, baseUrl.text) == s['id'],
                                onPressed: () => _useSavedProvider(s),
                                onDeleted: () => _removeSavedProvider(s['id'] ?? ''),
                              ),
                            ActionChip(
                              avatar: const Icon(Icons.add, size: 16, color: Vc.green),
                              label: const Text('Add another provider'),
                              onPressed: _addAnotherProvider,
                            ),
                          ],
                        ),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Allow all users (skip pairing)'),
                          value: allowAll,
                          activeThumbColor: Vc.green,
                          onChanged: (v) => setState(() => allowAll = v),
                        ),
                        const SizedBox(height: 4),
                        FilledButton(
                          onPressed: overlay == null ? _save : null,
                          child: const SizedBox(
                            width: double.infinity,
                            child: Text('Save & restart daemon', textAlign: TextAlign.center),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const SectionTitle(
                    'Chat channels',
                    subtitle: 'Optional Telegram / Discord / Slack bots. The phone app does not need these.',
                  ),
                  VcPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _secretStatus(),
                        const SizedBox(height: 12),
                        SecretField(controller: telegram, label: 'Telegram bot token', hint: '123456:ABC…'),
                        const SizedBox(height: 10),
                        SecretField(controller: discord, label: 'Discord bot token'),
                        const SizedBox(height: 10),
                        SecretField(controller: slackBot, label: 'Slack bot token', hint: 'xoxb-…'),
                        const SizedBox(height: 10),
                        SecretField(controller: slackApp, label: 'Slack app token', hint: 'xapp-…'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const SectionTitle('Pairing'),
                  VcPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
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
                        if (approved.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          const Text('Approved', style: TextStyle(color: Vc.muted, fontSize: 12)),
                          for (final p in approved)
                            ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              title: Text('${(p as Map)['platform'] ?? ''} · ${p['userId'] ?? ''}'),
                            ),
                        ],
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(controller: pairCode, decoration: const InputDecoration(labelText: 'Approve code')),
                            ),
                            const SizedBox(width: 8),
                            FilledButton(onPressed: overlay == null ? _pair : null, child: const Text('Approve')),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const SectionTitle('CLI'),
                  VcPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          cli == null
                              ? 'Version unknown'
                              : 'Sandbox ${cli!['current'] ?? '?'} · latest ${cli!['latest'] ?? '?'}${cli!['updateAvailable'] == true ? ' · update available' : ''}',
                          style: const TextStyle(color: Vc.muted),
                        ),
                        const SizedBox(height: 10),
                        OutlinedButton(
                          onPressed: overlay == null ? _updateCli : null,
                          child: const SizedBox(
                            width: double.infinity,
                            child: Text('Update CLI & restart', textAlign: TextAlign.center),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const SectionTitle('Logs'),
                  VcPanel(
                    child: Column(
                      children: [
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
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton.icon(
                            onPressed: logs.isEmpty
                                ? null
                                : () {
                                    Clipboard.setData(ClipboardData(text: logs));
                                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Logs copied')));
                                  },
                            icon: const Icon(Icons.copy, size: 16),
                            label: const Text('Copy'),
                          ),
                        ),
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
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const SectionTitle('Shell'),
                  VcPanel(
                    child: Column(
                      children: [
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
                        for (final lastExec in history.take(4)) ...[
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              '${lastExec.command ?? 'cmd'} · exit ${lastExec.exitCode ?? '?'}',
                              style: TextStyle(color: lastExec.ok ? Vc.green : Vc.red, fontSize: 12),
                            ),
                          ),
                          if (lastExec.stdout.isNotEmpty)
                            Text(lastExec.stdout, style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
                          if (lastExec.stderr.isNotEmpty)
                            Text(lastExec.stderr, style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Vc.red)),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
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
