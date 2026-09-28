import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/client.dart';
import '../api/models.dart';

class WorkspaceCatalog extends ChangeNotifier {
  WorkspaceCatalog(this._client);

  final VectraClient Function() _client;
  final Set<String> _deleted = {};
  final Set<String> _deleting = {};
  final Map<String, CloudInstance> _pendingCreate = {};
  int _generation = 0;
  int _accountEpoch = 0;
  bool _disposed = false;
  DateTime? _lastRefresh;

  List<CloudInstance> items = [];
  FreeQuota quota = FreeQuota();
  PlanInfo? plan;
  bool loading = false;
  bool initialized = false;
  String? error;

  Future<void> refresh({bool force = true}) {
    if (_disposed) return Future<void>.value();
    if (!force && _lastRefresh != null &&
        DateTime.now().difference(_lastRefresh!) < const Duration(seconds: 12)) {
      return Future<void>.value();
    }
    return _fetch();
  }

  Future<void> _fetch() async {
    final generation = ++_generation;
    if (!initialized) loading = true;
    error = null;
    notifyListeners();
    try {
      final data = await _client().dashboard();
      if (_disposed || generation != _generation) return;
      final listed = data.instances.map((instance) => instance.id).toSet();
      _deleted.removeWhere((id) => !listed.contains(id) && !_deleting.contains(id));
      _pendingCreate.removeWhere((id, _) => listed.contains(id));
      items = [
        ..._pendingCreate.values,
        ...data.instances.where((instance) => !_deleted.contains(instance.id)),
      ];
      quota = data.quota;
      plan = data.plan;
      _lastRefresh = DateTime.now();
      initialized = true;
    } catch (failure) {
      if (_disposed || generation != _generation) return;
      error = failure.toString();
    } finally {
      if (!_disposed && generation == _generation) {
        loading = false;
        notifyListeners();
      }
    }
  }

  void upsert(CloudInstance instance) {
    if (_disposed) return;
    _generation++;
    _deleted.remove(instance.id);
    _pendingCreate[instance.id] = instance;
    items = [instance, ...items.where((item) => item.id != instance.id)];
    initialized = true;
    notifyListeners();
  }

  Future<void> destroy(String id) async {
    if (_disposed) return;
    final previous = List<CloudInstance>.of(items);
    final pending = _pendingCreate[id];
    final accountEpoch = _accountEpoch;
    _generation++;
    _deleted.add(id);
    _deleting.add(id);
    _pendingCreate.remove(id);
    items = items.where((instance) => instance.id != id).toList();
    notifyListeners();
    try {
      await _client().destroy(id);
      if (!_disposed && accountEpoch == _accountEpoch) {
        _deleting.remove(id);
        unawaited(refresh());
      }
    } catch (_) {
      if (!_disposed && accountEpoch == _accountEpoch) {
        _generation++;
        _deleted.remove(id);
        _deleting.remove(id);
        if (pending != null) _pendingCreate[id] = pending;
        items = previous;
        notifyListeners();
      }
      rethrow;
    }
  }

  void reset() {
    if (_disposed) return;
    _generation++;
    _accountEpoch++;
    _lastRefresh = null;
    _deleted.clear();
    _deleting.clear();
    _pendingCreate.clear();
    items = [];
    quota = FreeQuota();
    plan = null;
    loading = false;
    initialized = false;
    error = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
