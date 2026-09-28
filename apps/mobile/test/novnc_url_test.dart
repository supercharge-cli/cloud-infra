import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/novnc_url.dart';

void main() {
  test('E2B URL encodes WebSocket path and defaults to view only', () {
    final url = e2bNoVncUrl('sandbox-123');
    expect(url.host, '6080-sandbox-123.e2b.app');
    expect(url.path, '/vnc.html');
    expect(url.hasQuery, isFalse);
    final settings = Uri.splitQueryString(url.fragment);
    expect(settings['path'], 'wss://6080-sandbox-123.e2b.app/websockify');
    expect(settings['view_only'], '1');
    expect(settings['autoconnect'], '1');
    expect(settings['resize'], 'scale');
    expect(settings['reconnect_delay'], '2000');
  });

  test('only explicit takeover asks for interactive mode', () {
    final watching = e2bNoVncUrl('sandbox', domain: 'e2b.dev');
    final controlling = e2bNoVncUrl('sandbox', domain: 'e2b.dev', controlling: true);
    expect(Uri.splitQueryString(watching.fragment)['view_only'], '1');
    expect(Uri.splitQueryString(controlling.fragment)['view_only'], '0');
    expect(controlling.host, watching.host);
    expect(() => e2bNoVncUrl('sandbox/elsewhere'), throwsFormatException);
    expect(() => e2bNoVncUrl('sandbox', domain: 'evil.example'), throwsFormatException);
  });
}
