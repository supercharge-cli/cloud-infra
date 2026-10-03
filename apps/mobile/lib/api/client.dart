import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../chat/computer.dart';
import '../chat/event_stream.dart';
import 'models.dart';
import 'providers.dart';

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

  String _friendlyError(
    int status,
    Map<String, dynamic> data,
    String? fallback,
  ) {
    final raw =
        '${data['message'] ?? data['error'] ?? fallback ?? 'Request failed'}';
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
        case 'PATCH':
          res = await http
              .patch(uri, headers: _headers, body: encoded)
              .timeout(wait);
          break;
        case 'PUT':
          res = await http
              .put(uri, headers: _headers, body: encoded)
              .timeout(wait);
          break;
        default:
          res = await http
              .post(uri, headers: _headers, body: encoded)
              .timeout(wait);
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
        data = {
          'error': _friendlyError(res.statusCode, const {}, res.reasonPhrase),
        };
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
    final data = await _json(
      'POST',
      '/api/auth/login',
      body: {'email': email, 'password': password},
      timeout: _fast,
    );
    return (
      user: AuthUser.fromJson(data['user'] as Map<String, dynamic>),
      token: '${data['token'] ?? ''}',
    );
  }

  Future<({AuthUser user, String token})> register(
    String email,
    String password,
  ) async {
    final data = await _json(
      'POST',
      '/api/auth/register',
      body: {'email': email, 'password': password},
      timeout: _fast,
    );
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

  Future<List<CloudInstance>> instances() async =>
      (await dashboard()).instances;

  Future<CloudInstance> getInstance(String id) async {
    final data = await _json('GET', '/api/instances/$id', timeout: _slow);
    return CloudInstance.fromJson(data['instance'] as Map<String, dynamic>);
  }

  Future<CloudInstance> createInstance(
    String name, {
    AgentRuntime runtime = AgentRuntime.xibecode,
  }) async {
    final data = await _json(
      'POST',
      '/api/instances',
      body: {'name': name, 'runtime': runtime.apiValue},
      timeout: _slow,
    );
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
  }) => _json(
    'POST',
    '/api/instances/$id/pairing',
    body: {'code': code, 'platform': platform},
  );

  Future<Map<String, dynamic>> logs(
    String id, {
    String source = 'all',
    int lines = 200,
  }) => _json(
    'GET',
    '/api/instances/$id/logs',
    query: {'source': source, 'lines': '$lines'},
    timeout: _slow,
  );

  Future<List<WorkspaceEntry>> listWorkspace(
    String id, {
    String path = '/home/user/workspace',
  }) async {
    final data = await _json(
      'GET',
      '/api/instances/$id/workspace',
      query: {'path': path},
      timeout: _slow,
    );
    final list = (data['entries'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((e) => WorkspaceEntry.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<String> readWorkspaceFile(String id, String path) async {
    final data = await _json(
      'GET',
      '/api/instances/$id/workspace/file',
      query: {'path': path},
      timeout: _slow,
    );
    return '${data['content'] ?? data['text'] ?? ''}';
  }

  Future<DownloadedFile> exportWorkspace(String id) async {
    final response = await http
        .get(
          _u('/api/instances/$id/workspace/export'),
          headers: {..._headers, 'accept': 'application/gzip'},
        )
        .timeout(const Duration(minutes: 5));
    if (response.statusCode >= 400) {
      throw ApiException(
        response.statusCode,
        'Could not export workspace (${response.statusCode}).',
      );
    }
    return DownloadedFile(
      bytes: response.bodyBytes,
      name: 'workspace-$id.tar.gz',
      mime: response.headers['content-type'] ?? 'application/gzip',
    );
  }

  Future<String?> shareWorkspaceFile(String id, String path) async {
    final data = await _json(
      'POST',
      '/api/instances/$id/workspace/share',
      body: {'path': path},
      timeout: _slow,
    );
    final share = data['share'];
    if (share is Map) return '${share['url'] ?? ''}';
    final url = '${data['url'] ?? ''}';
    return url.isEmpty ? null : url;
  }

  Future<ExecResult> exec(
    String id, {
    required String command,
    String cwd = '/home/user/workspace',
    int timeout = 120,
  }) async {
    final data = await _json(
      'POST',
      '/api/instances/$id/exec',
      body: {'command': command, 'cwd': cwd, 'timeout': timeout},
      timeout: Duration(seconds: timeout + 15),
    );
    return ExecResult.fromJson(data, command: command);
  }

  Future<Map<String, dynamic>> cliVersion(String id) =>
      _json('GET', '/api/instances/$id/cli-version', timeout: _slow);

  Future<Map<String, dynamic>> cliUpdate(String id) => _json(
    'POST',
    '/api/instances/$id/cli-update',
    timeout: const Duration(seconds: 180),
  );

  Future<Map<String, dynamic>> recreateSandbox(String id) => _json(
    'POST',
    '/api/instances/$id/recreate',
    timeout: const Duration(seconds: 280),
  );

  Future<void> sendChat(
    String id,
    String text, {
    String? botId,
    String? chatId,
  }) => _json(
    'POST',
    '/api/instances/$id/chat',
    body: {'text': text, 'botId': ?botId, 'chatId': ?chatId},
    timeout: _slow,
  );

  Future<Map<String, dynamic>> listBots(String id) =>
      _json('GET', '/api/instances/$id/bots', timeout: _fast);

  Future<Map<String, dynamic>> groupChat(String id) =>
      _json('GET', '/api/instances/$id/group', timeout: _fast);

  Future<Map<String, dynamic>> sendGroupMessage(
    String id,
    String text,
    String requestId,
    List<String> mentions,
  ) => _json(
    'POST',
    '/api/instances/$id/group',
    body: {'text': text, 'requestId': requestId, 'mentions': mentions},
    timeout: _slow,
  );

  Future<Map<String, dynamic>> createBot(
    String id,
    Map<String, dynamic> input,
  ) => _json('POST', '/api/instances/$id/bots', body: input, timeout: _slow);

  /// Shared reviewed Managed MCP catalog. Read from the same public immutable
  /// source as the desktop app; it carries no credentials and install still
  /// goes through the owner-checked bot route.
  Future<Map<String, dynamic>> managedMcpCatalog() async {
    final res = await http
        .get(
          Uri.parse(
            'https://raw.githubusercontent.com/iotserver24/supercharge-app/'
            '70fd462b2025c0cf625fcfb5c0676060f9c69b50'
            '/public/managed-mcp/catalog.json',
          ),
          headers: {'accept': 'application/json'},
        )
        .timeout(_fast);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, 'Shared catalog is unavailable.');
    }
    final decoded = jsonDecode(res.body);
    if (decoded is! Map<String, dynamic>) {
      throw ApiException(502, 'Shared catalog is invalid.');
    }
    return decoded;
  }

  /// Managed MCP (isolated Plugin API) action for one owned bot.
  /// The body is a bounded action object (`action`, plus action-specific
  /// fields); credentials and target identity never travel through the app.
  Future<Map<String, dynamic>> botManagedMcp(
    String id,
    String botId,
    Map<String, dynamic> action,
  ) => _json(
    'POST',
    '/api/instances/$id/bots/${Uri.encodeComponent(botId)}/plugin-api',
    body: action,
    timeout: _slow,
  );

  Future<Map<String, dynamic>> updateBot(
    String id,
    String botId,
    Map<String, dynamic> input,
  ) => _json(
    'PATCH',
    '/api/instances/$id/bots/${Uri.encodeComponent(botId)}',
    body: input,
    timeout: _slow,
  );

  Future<Map<String, dynamic>> uploadBotAvatar(
    String id,
    String botId,
    Uint8List bytes,
    String mime,
  ) async {
    final res = await http
        .put(
          _u('/api/instances/$id/bots/${Uri.encodeComponent(botId)}/avatar'),
          headers: {..._headers, 'content-type': mime},
          body: bytes,
        )
        .timeout(_slow);
    if (res.statusCode >= 400) {
      var details = <String, dynamic>{};
      try {
        final parsed = jsonDecode(res.body);
        if (parsed is Map<String, dynamic>) details = parsed;
      } catch (_) {}
      throw ApiException(
        res.statusCode,
        _friendlyError(res.statusCode, details, res.reasonPhrase),
      );
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Uint8List> botAvatar(String id, String botId, String version) async {
    final res = await http
        .get(
          _u('/api/instances/$id/bots/${Uri.encodeComponent(botId)}/avatar', {
            'v': version,
          }),
          headers: _headers,
        )
        .timeout(_fast);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, 'Could not load bot picture');
    }
    return res.bodyBytes;
  }

  Future<Map<String, dynamic>> listConversations(String id, {String? botId}) =>
      _json(
        'GET',
        '/api/instances/$id/chat/conversations',
        query: botId == null ? null : {'botId': botId},
        timeout: _fast,
      );

  Future<Map<String, dynamic>> getConversation(
    String id,
    String sessionId, {
    String? botId,
  }) => _json(
    'GET',
    '/api/instances/$id/chat/conversations/${Uri.encodeComponent(sessionId)}',
    query: botId == null ? null : {'botId': botId},
    timeout: _slow,
  );

  Future<Map<String, dynamic>> startNewConversation(
    String id, {
    String? botId,
  }) => _json(
    'POST',
    '/api/instances/$id/chat/conversations',
    body: botId == null ? null : {'botId': botId},
    timeout: _slow,
  );

  Future<void> switchConversation(String id, String sessionId) => _json(
    'POST',
    '/api/instances/$id/chat/conversations/switch',
    body: {'sessionId': sessionId},
    timeout: _slow,
  );

  Future<String?> publishMedia(
    String id, {
    required String name,
    required Uint8List bytes,
    String? mime,
  }) async {
    final uri = _u('/api/instances/$id/media');
    final req = http.MultipartRequest('POST', uri);
    req.headers.addAll({
      if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
    });
    req.files.add(http.MultipartFile.fromBytes('file', bytes, filename: name));
    try {
      final streamed = await req.send().timeout(const Duration(seconds: 90));
      final res = await http.Response.fromStream(streamed);
      if (res.statusCode >= 400) return null;
      final decoded = jsonDecode(res.body);
      if (decoded is Map && decoded['url'] is String) {
        final url = (decoded['url'] as String).trim();
        return url.isEmpty ? null : url;
      }
    } catch (_) {}
    return null;
  }

  Future<String?> previewHost(String id, {int port = 3000}) async {
    try {
      final data = await _json(
        'GET',
        '/api/instances/$id/preview',
        query: {'port': '$port'},
        timeout: _fast,
      );
      final host = '${data['host'] ?? ''}'.trim();
      return host.isEmpty ? null : host;
    } catch (_) {
      return null;
    }
  }

  Future<void> stopChat(String id, {String? botId, String? chatId}) async {
    // Cooperative cancellation can take 10 seconds before the daemon replies.
    final result = await _json(
      'POST',
      '/api/instances/$id/chat/stop',
      body: {'botId': ?botId, 'chatId': ?chatId},
      timeout: const Duration(seconds: 30),
    );
    if (result['ok'] != true) {
      throw ApiException(502, 'The AI did not confirm that it stopped.');
    }
  }

  Future<void> approve(String id, String choice) => _json(
    'POST',
    '/api/instances/$id/chat/approve',
    body: {'choice': choice},
  );

  Future<void> answer(String id, {String? ref, String? answer, int? index}) =>
      _json(
        'POST',
        '/api/instances/$id/chat/answer',
        body: {'id': ?ref, 'answer': ?answer, 'index': ?index},
      );

  Future<void> pick(String id, {String? ref, String? value, String? kind}) =>
      _json(
        'POST',
        '/api/instances/$id/chat/pick',
        body: {'id': ?ref, 'value': ?value, 'kind': ?kind},
      );

  Future<void> upload(
    String id, {
    required String name,
    required Uint8List bytes,
    String? mime,
    String? caption,
  }) => uploadFiles(
    id,
    files: [(name: name, bytes: bytes, mime: mime)],
    caption: caption,
  );

  Future<void> uploadFiles(
    String id, {
    required List<({String name, Uint8List bytes, String? mime})> files,
    String? caption,
    String? botId,
    String? chatId,
  }) async {
    if (files.isEmpty) {
      if (caption != null && caption.trim().isNotEmpty) {
        await sendChat(id, caption.trim(), botId: botId, chatId: chatId);
      }
      return;
    }
    final payload = <Map<String, String>>[];
    for (final f in files.take(12)) {
      final image =
          (f.mime ?? '').toLowerCase().startsWith('image/') ||
          RegExp(
            r'\.(png|jpe?g|gif|webp|bmp)$',
            caseSensitive: false,
          ).hasMatch(f.name);
      if (image) {
        final url = await publishMedia(
          id,
          name: f.name,
          bytes: f.bytes,
          mime: f.mime,
        );
        if (url != null) {
          payload.add({
            'name': f.name,
            if (f.mime != null) 'mime': f.mime!,
            'url': url,
          });
          continue;
        }
      }
      payload.add({
        'name': f.name,
        if (f.mime != null) 'mime': f.mime!,
        'contentBase64': base64Encode(f.bytes),
      });
    }
    await _json(
      'POST',
      '/api/instances/$id/chat',
      body: {
        if (caption != null && caption.isNotEmpty) 'text': caption,
        'botId': ?botId,
        'chatId': ?chatId,
        'files': payload,
      },
      timeout: _slow,
    );
  }

  Future<DownloadedFile> downloadFile(String id, String fileId) async {
    final uri = _u('/api/instances/$id/chat/files/$fileId');
    late http.Response res;
    try {
      res = await http
          .get(
            uri,
            headers: {
              'accept': '*/*',
              if (token != null && token!.isNotEmpty)
                'authorization': 'Bearer $token',
            },
          )
          .timeout(const Duration(seconds: 60));
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

  Future<Map<String, dynamic>> chatStatus(String id, {String? sessionId}) =>
      _json(
        'GET',
        '/api/instances/$id/chat/status',
        query: sessionId == null ? null : {'sessionId': sessionId},
        timeout: _fast,
      );

  Future<List<String>> models(String id) async {
    final data = await _json(
      'GET',
      '/api/instances/$id/models',
      timeout: _slow,
    );
    final free = ((data['free'] as List?) ?? const [])
        .map((e) => '$e')
        .toList();
    final live = ((data['models'] as List?) ?? const [])
        .map((e) => '$e')
        .toList();
    final seen = <String>{};
    final out = <String>[];
    for (final id in [...free, ...live]) {
      if (id.isEmpty || seen.contains(id)) continue;
      seen.add(id);
      out.add(id);
    }
    return out;
  }

  Future<List<CatalogModel>> modelsForProvider(String provider) async {
    final data = await _json(
      'GET',
      '/api/models',
      query: {'provider': provider.trim()},
      timeout: _fast,
    );
    return parseCatalogModels(data['models']);
  }

  Future<List<BotCommand>> commands(String id) async {
    final data = await _json(
      'GET',
      '/api/instances/$id/chat/commands',
      timeout: _slow,
    );
    final list = (data['commands'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map(
          (e) => BotCommand(
            command: '${e['command']}'.replaceFirst(RegExp(r'^/+'), ''),
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
    AgentRuntime runtime = AgentRuntime.xibecode,
  }) => _json(
    'POST',
    '/api/billing/create-order',
    body: {
      'purpose': purpose,
      'name': ?name,
      'instanceId': ?instanceId,
      'currency': currency,
      'runtime': runtime.apiValue,
    },
    timeout: _fast,
  );

  Future<Map<String, dynamic>> verifyPayment({
    required String orderId,
    required String paymentId,
    required String signature,
  }) => _json(
    'POST',
    '/api/billing/verify',
    body: {
      'razorpay_order_id': orderId,
      'razorpay_payment_id': paymentId,
      'razorpay_signature': signature,
    },
    timeout: _slow,
  );

  Future<void> saveConfig(String id, Map<String, dynamic> body) =>
      _json('PUT', '/api/instances/$id/config', body: body, timeout: _slow);

  Future<Map<String, dynamic>> pollinationsStatus() =>
      _json('GET', '/api/pollinations/start', timeout: _fast);

  Future<String> pollinationsConnectUrl([String? instanceId]) async {
    final data = await _json(
      'POST',
      '/api/pollinations/start',
      body: {
        if (instanceId != null && instanceId.isNotEmpty)
          'instanceId': instanceId,
        'fromApp': true,
      },
    );
    final url = '${data['url'] ?? ''}';
    if (url.isEmpty) throw ApiException(500, 'Connect URL missing');
    return url;
  }

  Future<void> pollinationsDisconnect() =>
      _json('DELETE', '/api/pollinations/start', timeout: _fast);

  Future<Map<String, dynamic>> pollinationsApplyAll() =>
      _json('PUT', '/api/pollinations/start', timeout: _slow);

  Stream<AppChatEvent> events(
    String id, {
    String? since,
    String? botId,
    String? chatId,
    EventStreamCancellation? cancellation,
  }) async* {
    final uri = _u('/api/instances/$id/chat/events', {
      if (since != null && since.isNotEmpty) 'since': since,
      'botId': ?botId,
      'chatId': ?chatId,
    });
    final req = http.Request('GET', uri);
    req.headers.addAll({
      'accept': 'text/event-stream',
      if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
    });
    final client = http.Client();
    final removeCancel = cancellation?.onCancel(client.close);
    try {
      if (cancellation?.isCancelled == true) return;
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
      await for (final event in decodeEventStream(
        res.stream.timeout(const Duration(seconds: 35)),
      )) {
        if (cancellation?.isCancelled == true) return;
        yield AppChatEvent(event);
      }
    } on TimeoutException {
      throw ApiException(
        0,
        'Chat connection stopped responding. Reconnecting…',
      );
    } finally {
      removeCancel?.call();
      client.close();
    }
  }

  Stream<ComputerFrame> browserFrames(
    String id, {
    EventStreamCancellation? cancellation,
  }) async* {
    final uri = _u('/api/instances/$id/computer/browser');
    final req = http.Request('GET', uri);
    req.headers.addAll({
      'accept': 'text/event-stream',
      if (token != null && token!.isNotEmpty) 'authorization': 'Bearer $token',
    });
    final client = http.Client();
    final removeCancel = cancellation?.onCancel(client.close);
    try {
      if (cancellation?.isCancelled == true) return;
      final res = await client.send(req).timeout(_sseConnect);
      if (cancellation?.isCancelled == true) return;
      if (res.statusCode >= 400) {
        final body = await res.stream.bytesToString();
        throw ApiException(
          res.statusCode,
          body.isEmpty ? 'Browser stream failed' : body,
        );
      }
      var buf = '';
      await for (final chunk in res.stream.transform(utf8.decoder)) {
        if (cancellation?.isCancelled == true) return;
        buf += chunk;
        while (true) {
          final i = buf.indexOf('\n\n');
          if (i < 0) break;
          final block = buf.substring(0, i);
          buf = buf.substring(i + 2);
          for (final line in block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              final map = jsonDecode(line.substring(6));
              if (map is! Map) continue;
              final type = '${map['type'] ?? ''}';
              if (type == 'frame') {
                final raw = '${map['data'] ?? ''}';
                Uint8List? bytes;
                if (raw.isNotEmpty) {
                  try {
                    bytes = base64Decode(raw);
                  } catch (_) {}
                }
                yield ComputerFrame(
                  type: type,
                  seq: (map['seq'] as num?)?.toInt() ?? 0,
                  bytes: bytes,
                );
              } else if (type == 'status') {
                yield ComputerFrame(
                  type: type,
                  connected: map['connected'] == true,
                  screencasting: map['screencasting'] == true,
                  desktop: map['desktop'] == true,
                  error: map['error'] as String?,
                );
              }
            } catch (_) {}
          }
        }
      }
    } on TimeoutException {
      throw ApiException(0, 'Browser stream timed out while connecting.');
    } finally {
      removeCancel?.call();
      client.close();
    }
  }

  Future<Map<String, dynamic>> computerStatus(String id) =>
      _json('GET', '/api/instances/$id/computer/status', timeout: _fast);

  Future<String> openAiBrowserVnc(
    String id, {
    required String handoffId,
  }) async {
    final ticket = await _json(
      'POST',
      '/api/instances/$id/computer/vnc-ticket',
      body: {'handoffId': handoffId},
    );
    final raw = ticket['wsUrl'];
    final wsUrl = raw is String ? raw.trim() : '';
    final uri = Uri.tryParse(wsUrl);
    if (uri == null ||
        (uri.scheme != 'ws' && uri.scheme != 'wss') ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasFragment ||
        RegExp(r'\s').hasMatch(wsUrl)) {
      throw ApiException(
        502,
        'The AI browser display returned an invalid WebSocket URL.',
      );
    }
    return wsUrl;
  }

  Future<DateTime> startBrowserHandoff(
    String id, {
    required String handoffId,
    String? botId,
    String? sessionId,
    int minutes = 10,
  }) async {
    final result = await _json(
      'POST',
      '/api/instances/$id/computer/handoff',
      body: {
        'action': 'start',
        'minutes': minutes.clamp(1, 30),
        'handoffId': handoffId,
        'botId': ?botId,
        'sessionId': ?sessionId,
      },
    );
    final rawExpiry = result['expiresAt'];
    if (result['ok'] != true ||
        result['handoff'] != true ||
        result['handoffId'] != handoffId ||
        rawExpiry is! num ||
        !rawExpiry.isFinite) {
      throw ApiException(
        502,
        'The AI did not confirm browser control and its expiry.',
      );
    }
    late final DateTime expiresAt;
    try {
      expiresAt = DateTime.fromMillisecondsSinceEpoch(rawExpiry.toInt());
    } on ArgumentError {
      throw ApiException(502, 'The AI browser control expiry is invalid.');
    }
    if (!expiresAt.isAfter(DateTime.now())) {
      throw ApiException(
        502,
        'The AI browser control lease has already expired.',
      );
    }
    return expiresAt;
  }

  Future<void> stopBrowserHandoff(
    String id, {
    required String handoffId,
  }) async {
    final result = await _json(
      'POST',
      '/api/instances/$id/computer/handoff',
      body: {'action': 'stop', 'handoffId': handoffId},
    );
    if (result['ok'] != true ||
        result['handoff'] != false ||
        result['handoffId'] != handoffId) {
      throw ApiException(
        502,
        'The AI did not confirm that browser control was returned.',
      );
    }
  }
}
