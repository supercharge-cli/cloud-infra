import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:vectra_cloud/api/client.dart';

void main() {
  final api = VectraClient(baseUrl: 'https://example.test');

  test('chat send preserves server error when code is numeric', () async {
    await http.runWithClient(
      () async {
        await expectLater(
          api.sendChat('instance-1', 'hello'),
          throwsA(
            isA<ApiException>()
                .having((e) => e.status, 'status', 429)
                .having((e) => e.message, 'message', 'Agent is busy')
                .having((e) => e.code, 'code', null),
          ),
        );
      },
      () => MockClient(
        (_) async => http.Response(
          jsonEncode({'error': 'Agent is busy', 'code': 429}),
          429,
        ),
      ),
    );
  });

  test(
    'chat event connection preserves server error when code is numeric',
    () async {
      await http.runWithClient(
        () async {
          await expectLater(
            api.events('instance-1').first,
            throwsA(
              isA<ApiException>()
                  .having((e) => e.status, 'status', 503)
                  .having((e) => e.message, 'message', 'Sandbox unavailable')
                  .having((e) => e.code, 'code', null),
            ),
          );
        },
        () => MockClient(
          (_) async => http.Response(
            jsonEncode({'error': 'Sandbox unavailable', 'code': 503}),
            503,
          ),
        ),
      );
    },
  );
}
