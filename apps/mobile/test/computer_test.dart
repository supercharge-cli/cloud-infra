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
    expect(computerTabForEvent(ev({
      'type': 'computer',
      'tab': 'terminal',
      'kind': 'shell',
    })), isNull);
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

  test('browser click does not steal the tab', () {
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
    expect(s.tab, 'terminal');
    expect(s.browserLabel, 'Click @e2');
    expect(s.lines.single.command, 'agent-browser click @e2');
    expect(s.lines.single.running, isTrue);
    expect(computerTabForEvent(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'browser',
    })), isNull);
  });

  test('explicit Computer: browser focuses the pane', () {
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
    s.apply(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'focus',
      'focus': true,
      'action': 'show',
      'label': 'Show browser',
    }));
    expect(s.tab, 'browser');
    expect(parseComputerShow('Computer: terminal\nnext'), 'terminal');
    expect(parseComputerShow('Watch: browser'), 'browser');
    expect(parseComputerShow('I will use the browser'), isNull);
    expect(computerTabForEvent(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'focus',
      'focus': true,
    })), 'browser');
  });

  test('open focuses browser; later shell stays there', () {
    final s = ComputerState();
    s.apply(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'browser',
      'action': 'open',
      'focus': true,
      'state': 'start',
      'label': 'Open example.com',
    }));
    expect(s.tab, 'browser');
    s.apply(ev({
      'type': 'computer',
      'tab': 'terminal',
      'kind': 'shell',
      'state': 'start',
      'command': 'ls',
      'label': 'ls',
    }));
    expect(s.tab, 'browser');
    expect(s.lines.single.command, 'ls');
  });

  test('live jpeg does not steal the tab', () {
    final s = ComputerState();
    s.setLiveFrame(Uint8List.fromList([1, 2, 3]));
    expect(s.tab, 'terminal');
    expect(s.live, isTrue);
    expect(s.livePaused, isFalse);
    expect(s.liveJpeg, isNotNull);
    s.markLivePaused();
    expect(s.livePaused, isTrue);
  });

  test('status labels follow the focused tab', () {
    final s = ComputerState();
    expect(s.usingLabel, 'Vectra is using Terminal');
    expect(s.usingDetail, 'Waiting for commands');
    s.apply(ev({
      'type': 'computer',
      'tab': 'terminal',
      'kind': 'shell',
      'state': 'start',
      'command': 'ls -la',
      'label': 'ls -la',
    }));
    expect(s.usingDetail, 'Executing command: ls -la');
    s.apply(ev({
      'type': 'computer',
      'tab': 'browser',
      'kind': 'focus',
      'focus': true,
      'action': 'show',
      'url': 'https://example.com',
      'label': 'Open example.com',
    }));
    expect(s.usingLabel, 'Vectra is using Browser');
    expect(s.usingDetail, 'https://example.com');
    s.dispose();
  });

  test('image file becomes browser still without switching', () {
    final s = ComputerState();
    s.setStill(path: '/tmp/shot.png', url: 'https://example/shot.png');
    expect(s.tab, 'terminal');
    expect(s.stillPath, '/tmp/shot.png');
    expect(computerTabForEvent(ev({
      'type': 'file',
      'name': 'shot.png',
      'kind': 'photo',
    })), isNull);
  });
}
