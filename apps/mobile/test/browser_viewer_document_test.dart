import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/browser_viewer_document.dart';

void main() {
  const module = 'const ne=class RFB{};export{ne as default};';

  test('control document keeps one compact toolbar and keyboard, without inline notes', () {
    final html = browserViewerDocument(desktop: true);
    expect(html, contains('import RFB from "./rfb.mjs";'));
    expect(html, isNot(contains('const RFB=RFB;')));
    expect(html, contains('<footer>'));
    expect(html, isNot(contains('<header')));
    expect(html, isNot(contains('id="notes"')));
    expect(html, contains('id="keyboard"'));
    expect(html, contains('aria-label="Open keyboard"'));
    expect(html, contains('Return control'));
    expect(html, contains("fetch('state'"));
    expect(html, contains("fetch('action'"));
    expect(html, contains("next.phase==='controlling'"));
    expect(html, contains('!actionPending'));
    expect(html, contains('!state.inputPaused'));
    expect(html, contains("settings.set('view_only',mayControl()?'0':'1')"));
  });

  test('mobile uses packaged noVNC and keeps expiry and connection-generation guards', () {
    final html = browserViewerDocument(desktop: false, viewerModule: module,
      wsUrl: 'wss://browser.example.test/vnc?ticket=fixture', controlling: true,
      generation: 3, expiresAt: 9999999999999);
    expect(html, contains('window.SuperchargeNoVNC={RFB:ne};'));
    expect(html, isNot(contains('export{ne as default};')));
    expect(html, contains('event.detail.reason'));
    expect(html, contains("if(!wasConnected)notify('suspended')"));
    expect(html, contains('"generation":3'));
    expect(html, contains('compositionstart'));
    expect(html, contains('compositionend'));
    expect(html, contains("input.addEventListener('input'"));
    expect(html, contains('rfb.sendKey(keysym,code)'));
    expect(html, contains('0x01000000+point'));
  });

  test('generated desktop and mobile JavaScript parses', () async {
    final directory = await Directory.systemTemp.createTemp('vectra-viewer-js-');
    addTearDown(() => directory.delete(recursive: true));
    for (final desktop in [true, false]) {
      final html = browserViewerDocument(desktop: desktop, viewerModule: module,
        wsUrl: 'wss://example.test', controlling: true);
      final script = html.split('<script type="module">').last.split('</script>').first;
      final file = File('${directory.path}/viewer-$desktop.mjs');
      await file.writeAsString(script);
      final result = await Process.run('node', ['--check', file.path]);
      expect(result.exitCode, 0, reason: '${result.stderr}');
    }
  });

  test('keyboard forwards text, composition and special keys only with control', () async {
    final directory = await Directory.systemTemp.createTemp('vectra-keyboard-js-');
    addTearDown(() => directory.delete(recursive: true));
    final html = browserViewerDocument(desktop: false, viewerModule: module,
      wsUrl: 'wss://example.test', controlling: true,
      expiresAt: DateTime.now().add(const Duration(minutes: 5)).millisecondsSinceEpoch);
    final script = html.split('<script type="module">').last.split('</script>').first;
    final file = File('${directory.path}/viewer.js');
    await file.writeAsString(script);
    final result = await Process.run('node', ['test/browser_keyboard_runtime.cjs', file.path]);
    expect(result.exitCode, 0, reason: '${result.stdout}\n${result.stderr}');
  });

  test('mobile rejects incompatible and script-breaking noVNC assets', () {
    for (final bad in ['export default class RFB {}', 'const x="</script>";export{ne as default};']) {
      expect(() => browserViewerDocument(desktop: false, viewerModule: bad, wsUrl: 'wss://example.test'), throwsStateError);
    }
  });
}
