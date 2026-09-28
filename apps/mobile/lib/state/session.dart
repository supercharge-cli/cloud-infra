import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../chat/bot_avatar.dart';
import 'workspaces.dart';

class SessionController extends ChangeNotifier {
  SessionController({required this.apiBase}) {
    workspaces = WorkspaceCatalog(() => client);
  }

  final String apiBase;
  final _store = const FlutterSecureStorage();
  late final WorkspaceCatalog workspaces;

  VectraClient client = VectraClient(baseUrl: '');
  AuthUser? user;
  bool ready = false;
  String? error;

  Future<void> load() async {
    final savedBase = await _store.read(key: 'apiBase');
    client = VectraClient(baseUrl: (savedBase != null && savedBase.isNotEmpty) ? savedBase : apiBase);
    final token = await _store.read(key: 'token');
    if (token != null && token.isNotEmpty) {
      client.token = token;
      try {
        user = await client.me();
      } catch (_) {
        await _store.delete(key: 'token');
        client.token = null;
        user = null;
        workspaces.reset();
        BotAvatar.clearCache();
      }
    }
    ready = true;
    notifyListeners();
    if (user != null) unawaited(workspaces.refresh());
  }

  void setError(String? value) {
    error = value;
    notifyListeners();
  }

  Future<void> signIn(String email, String password, {bool register = false}) async {
    error = null;
    notifyListeners();
    try {
      workspaces.reset();
      BotAvatar.clearCache();
      client = VectraClient(baseUrl: apiBase);
      final result = register
          ? await client.register(email, password)
          : await client.login(email, password);
      if (result.token.isEmpty) {
        throw ApiException(500, 'Server did not return a token');
      }
      client.token = result.token;
      user = result.user;
      await _store.write(key: 'token', value: result.token);
      await _store.delete(key: 'apiBase');
      unawaited(workspaces.refresh());
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
    if (user != null) unawaited(workspaces.refresh());
  }

  /// Paseo-style: phone talks to a Supercharge daemon (host + password).
  Future<void> connectDaemon(String host, String password) async {
    error = null;
    notifyListeners();
    try {
      var base = host.trim();
      if (base.endsWith('/')) base = base.substring(0, base.length - 1);
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        base = 'http://$base';
      }
      workspaces.reset();
      BotAvatar.clearCache();
      client = VectraClient(baseUrl: base);
      final result = await client.login('server@supercharge', password);
      if (result.token.isEmpty) {
        throw ApiException(500, 'Daemon did not return a token');
      }
      client.token = result.token;
      user = result.user;
      await _store.write(key: 'token', value: result.token);
      await _store.write(key: 'apiBase', value: base);
      unawaited(workspaces.refresh());
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  @override
  void dispose() {
    workspaces.dispose();
    super.dispose();
  }

  Future<void> signOut() async {
    user = null;
    workspaces.reset();
    BotAvatar.clearCache();
    client.token = null;
    await _store.delete(key: 'token');
    await _store.delete(key: 'apiBase');
    client = VectraClient(baseUrl: apiBase);
    notifyListeners();
  }
}
