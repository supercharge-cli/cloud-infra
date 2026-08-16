import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'models.dart';

class ApiException implements Exception {
  ApiException(this.status, this.message, {this.code});
  final int status;
  final String message;
  final String? code;
  @override
  String toString() => message;
}

class VectraClient {
  VectraClient({required this.baseUrl, this.token});

  final String baseUrl;
  String? token;

  Uri _u(String path, [Map<String, String>? q]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: q);

  Map<String, String> get _headers => {
        'accept': 'application/json',
        'content-type': 'application/json',
        if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
      };

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
  }) async {
    final uri = _u(path, query);
    late http.Response res;
    final encoded = body == null ? null : jsonEncode(body);
    switch (method) {
      case 'GET':
        res = await http.get(uri, headers: _headers);
        break;
      case 'DELETE':
        res = await http.delete(uri, headers: _headers);
        break;
      case 'PUT':
        res = await http.put(uri, headers: _headers, body: encoded);
        break;
      default:
        res = await http.post(uri, headers: _headers, body: encoded);
    }
    Map<String, dynamic> data = {};
    if (res.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) data = decoded;
      } catch (_) {
        data = {'error': res.body};
      }
    }
    if (res.statusCode >= 400) {
      throw ApiException(
        res.statusCode,
        '${data['error'] ?? data['message'] ?? res.reasonPhrase}',
        code: data['code'] as String?,
      );
    }
    return data;
  }

  Future<({AuthUser user, String token})> login(
    String email,
    String password,
  ) async {
    final data = await _json('POST', '/api/auth/login', body: {
      'email': email,
      'password': password,
    });
    return (
      user: AuthUser.fromJson(data['user'] as Map<String, dynamic>),
      token: '${data['token'] ?? ''}',
    );
  }

  Future<({AuthUser user, String token})> register(
    String email,
    String password,
  ) async {
    final data = await _json('POST', '/api/auth/register', body: {
      'email': email,
      'password': password,
    });
    return (
      user: AuthUser.fromJson(data['user'] as Map<String, dynamic>),
      token: '${data['token'] ?? ''}',
    );
  }

  Future<AuthUser> me() async {
    final data = await _json('GET', '/api/me');
    return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<List<CloudInstance>> instances() async {
    final data = await _json('GET', '/api/instances');
    final list = (data['instances'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((e) => CloudInstance.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<CloudInstance> createInstance(String name) async {
    final data = await _json('POST', '/api/instances', body: {'name': name});
    return CloudInstance.fromJson(data['instance'] as Map<String, dynamic>);
  }

  Future<void> wake(String id) => _json('POST', '/api/instances/$id/wake');
  Future<void> destroy(String id) =>
      _json('DELETE', '/api/instances/$id');

  Future<void> sendChat(String id, String text) =>
      _json('POST', '/api/instances/$id/chat', body: {'text': text});

  Future<void> stopChat(String id) =>
      _json('POST', '/api/instances/$id/chat/stop');

  Future<void> approve(String id, String choice) =>
      _json('POST', '/api/instances/$id/chat/approve', body: {'choice': choice});

  Future<void> answer(String id, {String? ref, String? answer, int? index}) =>
      _json('POST', '/api/instances/$id/chat/answer', body: {
        if (ref != null) 'id': ref,
        if (answer != null) 'answer': answer,
        if (index != null) 'index': index,
      });

  Future<void> pick(String id, {String? ref, String? value, String? kind}) =>
      _json('POST', '/api/instances/$id/chat/pick', body: {
        if (ref != null) 'id': ref,
        if (value != null) 'value': value,
        if (kind != null) 'kind': kind,
      });

  Future<void> upload(
    String id, {
    required String name,
    required Uint8List bytes,
    String? mime,
    String? caption,
  }) =>
      _json('POST', '/api/instances/$id/chat/upload', body: {
        'text': caption ?? '',
        'files': [
          {
            'name': name,
            'contentBase64': base64Encode(bytes),
            if (mime != null) 'mime': mime,
          }
        ],
      });

  Future<List<BotCommand>> commands(String id) async {
    final data = await _json('GET', '/api/instances/$id/chat/commands');
    final list = (data['commands'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map(
          (e) => BotCommand(
            command: '${e['command']}',
            description: '${e['description']}',
          ),
        )
        .toList();
  }

  Future<Map<String, dynamic>> billingConfig() =>
      _json('GET', '/api/billing/config');

  Future<Map<String, dynamic>> createOrder({
    required String purpose,
    String? name,
    String? instanceId,
    String currency = 'INR',
  }) =>
      _json('POST', '/api/billing/create-order', body: {
        'purpose': purpose,
        if (name != null) 'name': name,
        if (instanceId != null) 'instanceId': instanceId,
        'currency': currency,
      });

  Future<void> saveConfig(String id, Map<String, dynamic> body) =>
      _json('PUT', '/api/instances/$id/config', body: body);

  Stream<AppChatEvent> events(String id, {String? since}) async* {
    final uri = _u('/api/instances/$id/chat/events', {
      if (since != null && since.isNotEmpty) 'since': since,
    });
    final req = http.Request('GET', uri);
    req.headers.addAll({
      'accept': 'text/event-stream',
      if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
    });
    final client = http.Client();
    try {
      final res = await client.send(req);
      if (res.statusCode >= 400) {
        final body = await res.stream.bytesToString();
        throw ApiException(res.statusCode, body);
      }
      var buf = '';
      await for (final chunk in res.stream.transform(utf8.decoder)) {
        buf += chunk;
        while (true) {
          final i = buf.indexOf('\n\n');
          if (i < 0) break;
          final block = buf.substring(0, i);
          buf = buf.substring(i + 2);
          for (final line in block.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                final map = jsonDecode(line.substring(6));
                if (map is Map<String, dynamic>) {
                  yield AppChatEvent(map);
                }
              } catch (_) {}
            }
          }
        }
      }
    } finally {
      client.close();
    }
  }
}
