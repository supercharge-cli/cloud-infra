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
  bool get paymentRequired => status == 402 || code == 'PAYMENT_REQUIRED';
  @override
  String toString() => message;
}

class VectraClient {
  VectraClient({required this.baseUrl, this.token});

  final String baseUrl;
  String? token;

  static const _fast = Duration(seconds: 20);
  static const _slow = Duration(seconds: 120);
  static const _sseConnect = Duration(seconds: 50);

  Uri _u(String path, [Map<String, String>? q]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: q);

  Map<String, String> get _headers => {
        'accept': 'application/json',
        'content-type': 'application/json',
        if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
      };

  String _friendlyError(int status, Map<String, dynamic> data, String? fallback) {
    final raw = '${data['message'] ?? data['error'] ?? fallback ?? 'Request failed'}';
    if (raw.trimLeft().startsWith('<')) {
      return 'Server error $status. Try again.';
    }
    return raw;
  }

  Future<Map<String, dynamic>> _json(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    Duration? timeout,
  }) async {
    final uri = _u(path, query);
    final encoded = body == null ? null : jsonEncode(body);
    final wait = timeout ?? (method == 'GET' ? _fast : _slow);
    late http.Response res;
    try {
      switch (method) {
        case 'GET':
          res = await http.get(uri, headers: _headers).timeout(wait);
          break;
        case 'DELETE':
          res = await http.delete(uri, headers: _headers).timeout(wait);
          break;
        case 'PUT':
          res = await http.put(uri, headers: _headers, body: encoded).timeout(wait);
          break;
        default:
          res = await http.post(uri, headers: _headers, body: encoded).timeout(wait);
      }
    } on TimeoutException {
      throw ApiException(0, 'Request timed out. Check your connection.');
    } on http.ClientException catch (e) {
      throw ApiException(0, 'Network error: ${e.message}');
    }

    Map<String, dynamic> data = {};
    if (res.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) data = decoded;
      } catch (_) {
        data = {'error': _friendlyError(res.statusCode, const {}, res.reasonPhrase)};
      }
    }
    if (res.statusCode >= 400) {
      throw ApiException(
        res.statusCode,
        _friendlyError(res.statusCode, data, res.reasonPhrase),
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
    }, timeout: _fast);
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
    }, timeout: _fast);
    return (
      user: AuthUser.fromJson(data['user'] as Map<String, dynamic>),
      token: '${data['token'] ?? ''}',
    );
  }

  Future<AuthUser> me() async {
    final data = await _json('GET', '/api/me', timeout: _fast);
    return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<DashboardData> dashboard() async {
    final data = await _json('GET', '/api/instances', timeout: _fast);
    final list = (data['instances'] as List?) ?? const [];
    return DashboardData(
      instances: list
          .whereType<Map>()
          .map((e) => CloudInstance.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      quota: FreeQuota.fromJson(data['freeQuota'] as Map<String, dynamic>?),
      plan: PlanInfo.fromJson(data['plan'] as Map<String, dynamic>?),
    );
  }

  Future<List<CloudInstance>> instances() async => (await dashboard()).instances;

  Future<CloudInstance> getInstance(String id) async {
    final data = await _json('GET', '/api/instances/$id', timeout: _slow);
    return CloudInstance.fromJson(data['instance'] as Map<String, dynamic>);
  }

  Future<CloudInstance> createInstance(String name) async {
    final data = await _json('POST', '/api/instances', body: {'name': name}, timeout: _slow);
    return CloudInstance.fromJson(data['instance'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> wake(String id) =>
      _json('POST', '/api/instances/$id/wake', timeout: _slow);
  Future<Map<String, dynamic>> restart(String id) =>
      _json('POST', '/api/instances/$id/restart', timeout: _slow);
  Future<void> destroy(String id) =>
      _json('DELETE', '/api/instances/$id', timeout: _slow);

  Future<Map<String, dynamic>> getConfig(String id) =>
      _json('GET', '/api/instances/$id/config', timeout: _slow);

  Future<Map<String, dynamic>> pairing(String id) =>
      _json('GET', '/api/instances/$id/pairing', timeout: _slow);

  Future<Map<String, dynamic>> approvePair(
    String id, {
    required String code,
    String platform = 'telegram',
  }) =>
      _json('POST', '/api/instances/$id/pairing', body: {
        'code': code,
        'platform': platform,
      });

  Future<Map<String, dynamic>> logs(
    String id, {
    String source = 'all',
    int lines = 200,
  }) =>
      _json('GET', '/api/instances/$id/logs', query: {
        'source': source,
        'lines': '$lines',
      }, timeout: _slow);

  Future<ExecResult> exec(
    String id, {
    required String command,
    String cwd = '/home/user/workspace',
    int timeout = 120,
  }) async {
    final data = await _json('POST', '/api/instances/$id/exec', body: {
      'command': command,
      'cwd': cwd,
      'timeout': timeout,
    }, timeout: Duration(seconds: timeout + 15));
    return ExecResult.fromJson(data, command: command);
  }

  Future<Map<String, dynamic>> cliVersion(String id) =>
      _json('GET', '/api/instances/$id/cli-version', timeout: _slow);

  Future<Map<String, dynamic>> cliUpdate(String id) =>
      _json('POST', '/api/instances/$id/cli-update', timeout: const Duration(seconds: 180));

  Future<void> sendChat(String id, String text) =>
      _json('POST', '/api/instances/$id/chat', body: {'text': text}, timeout: _slow);

  Future<void> stopChat(String id) =>
      _json('POST', '/api/instances/$id/chat/stop', timeout: _fast);

  Future<void> approve(String id, String choice) =>
      _json('POST', '/api/instances/$id/chat/approve', body: {'choice': choice});

  Future<void> answer(String id, {String? ref, String? answer, int? index}) =>
      _json('POST', '/api/instances/$id/chat/answer', body: {
        'id': ?ref,
        'answer': ?answer,
        'index': ?index,
      });

  Future<void> pick(String id, {String? ref, String? value, String? kind}) =>
      _json('POST', '/api/instances/$id/chat/pick', body: {
        'id': ?ref,
        'value': ?value,
        'kind': ?kind,
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
            'mime': ?mime,
          }
        ],
      }, timeout: const Duration(seconds: 90));

  Future<DownloadedFile> downloadFile(String id, String fileId) async {
    final uri = _u('/api/instances/$id/chat/files/$fileId');
    late http.Response res;
    try {
      res = await http.get(uri, headers: {
        'accept': '*/*',
        if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw ApiException(0, 'Download timed out');
    }
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, 'Could not download file');
    }
    final disp = res.headers['content-disposition'] ?? '';
    final match = RegExp(r'filename="?([^"]+)"?').firstMatch(disp);
    return DownloadedFile(
      bytes: res.bodyBytes,
      name: match?.group(1) ?? fileId,
      mime: res.headers['content-type'],
    );
  }

  Future<List<BotCommand>> commands(String id) async {
    final data = await _json('GET', '/api/instances/$id/chat/commands', timeout: _slow);
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
      _json('GET', '/api/billing/config', timeout: _fast);

  Future<Map<String, dynamic>> createOrder({
    required String purpose,
    String? name,
    String? instanceId,
    String currency = 'INR',
  }) =>
      _json('POST', '/api/billing/create-order', body: {
        'purpose': purpose,
        'name': ?name,
        'instanceId': ?instanceId,
        'currency': currency,
      }, timeout: _fast);

  Future<Map<String, dynamic>> verifyPayment({
    required String orderId,
    required String paymentId,
    required String signature,
  }) =>
      _json('POST', '/api/billing/verify', body: {
        'razorpay_order_id': orderId,
        'razorpay_payment_id': paymentId,
        'razorpay_signature': signature,
      }, timeout: _slow);

  Future<void> saveConfig(String id, Map<String, dynamic> body) =>
      _json('PUT', '/api/instances/$id/config', body: body, timeout: _slow);

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
      final res = await client.send(req).timeout(_sseConnect);
      if (res.statusCode >= 400) {
        final body = await res.stream.bytesToString();
        Map<String, dynamic> data = {};
        try {
          final decoded = jsonDecode(body);
          if (decoded is Map<String, dynamic>) data = decoded;
        } catch (_) {}
        throw ApiException(
          res.statusCode,
          _friendlyError(res.statusCode, data, body),
          code: data['code'] as String?,
        );
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
    } on TimeoutException {
      throw ApiException(0, 'Chat inbox timed out while connecting.');
    } finally {
      client.close();
    }
  }
}
