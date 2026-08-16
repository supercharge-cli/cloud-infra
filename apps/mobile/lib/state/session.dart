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
    client = VectraClient(baseUrl: apiBase);
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

  Future<void> signIn(String email, String password, {bool register = false}) async {
    error = null;
    notifyListeners();
    try {
      final result = register
          ? await client.register(email, password)
          : await client.login(email, password);
      if (result.token.isEmpty) {
        throw ApiException(500, 'Server did not return a token');
      }
      client.token = result.token;
      user = result.user;
      await _store.write(key: 'token', value: result.token);
    } catch (e) {
      error = e.toString();
    }
    notifyListeners();
  }

  Future<void> signOut() async {
    user = null;
    client.token = null;
    await _store.delete(key: 'token');
    notifyListeners();
  }
}
