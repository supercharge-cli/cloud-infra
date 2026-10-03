import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:vectra_cloud/api/client.dart';

void main() {
  late VectraClient api;

  setUp(() {
    api = VectraClient(baseUrl: 'https://example.test', token: 'test-token');
  });

  Future<T> respond<T>(
    Object? body,
    Future<T> Function() action, {
    int status = 200,
  }) {
    return http.runWithClient(
      action,
      () => MockClient((_) async => http.Response(jsonEncode(body), status)),
    );
  }

  test(
    'manual control requests one ticket and preserves a valid WebSocket URL',
    () async {
      for (final url in [
        'wss://browser.example.test/vnc?ticket=opaque-token',
        'ws://127.0.0.1:6080/websockify',
      ]) {
        final requests = <http.Request>[];
        final result = await http.runWithClient(
          () => api.openAiBrowserVnc(
            'instance-1',
            handoffId: 'test-handoff-123456',
          ),
          () => MockClient((request) async {
            requests.add(request);
            return http.Response(jsonEncode({'wsUrl': url}), 200);
          }),
        );
        expect(result, url);
        expect(requests, hasLength(1));
        expect(requests.single.method, 'POST');
        expect(
          requests.single.url.path,
          '/api/instances/instance-1/computer/vnc-ticket',
        );
        expect(requests.single.headers['authorization'], 'Bearer test-token');
        expect(jsonDecode(requests.single.body), {
          'handoffId': 'test-handoff-123456',
        });
      }
    },
  );

  for (final invalid in <Object?>[
    null,
    '',
    42,
    '/computer/vnc',
    'https://example.test/viewer',
    'javascript:alert(1)',
    'wss:///missing-host',
    'wss://user:password@example.test/vnc',
    'wss://example.test/vnc#fragment',
    'wss://example.test/a b',
  ]) {
    test('rejects invalid VNC URL: $invalid', () async {
      await expectLater(
        respond(
          {'wsUrl': invalid},
          () => api.openAiBrowserVnc(
            'instance-1',
            handoffId: 'test-handoff-123456',
          ),
        ),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 502)),
      );
    });
  }

  test('Managed MCP catalog is read-only from the public source and install targets an owned bot route', () async {
    final requests = <http.Request>[];
    await http.runWithClient(() async {
      final catalog = await api.managedMcpCatalog();
      expect(catalog['plugins'], isA<List>());
      await api.botManagedMcp('instance-1', 'main', {
        'action': 'installCatalog',
        'catalogId': 'vectra-echo',
        'catalogSha256': 'a' * 64,
        'requestId': 'test-request-1234',
      });
    }, () => MockClient((request) async {
      requests.add(request);
      if (request.method == 'GET') {
        return http.Response(
          jsonEncode({'schemaVersion': 1, 'plugins': []}),
          200,
        );
      }
      return http.Response(jsonEncode({'plugin': {'id': 'vectra-echo'}}), 200);
    }));
    expect(requests.map((request) => request.method), ['GET', 'POST']);
    expect(
      requests.first.url.toString(),
      startsWith(
        'https://raw.githubusercontent.com/iotserver24/supercharge-app/',
      ),
    );
    expect(requests.first.url.path, endsWith('/public/managed-mcp/catalog.json'));
    expect(requests.first.headers.containsKey('authorization'), isFalse);
    expect(requests.last.url.path, '/api/instances/instance-1/bots/main/plugin-api');
    expect(requests.last.headers['authorization'], 'Bearer test-token');
    expect(jsonDecode(requests.last.body)['action'], 'installCatalog');
  });


  test(
    'discovery reads the authenticated web API separately from the immutable catalog',
    () async {
      final requests = <http.Request>[];
      final response = await http.runWithClient(
        () => api.managedMcpDiscovery(),
        () => MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({
              'discovery': {'plugins': []},
            }),
            200,
          );
        }),
      );
      expect(response['discovery'], {'plugins': []});
      expect(requests.single.method, 'GET');
      expect(
        requests.single.url.toString(),
        'https://example.test/api/managed-mcp/catalog',
      );
      expect(requests.single.headers['authorization'], 'Bearer test-token');
    },
  );

  test('computer status uses the authenticated read-only endpoint', () async {
    final result = await http.runWithClient(
      () => api.computerStatus('instance-1'),
      () => MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/instances/instance-1/computer/status');
        expect(request.headers['authorization'], 'Bearer test-token');
        return http.Response(jsonEncode({'handoff': false}), 200);
      }),
    );
    expect(result, {'handoff': false});
  });

  test(
    'start returns validated expiry without a second ticket request',
    () async {
      final expiry = DateTime.now()
          .add(const Duration(minutes: 10))
          .millisecondsSinceEpoch;
      final requests = <http.Request>[];
      final result = await http.runWithClient(
        () => api.startBrowserHandoff(
          'instance-1',
          handoffId: 'test-handoff-123456',
        ),
        () => MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({
              'ok': true,
              'handoff': true,
              'handoffId': 'test-handoff-123456',
              'expiresAt': expiry,
            }),
            200,
          );
        }),
      );
      expect(result.millisecondsSinceEpoch, expiry);
      expect(requests, hasLength(1));
      expect(requests.single.method, 'POST');
      expect(
        requests.single.url.path,
        '/api/instances/instance-1/computer/handoff',
      );
      expect(jsonDecode(requests.single.body), {
        'action': 'start',
        'handoffId': 'test-handoff-123456',
        'minutes': 10,
      });
    },
  );

  test('handoff duration is clamped to one through thirty minutes', () async {
    for (final requested in [-5, 1, 30, 99]) {
      await http.runWithClient(
        () => api.startBrowserHandoff(
          'instance-1',
          handoffId: 'test-handoff-123456',
          minutes: requested,
        ),
        () => MockClient((request) async {
          expect(jsonDecode(request.body), {
            'action': 'start',
            'handoffId': 'test-handoff-123456',
            'minutes': requested.clamp(1, 30),
          });
          return http.Response(
            jsonEncode({
              'ok': true,
              'handoff': true,
              'handoffId': 'test-handoff-123456',
              'expiresAt': DateTime.now()
                  .add(const Duration(minutes: 10))
                  .millisecondsSinceEpoch,
            }),
            200,
          );
        }),
      );
    }
  });

  test(
    'start rejects unconfirmed, missing, malformed, or expired responses',
    () async {
      final future = DateTime.now()
          .add(const Duration(minutes: 10))
          .millisecondsSinceEpoch;
      final invalid = <Object?>[
        null,
        [],
        {},
        {'ok': false, 'handoff': true, 'expiresAt': future},
        {'ok': 'true', 'handoff': true, 'expiresAt': future},
        {'ok': true, 'handoff': false, 'expiresAt': future},
        {'ok': true, 'handoff': 'true', 'expiresAt': future},
        {'ok': true, 'expiresAt': future},
        {'ok': true, 'handoff': true},
        {'ok': true, 'handoff': true, 'expiresAt': '$future'},
        {'ok': true, 'handoff': true, 'expiresAt': 0},
        {'ok': true, 'handoff': true, 'expiresAt': future - 3600000},
        {'ok': true, 'handoff': true, 'expiresAt': 1e30},
      ];
      for (final body in invalid) {
        await expectLater(
          respond(
            body,
            () => api.startBrowserHandoff(
              'instance-1',
              handoffId: 'test-handoff-123456',
            ),
          ),
          throwsA(isA<ApiException>().having((e) => e.status, 'status', 502)),
          reason: '$body',
        );
      }
    },
  );

  test(
    'start HTTP 404 is propagated and cannot fall back to a ticket',
    () async {
      var requests = 0;
      await expectLater(
        http.runWithClient(
          () => api.startBrowserHandoff(
            'instance-1',
            handoffId: 'test-handoff-123456',
          ),
          () => MockClient((request) async {
            requests += 1;
            expect(
              request.url.path,
              '/api/instances/instance-1/computer/handoff',
            );
            return http.Response(jsonEncode({'error': 'Not supported'}), 404);
          }),
        ),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 404)),
      );
      expect(requests, 1);
    },
  );

  test('release requires both ok true and handoff false', () async {
    await http.runWithClient(
      () => api.stopBrowserHandoff(
        'instance-1',
        handoffId: 'test-handoff-123456',
      ),
      () => MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/instances/instance-1/computer/handoff');
        expect(jsonDecode(request.body), {
          'action': 'stop',
          'handoffId': 'test-handoff-123456',
        });
        return http.Response(
          jsonEncode({
            'ok': true,
            'handoff': false,
            'handoffId': 'test-handoff-123456',
          }),
          200,
        );
      }),
    );
    for (final body in [
      {},
      {'ok': true},
      {'ok': false, 'handoff': false},
      {'ok': true, 'handoff': true},
      {'ok': true, 'handoff': 'false'},
    ]) {
      await expectLater(
        respond(
          body,
          () => api.stopBrowserHandoff(
            'instance-1',
            handoffId: 'test-handoff-123456',
          ),
        ),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 502)),
      );
    }
  });

  test(
    'foreground stop requires an explicit successful acknowledgement',
    () async {
      await http.runWithClient(
        () => api.stopChat('instance-1'),
        () => MockClient((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, '/api/instances/instance-1/chat/stop');
          expect(request.headers['authorization'], 'Bearer test-token');
          return http.Response(jsonEncode({'ok': true}), 200);
        }),
      );
      for (final body in [
        null,
        {},
        {'ok': false},
        {'ok': 'true'},
      ]) {
        await expectLater(
          respond(body, () => api.stopChat('instance-1')),
          throwsA(isA<ApiException>().having((e) => e.status, 'status', 502)),
        );
      }
    },
  );

  test('stop and release propagate server errors', () async {
    for (final action in <Future<void> Function()>[
      () => api.stopChat('instance-1'),
      () => api.stopBrowserHandoff(
        'instance-1',
        handoffId: 'test-handoff-123456',
      ),
    ]) {
      await expectLater(
        respond({'error': 'Unavailable'}, action, status: 503),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 503)),
      );
    }
  });
}
