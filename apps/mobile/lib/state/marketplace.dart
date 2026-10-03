import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../api/marketplace.dart';
import '../api/models.dart';

class MarketplaceController extends ChangeNotifier {
  MarketplaceController(this.api);
  final VectraClient api;
  bool _disposed = false;
  int _targetEpoch = 0;
  int _statusEpoch = 0;
  int _workspaceEpoch = 0;
  int _catalogEpoch = 0;
  int _discoveryEpoch = 0;
  int _conversationEpoch = 0;
  Timer? _poll;

  List<CloudInstance> workspaces = [];
  List<Map<String, dynamic>> catalog = [];
  List<DiscoveryPlugin> discovery = [];
  Map<String, dynamic> discoverySource = {};
  List<Map<String, dynamic>> bots = [];
  List<Map<String, dynamic>> inventory = [];
  List<String> allowedMcpOrigins = [];
  List<Map<String, dynamic>> conversations = [];
  Map<String, dynamic> bindings = {};
  String? instanceId;
  String? botId;
  bool loadingWorkspaces = true;
  bool loadingCatalog = true;
  bool loadingDiscovery = true;
  bool loadingBots = false;
  bool loadingInventory = false;
  bool loadingConversations = false;
  bool inventoryKnown = false;
  bool busy = false;
  String? workspaceError;
  String? catalogError;
  String? discoveryError;
  String? targetError;
  String? conversationError;
  String? actionError;
  String? notice;

  int get targetEpoch => _targetEpoch;
  CloudInstance? get workspace =>
      workspaces.where((item) => item.id == instanceId).firstOrNull;
  bool get supported => workspace?.runtime == AgentRuntime.supercharge;
  bool get canAct =>
      supported &&
      botId != null &&
      inventoryKnown &&
      !loadingInventory &&
      !busy;

  List<MarketplacePlugin> get plugins {
    final entries = <String, MarketplacePlugin>{};
    for (final row in catalog) {
      final id = row['id'];
      if (id is! String || id.isEmpty) continue;
      entries[id] = MarketplacePlugin(
        row,
        installed: inventory.where((item) => item['id'] == id).firstOrNull,
      );
    }
    for (final row in inventory) {
      final id = row['id'];
      if (id is String && id.isNotEmpty && !entries.containsKey(id)) {
        entries[id] = MarketplacePlugin({}, installed: row);
      }
    }
    return entries.values.toList();
  }

  MarketplacePlugin? plugin(String id) =>
      plugins.where((item) => item.id == id).firstOrNull;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int epoch) => !_disposed && epoch == _targetEpoch;

  Future<void> load({String? initialInstanceId, String? initialBotId}) async {
    await Future.wait([
      loadCatalog(),
      loadWorkspaces(
        preferredId: initialInstanceId,
        preferredBot: initialBotId,
      ),
    ]);
  }

  Future<void> loadCatalog() async {
    final epoch = ++_catalogEpoch;
    loadingCatalog = true;
    catalogError = null;
    _emit();
    try {
      final response = await api.managedMcpCatalog();
      if (_disposed || epoch != _catalogEpoch) return;
      if (response['plugins'] is! List) {
        throw const FormatException('Invalid catalog');
      }
      catalog = marketplaceRows(response['plugins']);
    } catch (_) {
      if (_disposed || epoch != _catalogEpoch) return;
      catalogError = 'Catalog unavailable. Retry to load reviewed releases.';
      catalog = [];
    } finally {
      if (!_disposed && epoch == _catalogEpoch) {
        loadingCatalog = false;
        _emit();
      }
    }
  }

  Future<void> loadDiscovery() async {
    final epoch = ++_discoveryEpoch;
    loadingDiscovery = true;
    discoveryError = null;
    _emit();
    try {
      final response = await api.managedMcpDiscovery();
      if (_disposed || epoch != _discoveryEpoch) return;
      final data = marketplaceMap(response['discovery']);
      final source = marketplaceMap(data['source']);
      if (data['plugins'] is! List ||
          source['repository'] != 'openai/plugins' ||
          source['commit'] is! String ||
          !RegExp(r'^[a-fA-F0-9]{40}$').hasMatch(source['commit'] as String)) {
        throw const FormatException('Invalid discovery');
      }
      discovery = marketplaceRows(
        data['plugins'],
      ).map(DiscoveryPlugin.parse).whereType<DiscoveryPlugin>().toList();
      discoverySource = source;
    } catch (_) {
      if (_disposed || epoch != _discoveryEpoch) return;
      discovery = [];
      discoverySource = {};
      discoveryError = 'Browse-only discovery unavailable. Retry discovery.';
    } finally {
      if (!_disposed && epoch == _discoveryEpoch) {
        loadingDiscovery = false;
        _emit();
      }
    }
  }

  Future<void> loadWorkspaces({
    String? preferredId,
    String? preferredBot,
  }) async {
    final epoch = ++_workspaceEpoch;
    loadingWorkspaces = true;
    workspaceError = null;
    _clearTarget();
    instanceId = null;
    _emit();
    try {
      final data = await api.dashboard();
      if (_disposed || epoch != _workspaceEpoch) return;
      workspaces = data.instances;
      loadingWorkspaces = false;
      final preferred = workspaces
          .where((item) => item.id == preferredId)
          .firstOrNull;
      final selected = preferredId != null
          ? preferred
          : workspaces
                    .where((item) => item.runtime == AgentRuntime.supercharge)
                    .firstOrNull ??
                workspaces.firstOrNull;
      await selectWorkspace(selected?.id, preferredBot: preferredBot);
    } catch (_) {
      if (_disposed || epoch != _workspaceEpoch) return;
      workspaces = [];
      workspaceError =
          'Could not load your workspaces. Check your connection and retry.';
    } finally {
      if (!_disposed && epoch == _workspaceEpoch) {
        loadingWorkspaces = false;
        _emit();
      }
    }
  }

  void _clearTarget() {
    _targetEpoch++;
    _statusEpoch++;
    _conversationEpoch++;
    _poll?.cancel();
    _poll = null;
    botId = null;
    bots = [];
    _clearInventory();
    loadingBots = false;
    busy = false;
  }

  void _clearInventory() {
    inventory = [];
    allowedMcpOrigins = [];
    bindings = {};
    conversations = [];
    inventoryKnown = false;
    loadingInventory = false;
    loadingConversations = false;
    targetError = null;
    conversationError = null;
    actionError = null;
    notice = null;
  }

  Future<void> selectWorkspace(String? id, {String? preferredBot}) async {
    _clearTarget();
    instanceId = workspaces.any((item) => item.id == id) ? id : null;
    final epoch = _targetEpoch;
    if (!supported) {
      _emit();
      return;
    }
    loadingBots = true;
    _emit();
    try {
      final response = await api.listBots(instanceId!);
      if (!_current(epoch)) return;
      if (response['bots'] is! List) {
        throw const FormatException('Invalid bot list');
      }
      bots = marketplaceRows(response['bots'])
          .where(
            (row) => row['id'] is String && (row['id'] as String).isNotEmpty,
          )
          .toList();
      loadingBots = false;
      final selected =
          bots.where((row) => row['id'] == preferredBot).firstOrNull ??
          bots.firstOrNull;
      await selectBot(selected?['id'] as String?);
    } catch (_) {
      if (!_current(epoch)) return;
      targetError = 'Could not load bots for this VM. Retry target discovery.';
      loadingBots = false;
      _emit();
    }
  }

  Future<void> selectBot(String? id) async {
    _targetEpoch++;
    _statusEpoch++;
    _conversationEpoch++;
    _poll?.cancel();
    _poll = null;
    _clearInventory();
    busy = false;
    botId = bots.any((row) => row['id'] == id) ? id : null;
    _emit();
    if (botId != null) {
      await Future.wait([refreshInventory(), loadConversations()]);
    }
  }

  Future<void> refreshInventory({bool background = false}) async {
    if (!supported || botId == null) return;
    final epoch = _targetEpoch;
    final request = ++_statusEpoch;
    if (!background) loadingInventory = true;
    targetError = null;
    _emit();
    try {
      final response = await api.botManagedMcp(instanceId!, botId!, {
        'action': 'status',
      });
      if (!_current(epoch) || request != _statusEpoch) return;
      final rows = marketplaceMap(response['inventory'])['plugins'];
      if (rows is! List) throw const FormatException('Inventory missing');
      inventory = marketplaceRows(rows);
      allowedMcpOrigins = marketplaceStrings(
        marketplaceMap(response['service'])['allowedMcpOrigins'],
      );
      bindings = marketplaceMap(response['bindings']);
      inventoryKnown = true;
      _poll?.cancel();
      _poll = null;
      if (bindings.values.any(
        (row) => row is Map && ['waiting', 'removing'].contains(row['status']),
      )) {
        _poll = Timer(const Duration(seconds: 3), () {
          if (_current(epoch) && !busy) {
            unawaited(refreshInventory(background: true));
          }
        });
      }
    } catch (_) {
      if (!_current(epoch) || request != _statusEpoch) return;
      inventory = [];
      bindings = {};
      inventoryKnown = false;
      _poll?.cancel();
      _poll = null;
      targetError =
          'VM inventory unavailable. Refresh status before taking action. Older runtimes may need a controller update.';
    } finally {
      if (_current(epoch) && request == _statusEpoch) {
        loadingInventory = false;
        _emit();
      }
    }
  }

  Future<void> loadConversations() async {
    if (botId == null) return;
    final epoch = _targetEpoch;
    final request = ++_conversationEpoch;
    final selectedBot = botId!;
    loadingConversations = true;
    conversationError = null;
    conversations = [];
    _emit();
    try {
      final response = await api.listConversations(
        instanceId!,
        botId: selectedBot,
      );
      if (!_current(epoch) || request != _conversationEpoch) return;
      if (response['conversations'] is! List) {
        throw const FormatException('Invalid conversations');
      }
      conversations = marketplaceRows(response['conversations'])
          .where(
            (row) =>
                row['botId'] == selectedBot &&
                row['source'] != 'group' &&
                row['sessionId'] is String &&
                (row['sessionId'] as String).isNotEmpty,
          )
          .toList();
    } catch (_) {
      if (!_current(epoch) || request != _conversationEpoch) return;
      conversationError =
          'Could not load this bot’s conversations. Retry conversations.';
    } finally {
      if (_current(epoch) && request == _conversationEpoch) {
        loadingConversations = false;
        _emit();
      }
    }
  }

  Future<bool> _act(
    Map<String, dynamic> action,
    String success, {
    bool secret = false,
  }) async {
    if (!canAct) return false;
    final epoch = _targetEpoch;
    final instance = instanceId!;
    final bot = botId!;
    _poll?.cancel();
    _statusEpoch++;
    busy = true;
    actionError = null;
    notice = null;
    _emit();
    try {
      await api.botManagedMcp(instance, bot, action);
      if (!_current(epoch)) return false;
      notice = success;
      await refreshInventory();
      return _current(epoch) && inventoryKnown;
    } catch (failure) {
      if (!_current(epoch)) return false;
      inventoryKnown = false;
      actionError = secret
          ? 'Configuration could not be confirmed. Values were cleared. Refresh VM status before retrying.'
          : 'Action could not be confirmed${failure is ApiException ? ': ${failure.message}' : '.'} Refresh VM status before retrying; the outcome may be unknown.';
      return false;
    } finally {
      if (_current(epoch)) {
        busy = false;
        _emit();
      }
    }
  }

  Future<bool> install(String id) async {
    final selected = plugin(id);
    if (selected == null ||
        selected.installed != null ||
        !selected.supportsVm ||
        (id == 'vectra-github' &&
            !allowedMcpOrigins.contains('https://api.githubcopilot.com')) ||
        selected.auth == 'oauth' ||
        selected.digest == null) {
      return false;
    }
    return _act(
      {
        'action': 'installCatalog',
        'catalogId': id,
        'catalogSha256': selected.digest,
        'requestId': _requestId(),
      },
      'Installed in this bot VM. Configure and review the VM permissions before enabling.',
    );
  }

  String _requestId() => DateTime.now().microsecondsSinceEpoch.toString();

  Future<bool> _change(
    MarketplacePlugin selected,
    String action,
    Map<String, dynamic> input,
    String success,
  ) => _act(
    {
      'action': 'pluginAction',
      'pluginId': selected.id,
      'pluginAction': {
        'action': action,
        'expectedRevision': selected.installed!['revision'],
        ...input,
      },
      'requestId': _requestId(),
    },
    success,
    secret: action == 'configure',
  );

  String? reviewFingerprint(String id) {
    final selected = plugin(id);
    if (selected == null ||
        !inventoryKnown ||
        !selected.reviewable ||
        !selected.reviewedInstallation) {
      return null;
    }
    return jsonEncode([
      _targetEpoch,
      id,
      selected.installed!['revision'],
      selected.permissions,
    ]);
  }

  Future<bool> approve(String id, String consentFingerprint) async {
    final selected = plugin(id);
    if (selected == null ||
        !selected.reviewable ||
        !selected.reviewedInstallation ||
        selected.trusted ||
        reviewFingerprint(id) != consentFingerprint) {
      return false;
    }
    return _change(selected, 'trust', {
      'permissions': selected.permissions,
    }, 'Permissions approved for this VM release.');
  }

  Future<bool> configure(String id, Map<String, String> values) async {
    final selected = plugin(id);
    if (selected == null ||
        !selected.reviewable ||
        !selected.reviewedInstallation ||
        values.isEmpty ||
        values.keys.any((key) => !selected.config.containsKey(key))) {
      return false;
    }
    return _change(selected, 'configure', {
      'values': values,
    }, 'Configuration saved in the VM. Secret values are not read back.');
  }

  Future<bool> setEnabled(String id, bool enabled) async {
    final selected = plugin(id);
    if (selected == null ||
        !selected.reviewable ||
        (enabled && !selected.reviewedInstallation) ||
        (enabled &&
            (!selected.trusted ||
                !selected.authenticationSupported ||
                selected.missingConfiguration.isNotEmpty))) {
      return false;
    }
    return _change(
      selected,
      enabled ? 'enable' : 'disable',
      {},
      enabled
          ? 'Enabled in this bot VM. Attach to a conversation next.'
          : 'Disabled in this bot VM.',
    );
  }

  Future<bool> attach(String id, String server, String session) async {
    final selected = plugin(id);
    if (selected == null ||
        !selected.enabled ||
        !selected.trusted ||
        !selected.reviewedInstallation ||
        !selected.authenticationSupported ||
        (id == 'vectra-github' &&
            !allowedMcpOrigins.contains('https://api.githubcopilot.com')) ||
        !selected.servers.contains(server) ||
        !conversations.any((row) => row['sessionId'] == session)) {
      return false;
    }
    final binding = marketplaceMap(bindings[session]);
    return _act(
      {
        'action': 'apply',
        'pluginId': id,
        'serverId': server,
        'sessionId': session,
        'expectedRevision': binding['revision'] is int
            ? binding['revision']
            : null,
      },
      'Attachment requested. Wait for discovery; attached does not mean verified.',
    );
  }

  Future<bool> bindingAction(
    String id,
    String session,
    String action, {
    String? tool,
    bool consent = false,
  }) async {
    final binding = marketplaceMap(bindings[session]);
    if (!conversations.any((row) => row['sessionId'] == session) ||
        binding['pluginId'] != id ||
        binding['revision'] is! int) {
      return false;
    }
    if (action == 'retry' &&
        (binding['status'] != 'failed' ||
            plugin(id)?.reviewedInstallation != true)) {
      return false;
    }
    if (action == 'verify') {
      final discovered = marketplaceRows(binding['tools']);
      if (!consent ||
          id != 'vectra-echo' ||
          plugin(id)?.reviewedInstallation != true ||
          binding['serverId'] != 'echo' ||
          binding['status'] != 'applied' ||
          !discovered.any(
            (row) =>
                row['name'] == tool &&
                '${row['description']}'.startsWith('vectra-echo/echo/echo:'),
          )) {
        return false;
      }
    } else if (action != 'retry' && action != 'remove') {
      return false;
    }
    return _act(
      {
        'action': action,
        'sessionId': session,
        'expectedRevision': binding['revision'],
        if (action == 'verify') ...{
          'tool': tool,
          'arguments': {'text': 'managed MCP check'},
          'consent': true,
        },
      },
      action == 'verify'
          ? 'Verification requested. Readiness is reported by the VM below.'
          : 'Conversation bridge change requested.',
    );
  }

  @override
  void dispose() {
    _disposed = true;
    _targetEpoch++;
    _poll?.cancel();
    super.dispose();
  }
}
