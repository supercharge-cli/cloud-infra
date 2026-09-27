import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/desktop/native.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('download names cannot escape the selected directory', () {
    expect(DesktopNative.fileName('../../report.txt'), 'report.txt');
    expect(DesktopNative.fileName(r'C:\tmp\report.pdf'), 'report.pdf');
    expect(DesktopNative.fileName('..'), 'download');
    expect(DesktopNative.fileName('hello\u0000.txt'), 'hello_.txt');
  });

  test(
    'inline browser allows web pages and scopes AI viewer to loopback',
    () async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(DesktopNative.channel, (call) async {
            calls.add(call);
            return null;
          });
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(DesktopNative.channel, null),
      );
      for (final url in [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'https:///missing',
        '',
      ]) {
        await expectLater(
          DesktopNative.inlineLoad(DesktopNative.previewSurface, url),
          throwsFormatException,
        );
      }
      for (final url in [
        'https://example.com/',
        'http://localhost:1234/',
        'http://127.0.0.1/',
      ]) {
        await expectLater(
          DesktopNative.inlineLoad(DesktopNative.viewerSurface, url),
          throwsFormatException,
        );
      }
      expect(calls, isEmpty);
      await DesktopNative.inlineLoad(
        DesktopNative.previewSurface,
        'https://example.com/page',
      );
      await DesktopNative.inlineShow(
        DesktopNative.previewSurface,
        const Rect.fromLTWH(10, 20, 600, 400),
        2,
      );
      await DesktopNative.inlineCommand(DesktopNative.previewSurface, 'back');
      await DesktopNative.inlineHide(DesktopNative.previewSurface);
      await DesktopNative.inlineDispose(DesktopNative.previewSurface);
      await DesktopNative.inlineLoad(
        DesktopNative.viewerSurface,
        'http://127.0.0.1:12345/capability/',
      );
      expect(calls.map((call) => call.method), [
        'inlineLoad',
        'inlineShow',
        'inlineCommand',
        'inlineHide',
        'inlineDispose',
        'inlineLoad',
      ]);
      expect(calls.last.arguments, {
        'id': 'ai-viewer',
        'url': 'http://127.0.0.1:12345/capability/',
      });
      expect(calls[1].arguments, {
        'id': 'preview',
        'x': 10.0,
        'y': 20.0,
        'width': 600.0,
        'height': 400.0,
        'pixelRatio': 2.0,
      });
    },
  );

  test('workspace export downloads bytes with authentication', () async {
    final api = VectraClient(
      baseUrl: 'https://example.test',
      token: 'fixture-token',
    );
    final archive = await http.runWithClient(
      () => api.exportWorkspace('workspace-1'),
      () => MockClient((request) async {
        expect(request.url.path, '/api/instances/workspace-1/workspace/export');
        expect(request.headers['authorization'], 'Bearer fixture-token');
        expect(request.headers['accept'], 'application/gzip');
        return http.Response.bytes(
          [31, 139, 8, 0],
          200,
          headers: {'content-type': 'application/gzip'},
        );
      }),
    );
    expect(archive.bytes, [31, 139, 8, 0]);
    expect(archive.name, 'workspace-workspace-1.tar.gz');
    expect(archive.mime, 'application/gzip');
  });

  test('workspace export does not save an API error as an archive', () async {
    final api = VectraClient(baseUrl: 'https://example.test');
    await expectLater(
      http.runWithClient(
        () => api.exportWorkspace('workspace-1'),
        () => MockClient((_) async => http.Response('Unauthorized', 401)),
      ),
      throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
    );
  });
}
