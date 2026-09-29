import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

Uri? normalizedBrowserWebSocket(String value) {
  final authority = RegExp(r'^[A-Za-z]+://([^/?#]*)').firstMatch(value)?.group(1) ?? '';
  if (RegExp(r':0+$').hasMatch(authority)) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || !{'ws', 'wss'}.contains(uri.scheme) || !uri.hasAuthority ||
      uri.host.isEmpty || uri.userInfo.isNotEmpty || uri.hasFragment ||
      (uri.hasPort && (uri.port < 1 || uri.port > 65535))) {
    return null;
  }
  return uri.hasPort ? uri : uri.replace(port: uri.scheme == 'wss' ? 443 : 80);
}

/// A capability-addressed, loopback-only noVNC page and WebSocket bridge.
///
/// The connection callback means at least one proxy socket is active; it does
/// not mean that the remote RFB authentication/handshake has completed.
class DesktopBrowserViewer {
  DesktopBrowserViewer._(
    this._server,
    this._html,
    this._viewerModule,
    this._requestVncUrl,
    this._readState,
    this._onAction,
    this._onConnectionChanged,
    String token,
  ) : url = Uri(
        scheme: 'http',
        host: InternetAddress.loopbackIPv4.address,
        port: _server.port,
        path: '/$token/',
      );

  static const _closeTimeout = Duration(seconds: 2);
  static const _connectTimeout = Duration(seconds: 15);
  static const _maxActionBytes = 16 * 1024;
  static const _actions = {'takeControl', 'returnControl', 'reconnect'};

  static Future<DesktopBrowserViewer> start({
    required String html,
    required String viewerModule,
    required Future<String> Function() requestVncUrl,
    required Map<String, Object?> Function() readState,
    required Future<void> Function(String action, String notes) onAction,
    void Function(bool connected)? onConnectionChanged,
  }) async {
    final random = Random.secure();
    final token = base64Url
        .encode(List<int>.generate(32, (_) => random.nextInt(256)))
        .replaceAll('=', '');
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final viewer = DesktopBrowserViewer._(
      server,
      html,
      viewerModule,
      requestVncUrl,
      readState,
      onAction,
      onConnectionChanged,
      token,
    );
    viewer._requests = server.listen(
      (request) => unawaited(viewer._serve(request)),
      onError: (Object _, StackTrace _) => unawaited(viewer.close()),
      onDone: () => unawaited(viewer.close()),
    );
    return viewer;
  }

  final HttpServer _server;
  final String _html;
  final String _viewerModule;
  final Future<String> Function() _requestVncUrl;
  final Map<String, Object?> Function() _readState;
  final Future<void> Function(String, String) _onAction;
  final void Function(bool)? _onConnectionChanged;
  final Set<_ViewerConnection> _connections = {};
  late final StreamSubscription<HttpRequest> _requests;
  int _generation = 0;
  int _suspending = 0;
  bool _closed = false;
  bool _actionPending = false;
  bool _connected = false;
  Future<void>? _closeFuture;

  final Uri url;

  /// Invalidates outstanding requests before starting any asynchronous cleanup.
  /// A subsequent connection must obtain the new generation from `state`.
  Future<void> suspend() {
    _generation++;
    _suspending++;
    final closing = Future.wait(
      _connections.toList().map((connection) => connection.close()),
    ).timeout(_closeTimeout, onTimeout: () => <void>[]);
    return closing.then<void>((_) {}).whenComplete(() {
      _suspending--;
    });
  }

  Future<void> close() {
    if (_closeFuture != null) return _closeFuture!;
    _closed = true;
    final socketsClosed = suspend();
    return _closeFuture = _finishClose(socketsClosed);
  }

  Future<void> _finishClose(Future<void> socketsClosed) async {
    // HttpServer.close alone does not own sockets detached by a WS upgrade.
    await Future.wait([socketsClosed, _settle(_server.close(force: true))]);
    await _settle(_requests.cancel());
  }

  void _connectionsChanged() {
    final connected = _connections.any((connection) => connection.active);
    if (connected == _connected) return;
    _connected = connected;
    try {
      _onConnectionChanged?.call(connected);
    } catch (_) {
      // A UI observer must not turn a socket event into an uncaught error.
    }
  }

  Map<String, Object?> _state() {
    try {
      return {..._readState(), 'generation': _generation};
    } catch (_) {
      throw const _ViewerFailure(500, 'Viewer state unavailable.');
    }
  }

  Map<String, Object?> _checkConnection(_ViewerConnection connection) {
    void checkGeneration() {
      if (_closed ||
          connection.closing ||
          connection.generation != _generation) {
        throw const _ViewerFailure(
          409,
          'Viewer connection is no longer current.',
        );
      }
    }

    checkGeneration();
    final state = _state();
    checkGeneration();
    final phase = state['phase'];
    if (phase != 'watching' && phase != 'controlling') {
      throw const _ViewerFailure(409, 'Browser is not available for viewing.');
    }
    if (state['inputPaused'] == true) {
      throw const _ViewerFailure(409, 'Desktop input is paused.');
    }
    if (!connection.active &&
        (state['busy'] == true || _actionPending || _suspending != 0)) {
      throw const _ViewerFailure(409, 'Browser is busy.');
    }
    if (phase == 'controlling') {
      final expiresAt = state['expiresAt'];
      if (expiresAt is! int ||
          expiresAt <= DateTime.now().millisecondsSinceEpoch) {
        throw const _ViewerFailure(409, 'Browser control has expired.');
      }
    }
    return state;
  }

  void _setHeaders(HttpResponse response) {
    response.headers
      ..set(HttpHeaders.cacheControlHeader, 'no-store')
      ..set(HttpHeaders.pragmaHeader, 'no-cache')
      ..set('Referrer-Policy', 'no-referrer')
      ..set('X-Content-Type-Options', 'nosniff')
      ..set('X-Frame-Options', 'DENY')
      ..set('Cross-Origin-Resource-Policy', 'same-origin')
      ..set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self' data:; connect-src 'self' ws://${url.authority}; "
            "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'",
      );
  }

  bool _headerEquals(HttpHeaders headers, String name, String value) {
    final values = headers[name];
    return values != null && values.length == 1 && values.single == value;
  }

  Future<void> _serve(HttpRequest request) async {
    unawaited(_settle(request.response.done));
    try {
      _setHeaders(request.response);
      if (!_headerEquals(
        request.headers,
        HttpHeaders.hostHeader,
        url.authority,
      )) {
        throw const _ViewerFailure(403, 'Invalid viewer host.');
      }
      if (request.headers['origin'] != null &&
          !_headerEquals(request.headers, 'origin', url.origin)) {
        throw const _ViewerFailure(403, 'Invalid viewer origin.');
      }
      if (_closed) {
        throw const _ViewerFailure(503, 'Viewer is closed.');
      }
      if (request.uri.hasScheme || !request.uri.path.startsWith(url.path)) {
        throw const _ViewerFailure(404, 'Not found.');
      }
      final route = request.uri.path.substring(url.path.length);
      if (!{'', 'rfb.mjs', 'state', 'action', 'vnc'}.contains(route)) {
        throw const _ViewerFailure(404, 'Not found.');
      }
      final method = route == 'action' ? 'POST' : 'GET';
      if (request.method != method) {
        request.response.headers.set(HttpHeaders.allowHeader, method);
        throw const _ViewerFailure(405, 'Method not allowed.');
      }
      if ((route == 'action' || route == 'vnc') &&
          !_headerEquals(request.headers, 'origin', url.origin)) {
        throw const _ViewerFailure(403, 'Viewer origin is required.');
      }
      if (route != 'vnc' && request.uri.hasQuery) {
        throw const _ViewerFailure(400, 'Unexpected query parameters.');
      }
      switch (route) {
        case '':
          await _send(request, 200, _html, ContentType.html);
        case 'rfb.mjs':
          await _send(
            request,
            200,
            _viewerModule,
            ContentType('text', 'javascript', charset: 'utf-8'),
          );
        case 'state':
          await _sendState(request);
        case 'action':
          await _action(request);
        case 'vnc':
          final params = request.uri.queryParametersAll;
          final generations = params['generation'];
          if (params.length != 1 ||
              generations == null ||
              generations.length != 1 ||
              !RegExp(r'^(0|[1-9][0-9]*)$').hasMatch(generations.single)) {
            throw const _ViewerFailure(400, 'A viewer generation is required.');
          }
          final generation = int.tryParse(generations.single);
          if (generation == null || generation != _generation) {
            throw const _ViewerFailure(
              409,
              'Viewer connection is no longer current.',
            );
          }
          if (!WebSocketTransformer.isUpgradeRequest(request)) {
            throw const _ViewerFailure(426, 'WebSocket upgrade required.');
          }
          final connection = _ViewerConnection(this, request, generation);
          _connections.add(connection);
          await connection.open();
      }
    } on _ViewerFailure catch (failure) {
      await _sendFailure(request, failure);
    } catch (_) {
      await _sendFailure(
        request,
        const _ViewerFailure(500, 'Viewer request failed.'),
      );
    }
  }

  Future<void> _action(HttpRequest request) async {
    if (request.headers.contentType?.mimeType != 'application/json') {
      throw const _ViewerFailure(415, 'A JSON action is required.');
    }
    if (request.contentLength > _maxActionBytes) {
      throw const _ViewerFailure(413, 'Action is too large.');
    }
    final generation = _generation;
    final bytes = BytesBuilder(copy: false);
    try {
      await for (final chunk in request.timeout(const Duration(seconds: 10))) {
        if (_closed || generation != _generation) {
          throw const _ViewerFailure(
            409,
            'Viewer action is no longer current.',
          );
        }
        if (bytes.length + chunk.length > _maxActionBytes) {
          throw const _ViewerFailure(413, 'Action is too large.');
        }
        bytes.add(chunk);
      }
    } on TimeoutException {
      throw const _ViewerFailure(408, 'Action timed out.');
    }
    Object? body;
    try {
      body = jsonDecode(utf8.decode(bytes.takeBytes()));
    } catch (_) {
      throw const _ViewerFailure(400, 'Invalid JSON action.');
    }
    if (body is! Map<String, dynamic> ||
        body.keys.any((key) => key != 'action' && key != 'notes')) {
      throw const _ViewerFailure(400, 'Invalid viewer action.');
    }
    final action = body['action'];
    final notes = body['notes'] ?? '';
    if (action is! String || !_actions.contains(action)) {
      throw const _ViewerFailure(400, 'Unknown viewer action.');
    }
    if (notes is! String || notes.length > 4000) {
      throw const _ViewerFailure(400, 'Notes must be at most 4000 characters.');
    }
    if (_closed || generation != _generation || _actionPending) {
      throw const _ViewerFailure(409, 'Viewer action is no longer current.');
    }
    _actionPending = true;
    try {
      await _onAction(action, notes);
    } catch (_) {
      throw const _ViewerFailure(500, 'Viewer action failed.');
    } finally {
      _actionPending = false;
    }
    if (_closed) throw const _ViewerFailure(503, 'Viewer is closed.');
    // The callback can intentionally suspend the viewer and change generation.
    await _sendState(request);
  }

  Future<void> _sendState(HttpRequest request) async {
    String state;
    try {
      state = jsonEncode(_state());
    } catch (_) {
      throw const _ViewerFailure(500, 'Viewer state unavailable.');
    }
    await _send(request, 200, state, ContentType.json);
  }

  Future<void> _sendFailure(HttpRequest request, _ViewerFailure failure) =>
      _send(
        request,
        failure.status,
        jsonEncode({'error': failure.message}),
        ContentType.json,
      );

  Future<void> _send(
    HttpRequest request,
    int status,
    String body,
    ContentType contentType,
  ) async {
    try {
      request.response
        ..statusCode = status
        ..headers.contentType = contentType
        ..persistentConnection = false
        ..add(utf8.encode(body));
      await request.response.close().timeout(_closeTimeout);
    } catch (_) {
      // The browser may have abandoned this request or completed a WS upgrade.
    }
  }

  static Future<void> _settle(Future<dynamic> future) async {
    try {
      await future.timeout(_closeTimeout);
    } catch (_) {
      // Shutdown and disconnected peers must never surface stream errors.
    }
  }
}

class _ViewerFailure implements Exception {
  const _ViewerFailure(this.status, this.message);

  final int status;
  final String message;
}

class _ViewerConnection {
  _ViewerConnection(this.viewer, this.request, this.generation) {
    _client.connectionTimeout = DesktopBrowserViewer._connectTimeout;
    _client.findProxy = (_) => 'DIRECT';
    _client.connectionFactory = _connectTransport;
  }

  final DesktopBrowserViewer viewer;
  final HttpRequest request;
  final int generation;
  final HttpClient _client = HttpClient();
  final Set<ConnectionTask<Socket>> _dialing = {};
  final Set<Socket> _transports = {};
  final Completer<void> _cancelled = Completer<void>();
  final Completer<void> _openingDone = Completer<void>();
  _ViewerSocket? _upstream;
  _ViewerSocket? _downstream;
  Uri? _remote;
  Timer? _policyTimer;
  Future<void>? _closeFuture;
  bool _upgrading = false;
  bool active = false;
  bool closing = false;

  void _check() => viewer._checkConnection(this);

  Future<T> _wait<T>(Future<T> Function() operation) async {
    _check();
    final result = await Future.any<T>([
      operation(),
      _cancelled.future.then<T>((_) {
        throw const _ViewerFailure(
          409,
          'Viewer connection is no longer current.',
        );
      }),
    ]).timeout(DesktopBrowserViewer._connectTimeout);
    _check();
    return result;
  }

  Future<void> open() async {
    try {
      _watchPolicy();
      _check();
      final target = await _wait(viewer._requestVncUrl);
      _check();
      final remote = normalizedBrowserWebSocket(target);
      if (remote == null) {
        throw const _ViewerFailure(502, 'Invalid browser connection address.');
      }
      _remote = remote;
      _check();
      await _wait(
        () =>
            WebSocket.connect(
              remote.toString(),
              customClient: _client,
              compression: CompressionOptions.compressionOff,
            ).then((socket) {
              final endpoint = _upstream = _ViewerSocket(socket, _ended);
              if (closing) unawaited(endpoint.close());
              return endpoint;
            }),
      );
      _check();
      _upgrading = true;
      await _wait(
        () =>
            WebSocketTransformer.upgrade(
              request,
              compression: CompressionOptions.compressionOff,
            ).then((socket) {
              final endpoint = _downstream = _ViewerSocket(socket, _ended);
              if (closing) unawaited(endpoint.close());
              return endpoint;
            }),
      );
      _check();
      // Both are single-subscription streams. Dart buffers the RFB greeting and
      // any early client frames until these listeners are installed; a broadcast
      // stream or a temporary drain listener would silently lose those bytes.
      _upstream!.listen((message) => _forward(_downstream!, message));
      _downstream!.listen((message) => _forward(_upstream!, message));
      active = true;
      viewer._connectionsChanged();
      _watchPolicy();
    } on _ViewerFailure catch (failure) {
      if (!_upgrading) await viewer._sendFailure(request, failure);
    } catch (_) {
      if (!_upgrading) {
        await viewer._sendFailure(
          request,
          const _ViewerFailure(502, 'Unable to connect to the browser.'),
        );
      }
    } finally {
      _openingDone.complete();
      if (!active) unawaited(close());
    }
  }

  // Retaining the transport lets shutdown terminate even a detached upstream
  // WebSocket whose peer does not acknowledge its close frame.
  Future<ConnectionTask<Socket>> _connectTransport(
    Uri uri,
    String? proxyHost,
    int? proxyPort,
  ) async {
    _check();
    final remote = _remote!;
    if (proxyHost != null ||
        proxyPort != null ||
        uri.host != remote.host ||
        uri.port != remote.port ||
        uri.scheme != (remote.scheme == 'wss' ? 'https' : 'http')) {
      throw const _ViewerFailure(502, 'Invalid browser connection address.');
    }
    final ConnectionTask<Socket> task = await (uri.scheme == 'https'
        ? SecureSocket.startConnect(uri.host, uri.port)
        : Socket.startConnect(uri.host, uri.port));
    _dialing.add(task);
    final socket = task.socket.then<Socket>(
      (socket) {
        _dialing.remove(task);
        _transports.add(socket);
        unawaited(DesktopBrowserViewer._settle(socket.done));
        try {
          _check();
        } catch (_) {
          socket.destroy();
          rethrow;
        }
        return socket;
      },
      onError: (Object error, StackTrace stack) {
        _dialing.remove(task);
        Error.throwWithStackTrace(error, stack);
      },
    );
    // Observe errors even if invalidation happens before HttpClient gets task.
    unawaited(socket.then<void>((_) {}, onError: (Object _, StackTrace _) {}));
    try {
      _check();
    } catch (_) {
      task.cancel();
      rethrow;
    }
    return ConnectionTask.fromSocket(socket, task.cancel);
  }

  void _forward(_ViewerSocket destination, dynamic message) {
    try {
      _check();
      // WebSocket.add preserves frame order and binary/text type. There is no
      // asynchronous gap between the policy check and forwarding input.
      destination.socket.add(message);
    } catch (_) {
      _ended();
    }
  }

  void _watchPolicy() {
    _policyTimer?.cancel();
    final state = viewer._checkConnection(this);
    var milliseconds = 250;
    if (state['phase'] == 'controlling') {
      milliseconds = min(
        milliseconds,
        max(
          1,
          (state['expiresAt'] as int) - DateTime.now().millisecondsSinceEpoch,
        ),
      );
    }
    _policyTimer = Timer(Duration(milliseconds: milliseconds), () {
      try {
        _watchPolicy();
      } catch (_) {
        _ended();
      }
    });
  }

  void _ended() => unawaited(close());

  Future<void> close() {
    if (_closeFuture != null) return _closeFuture!;
    closing = true;
    active = false;
    _policyTimer?.cancel();
    _cancelled.complete();
    viewer._connectionsChanged();
    _client.close(force: true);
    for (final task in _dialing.toList()) {
      task.cancel();
    }
    return _closeFuture = _finishClose();
  }

  Future<void> _finishClose() async {
    try {
      await Future.wait([
        if (_upstream != null) _upstream!.close(),
        if (_downstream != null) _downstream!.close(),
        _openingDone.future,
      ]).timeout(DesktopBrowserViewer._closeTimeout);
    } catch (_) {
      // A stalled callback/peer cannot indefinitely delay relinquishing control.
    } finally {
      for (final socket in _transports) {
        socket.destroy();
      }
      // Also cover an upgrade that completed while the waits above were running.
      await Future.wait([
        if (_upstream != null) _upstream!.close(),
        if (_downstream != null) _downstream!.close(),
      ]);
      viewer._connections.remove(this);
    }
  }
}

class _ViewerSocket {
  _ViewerSocket(this.socket, this.onEnd) {
    unawaited(
      socket.done.then<void>(
        (_) => onEnd(),
        onError: (Object _, StackTrace _) => onEnd(),
      ),
    );
  }

  final WebSocket socket;
  final void Function() onEnd;
  final Completer<void> _receivedClose = Completer<void>();
  StreamSubscription<dynamic>? _subscription;
  Future<void>? _closeFuture;

  void listen(void Function(dynamic) onData) {
    _subscription = socket.listen(
      onData,
      onError: (Object _, StackTrace _) => onEnd(),
      onDone: () {
        if (!_receivedClose.isCompleted) _receivedClose.complete();
        onEnd();
      },
    );
  }

  Future<void> close() => _closeFuture ??= _finishClose();

  Future<void> _finishClose() async {
    if (_subscription == null) listen((_) {});
    try {
      // WebSocket.close/done covers the sending side only. Also wait for the
      // receiving stream to finish before considering a cooperative peer closed.
      await Future.wait<dynamic>([
        socket.close(WebSocketStatus.goingAway, 'Viewer connection ended.'),
        _receivedClose.future,
      ]).timeout(DesktopBrowserViewer._closeTimeout);
    } catch (_) {
      // Normal for an abandoned browser tab or a broken upstream connection.
    }
    await DesktopBrowserViewer._settle(_subscription!.cancel());
  }
}
