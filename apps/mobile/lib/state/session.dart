import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import '../api/models.dart';

class SessionController extends ChangeNotifier {
  SessionController({required this.apiBase});

  final String apiBase;
  final _store = const FlutterSecureStorage();

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
      }
    }
    ready = true;
    notifyListeners();
  }

  void setError(String? value) {
    error = value;
    notifyListeners();
  }

  Future<void> signIn(String email, String password, {bool register = false}) async {
    error = null;
    notifyListeners();
    try {
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
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
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
      client = VectraClient(baseUrl: base);
      final result = await client.login('server@supercharge', password);
      if (result.token.isEmpty) {
        throw ApiException(500, 'Daemon did not return a token');
      }
      client.token = result.token;
      user = result.user;
      await _store.write(key: 'token', value: result.token);
      await _store.write(key: 'apiBase', value: base);
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> signOut() async {
    user = null;
    client.token = null;
    await _store.delete(key: 'token');
    await _store.delete(key: 'apiBase');
    client = VectraClient(baseUrl: apiBase);
    notifyListeners();
  }
}
