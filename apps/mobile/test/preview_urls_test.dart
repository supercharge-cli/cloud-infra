import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/preview_urls.dart';

void main() {
  test('builds e2b.app preview url', () {
    expect(
      buildPreviewUrl(sandboxId: 'iabc123', port: 3000),
      'https://3000-iabc123.e2b.app',
    );
  });

  test('extracts preview urls from markdown', () {
    const text = 'Open https://5173-iabc123.e2b.app and also https://3000-iabc123.e2b.dev/home';
    expect(extractPreviewUrls(text), [
      'https://5173-iabc123.e2b.app',
      'https://3000-iabc123.e2b.dev/home',
    ]);
  });

  test('rewrites localhost to public host', () {
    const text = 'Dev server at http://localhost:3000/app and http://127.0.0.1:5173';
    expect(
      rewriteLocalhostUrls(text, 'iabc123'),
      'Dev server at https://3000-iabc123.e2b.app/app and https://5173-iabc123.e2b.app',
    );
  });

  test('leaves localhost alone without sandbox id', () {
    expect(rewriteLocalhostUrls('http://localhost:3000', null), 'http://localhost:3000');
  });
}
