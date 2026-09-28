import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../chat/bot_profile.dart';

class AgentDirectory extends ChangeNotifier {
  AgentDirectory(this._client);
  final VectraClient Function() _client;
  final _bots = <String, List<BotProfile>>{};
  final _activity = <String, Map<String, Map<String, dynamic>>>{};
  final _previews = <String, Map<String, String>>{};
  final _loading = <String, Future<void>>{};
  final _refreshed = <String, DateTime>{};
  int _epoch = 0;
  bool _disposed = false;

  List<BotProfile> bots(String instanceId) => _bots[instanceId] ?? const [];
  Map<String, dynamic>? activity(String instanceId, String botId) =>
      _activity[instanceId]?[botId];
  String? preview(String instanceId, String botId) =>
      _previews[instanceId]?[botId];
  bool initialized(String instanceId) => _bots.containsKey(instanceId);

  Future<void> refresh(String instanceId, {bool force = false}) {
    if (_disposed) return Future.value();
    if (_loading[instanceId] case final pending?) return pending;
    final last = _refreshed[instanceId];
    if (!force &&
        last != null &&
        DateTime.now().difference(last) < const Duration(seconds: 8)) {
      return Future.value();
    }
    final future = _fetch(instanceId);
    _loading[instanceId] = future;
    future.whenComplete(() {
      if (_loading[instanceId] == future) _loading.remove(instanceId);
    });
    return future;
  }

  Future<void> _fetch(String instanceId) async {
    final epoch = _epoch;
    try {
      final result = await _client().listBots(instanceId);
      if (_disposed || epoch != _epoch) return;
      _bots[instanceId] = (result['bots'] as List? ?? const [])
          .whereType<Map>()
          .map((value) => BotProfile.fromJson(Map<String, dynamic>.from(value)))
          .toList();
      _refreshed[instanceId] = DateTime.now();
      notifyListeners();
    } catch (_) {}
  }

  void update(String instanceId, List<BotProfile> bots) {
    if (_disposed) return;
    _bots[instanceId] = List.of(bots);
    _refreshed[instanceId] = DateTime.now();
    notifyListeners();
  }

  void updateActivity(
    String instanceId,
    List<Map<String, dynamic>> activity, {
    Map<String, String>? previews,
  }) {
    if (_disposed) return;
    final byBot = <String, Map<String, dynamic>>{};
    for (final item in activity) {
      final id = '${item['botId'] ?? ''}';
      if (id.isEmpty) continue;
      if (byBot[id]?['state'] != 'working') byBot[id] = item;
    }
    _activity[instanceId] = byBot;
    if (previews != null) _previews[instanceId] = Map.of(previews);
    notifyListeners();
  }

  void reset() {
    _epoch++;
    _bots.clear();
    _activity.clear();
    _previews.clear();
    _loading.clear();
    _refreshed.clear();
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    super.dispose();
  }
}
