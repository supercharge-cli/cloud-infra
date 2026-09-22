import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/browser_viewer_document.dart';

void main() {
  const module = "const ne=class RFB{};export{ne as default};";

  test('mobile embeds the packaged noVNC module and visible status UI', () {
    final html = browserViewerDocument(
      desktop: false,
      viewerModule: module,
      wsUrl: 'wss://browser.example.test/vnc?ticket=secret',
      generation: 3,
    );

    expect(html, contains('window.SuperchargeNoVNC={RFB:ne};'));
    expect(html, isNot(contains('export{ne as default};')));
    expect(html, isNot(contains('data:text/javascript')));
    expect(html, contains('Connecting to the AI browser'));
    expect(html, contains('Could not connect to the AI browser'));
    expect(html, contains("if(!wasConnected)notify('suspended')"));
    expect(html, contains('"generation":3'));
  });

  test(
    'desktop imports the loopback-served module and exposes handoff controls',
    () {
      final html = browserViewerDocument(desktop: true);

      expect(html, contains('import RFB from "./rfb.mjs";'));
      expect(html, contains('Take control'));
      expect(html, contains('Done &amp; continue'));
      expect(
        html,
        contains("state.canContinue?'Done & continue':'Return control'"),
      );
      expect(html, contains("fetch('state'"));
      expect(html, contains("fetch('action'"));
    },
  );

  test('mobile rejects an incompatible or script-breaking noVNC asset', () {
    expect(
      () => browserViewerDocument(
        desktop: false,
        viewerModule: 'export default class RFB {}',
        wsUrl: 'wss://browser.example.test/vnc',
      ),
      throwsStateError,
    );
    expect(
      () => browserViewerDocument(
        desktop: false,
        viewerModule: 'const x="</script>";export{ne as default};',
        wsUrl: 'wss://browser.example.test/vnc',
      ),
      throwsStateError,
    );
  });
}
