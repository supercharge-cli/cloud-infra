import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:vectra_cloud/chat/desktop_browser_viewer.dart';

class _EchoVncServer {
  _EchoVncServer(this.server) {
    subscription = server.listen((request) async {
      if (!WebSocketTransformer.isUpgradeRequest(request)) {
        request.response.statusCode = HttpStatus.upgradeRequired;
        await request.response.close();
        return;
      }
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      connections += 1;
      socket.listen(
        socket.add,
        onDone: () => sockets.remove(socket),
        onError: (_) => sockets.remove(socket),
      );
    });
  }

  static Future<_EchoVncServer> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return _EchoVncServer(server);
  }

  final HttpServer server;
  late final StreamSubscription<HttpRequest> subscription;
  final Set<WebSocket> sockets = {};
  int connections = 0;

  String get wsUrl => 'ws://${server.address.address}:${server.port}/vnc';

  Future<void> close() async {
    for (final socket in sockets.toList()) {
      await socket.close();
    }
    await server.close(force: true);
    await subscription.cancel();
  }
}

Future<DesktopBrowserViewer> _startViewer({
  required Future<String> Function() requestVncUrl,
  Map<String, Object?>? state,
  Future<void> Function(String action, String notes)? onAction,
  void Function(bool connected)? onConnectionChanged,
}) {
  return DesktopBrowserViewer.start(
    html: '<!doctype html><title>viewer fixture</title>',
    viewerModule: 'export default class RFB {}',
    requestVncUrl: requestVncUrl,
    readState: () =>
        state ??
        <String, Object?>{
          'phase': 'watching',
          'hasControl': false,
          'busy': false,
          'error': null,
          'expiresAt': null,
        },
    onAction: onAction ?? (_, _) async {},
    onConnectionChanged: onConnectionChanged,
  );
}

Uri _route(DesktopBrowserViewer viewer, String route) =>
    viewer.url.resolve(route);

Uri _socketRoute(DesktopBrowserViewer viewer, {int generation = 0}) =>
    _route(viewer, 'vnc?generation=$generation').replace(scheme: 'ws');

Future<WebSocket> _connectViewer(
  DesktopBrowserViewer viewer, {
  int generation = 0,
  String? origin,
}) {
  return WebSocket.connect(
    _socketRoute(viewer, generation: generation).toString(),
    headers: {'Origin': origin ?? viewer.url.origin},
    compression: CompressionOptions.compressionOff,
  );
}

void main() {
  test('normalizes implicit WebSocket ports before the HTTP handshake', () {
    final secure = normalizedBrowserWebSocket('wss://sandbox.example/vnc?ticket=fixture')!;
    expect(secure.port, 443);
    expect(secure.hasPort, isTrue);
    expect(normalizedBrowserWebSocket('ws://sandbox.example/vnc')!.port, 80);
    expect(normalizedBrowserWebSocket('wss://sandbox.example:8443/vnc')!.port, 8443);
    expect(normalizedBrowserWebSocket('wss://sandbox.example:0/vnc'), isNull);
    expect(normalizedBrowserWebSocket('wss://user:password@sandbox.example/vnc'), isNull);
  });

  test(
    'serves capability-scoped viewer, module, and state without CORS',
    () async {
      final viewer = await _startViewer(
        requestVncUrl: () async => 'ws://unused',
      );
      addTearDown(viewer.close);

      expect(viewer.url.host, InternetAddress.loopbackIPv4.address);
      expect(
        viewer.url.pathSegments.where((part) => part.isNotEmpty).single.length,
        greaterThanOrEqualTo(40),
      );

      final page = await http.get(viewer.url);
      expect(page.statusCode, HttpStatus.ok);
      expect(page.body, contains('viewer fixture'));
      expect(page.headers['cache-control'], 'no-store');
      expect(page.headers['access-control-allow-origin'], isNull);

      final module = await http.get(_route(viewer, 'rfb.mjs'));
      expect(module.statusCode, HttpStatus.ok);
      expect(module.body, 'export default class RFB {}');
      expect(module.headers['content-type'], contains('text/javascript'));

      final state = await http.get(_route(viewer, 'state'));
      expect(state.statusCode, HttpStatus.ok);
      expect(jsonDecode(state.body), containsPair('generation', 0));

      final wrongCapability = viewer.url.replace(path: '/wrong/');
      expect((await http.get(wrongCapability)).statusCode, HttpStatus.notFound);
    },
  );

  test('rejects state-changing requests without the exact origin', () async {
    final calls = <String>[];
    final viewer = await _startViewer(
      requestVncUrl: () async => 'ws://unused',
      onAction: (action, _) async => calls.add(action),
    );
    addTearDown(viewer.close);

    final actionUrl = _route(viewer, 'action');
    final missing = await http.post(
      actionUrl,
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'action': 'takeControl'}),
    );
    expect(missing.statusCode, HttpStatus.forbidden);

    final wrong = await http.post(
      actionUrl,
      headers: {
        'content-type': 'application/json',
        'origin': 'https://attacker.invalid',
      },
      body: jsonEncode({'action': 'takeControl'}),
    );
    expect(wrong.statusCode, HttpStatus.forbidden);

    final valid = await http.post(
      actionUrl,
      headers: {
        'content-type': 'application/json',
        'origin': viewer.url.origin,
      },
      body: jsonEncode({'action': 'takeControl', 'notes': 'manual login'}),
    );
    expect(valid.statusCode, HttpStatus.ok);
    expect(calls, ['takeControl']);
  });

  test(
    'forwards text and binary frames and gets a fresh URL per connection',
    () async {
      final upstream = await _EchoVncServer.start();
      addTearDown(upstream.close);
      var tickets = 0;
      final connected = <bool>[];
      final viewer = await _startViewer(
        requestVncUrl: () async {
          tickets += 1;
          return upstream.wsUrl;
        },
        onConnectionChanged: connected.add,
      );
      addTearDown(viewer.close);

      final socket = await _connectViewer(viewer);
      final events = <dynamic>[];
      final received = Completer<void>();
      socket.listen((message) {
        events.add(message);
        if (events.length == 2 && !received.isCompleted) received.complete();
      });
      socket.add('hello');
      socket.add(<int>[1, 2, 3]);
      await received.future.timeout(const Duration(seconds: 3));

      expect(events.first, 'hello');
      expect(events.last, <int>[1, 2, 3]);
      expect(tickets, 1);
      expect(upstream.connections, 1);
      expect(connected, contains(true));

      await socket.close();
      final second = await _connectViewer(viewer);
      expect(tickets, 2);
      await second.close();
    },
  );

  test(
    'suspend closes both sides and invalidates the old generation',
    () async {
      final upstream = await _EchoVncServer.start();
      addTearDown(upstream.close);
      final viewer = await _startViewer(
        requestVncUrl: () async => upstream.wsUrl,
      );
      addTearDown(viewer.close);

      final socket = await _connectViewer(viewer);
      final clientClosed = Completer<void>();
      socket.listen(
        (_) {},
        onDone: clientClosed.complete,
        onError: (_) => clientClosed.complete(),
      );
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(upstream.sockets, isNotEmpty);

      await viewer.suspend();
      await clientClosed.future.timeout(const Duration(seconds: 3));
      await Future<void>.delayed(const Duration(milliseconds: 30));
      expect(upstream.sockets, isEmpty);
      expect(socket.readyState, isNot(WebSocket.open));

      await expectLater(
        _connectViewer(viewer),
        throwsA(isA<WebSocketException>()),
      );
      final fresh = await _connectViewer(viewer, generation: 1);
      await fresh.close();
    },
  );

  test(
    'denies bad origins, unsafe upstream targets, busy and expired states',
    () async {
      final upstream = await _EchoVncServer.start();
      addTearDown(upstream.close);

      final wrongOrigin = await _startViewer(
        requestVncUrl: () async => upstream.wsUrl,
      );
      addTearDown(wrongOrigin.close);
      await expectLater(
        _connectViewer(wrongOrigin, origin: 'https://attacker.invalid'),
        throwsA(isA<WebSocketException>()),
      );

      final unsafe = await _startViewer(
        requestVncUrl: () async => 'https://example.invalid/not-a-websocket',
      );
      addTearDown(unsafe.close);
      await expectLater(
        _connectViewer(unsafe),
        throwsA(isA<WebSocketException>()),
      );

      final busy = await _startViewer(
        requestVncUrl: () async => upstream.wsUrl,
        state: {
          'phase': 'watching',
          'hasControl': false,
          'busy': true,
          'error': null,
          'expiresAt': null,
        },
      );
      addTearDown(busy.close);
      await expectLater(
        _connectViewer(busy),
        throwsA(isA<WebSocketException>()),
      );

      final expired = await _startViewer(
        requestVncUrl: () async => upstream.wsUrl,
        state: {
          'phase': 'controlling',
          'hasControl': true,
          'busy': false,
          'error': null,
          'expiresAt': DateTime.now()
              .subtract(const Duration(seconds: 1))
              .millisecondsSinceEpoch,
        },
      );
      addTearDown(expired.close);
      await expectLater(
        _connectViewer(expired),
        throwsA(isA<WebSocketException>()),
      );
    },
  );

  test(
    'close cancels a pending ticket request and rejects later connections',
    () async {
      final target = Completer<String>();
      final viewer = await _startViewer(requestVncUrl: () => target.future);

      final pending = _connectViewer(viewer);
      await Future<void>.delayed(const Duration(milliseconds: 30));
      await viewer.close();
      target.complete('ws://127.0.0.1:9/unreachable');

      await expectLater(
        pending,
        throwsA(anyOf(isA<WebSocketException>(), isA<HttpException>())),
      );
      await expectLater(
        http.get(_route(viewer, 'state')),
        throwsA(isA<http.ClientException>()),
      );
    },
  );
}
