import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/api/models.dart';
import 'package:vectra_cloud/chat/computer.dart';

AppChatEvent ev(Map<String, dynamic> raw) => AppChatEvent(raw);

void main() {
  test('shell events stay on terminal', () {
    final s = ComputerState();
    s.apply(ev({
      'type': 'computer',
      'tab': 'terminal',
      'kind': 'shell',
      'state': 'start',
      'command': 'ls',
      'label': 'ls',
    }));
    expect(s.tab, 'terminal');
    expect(computerTabForEvent(s.lines.isEmpty
        ? ev({'type': 'computer', 'tab': 'terminal', 'kind': 'shell'})
        : ev({'type': 'computer', 'tab': 'terminal', 'kind': 'shell'})), 'terminal');
    expect(s.lines.single.command, 'ls');
    expect(s.lines.single.running, isTrue);

    s.apply(ev({
      'type': 'computer',
      'tab': 'terminal',
      'kind': 'shell',
      'state': 'done',
      'command': 'ls',
      'stdout': 'a.txt',
      'exitCode': 0,
      'success': true,
      'label': 'ls',
    }));
    expect(s.lines.single.running, isFalse);
    expect(s.lines.single.stdout, 'a.txt');
    expect(s.peekLabel, 'ls');
  });

  test('browser click switches tab', () {
    final s = ComputerState();
    s.apply(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'browser',
      'state': 'start',
      'command': 'agent-browser click @e2',
      'action': 'click',
      'target': '@e2',
      'label': 'Click @e2',
    }));
    expect(s.tab, 'browser');
    expect(s.browserLabel, 'Click @e2');
    expect(computerTabForEvent(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'browser',
    })), 'browser');
  });

  test('live jpeg becomes the browser view', () {
    final s = ComputerState();
    s.setLiveFrame(Uint8List.fromList([1, 2, 3]));
    expect(s.tab, 'browser');
    expect(s.live, isTrue);
    expect(s.livePaused, isFalse);
    expect(s.liveJpeg, isNotNull);
    s.markLivePaused();
    expect(s.livePaused, isTrue);
  });

  test('image file becomes browser still', () {
    final s = ComputerState();
    s.setStill(path: '/tmp/shot.png', url: 'https://example/shot.png');
    expect(s.tab, 'browser');
    expect(s.stillPath, '/tmp/shot.png');
    expect(computerTabForEvent(ev({
      'type': 'file',
      'name': 'shot.png',
      'kind': 'photo',
    })), 'browser');
  });
}
