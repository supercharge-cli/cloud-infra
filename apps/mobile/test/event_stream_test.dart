import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/event_stream.dart';
import 'package:vectra_cloud/widgets/background_tasks.dart';

void main() {
  test('cursor ignores synthetic ready IDs and never moves backwards', () {
    expect(nextEventCursor('123', 'ready'), '123');
    expect(nextEventCursor('123', 0), '123');
    expect(nextEventCursor('123', '122'), '123');
    expect(nextEventCursor('123', '124'), '124');
    expect(nextEventCursor(null, 1789781635828122), '1789781635828122');
  });

  test('SSE accepts chunked CRLF, comments, and data without a space', () async {
    final input = utf8.encode(': ping\r\n\r\ndata:{"id":4,\r\ndata: "type":"done"}\r\n\r\ndata: broken\n\ndata: {"id":5,"type":"status","busy":false}\n\n');
    final stream = Stream<List<int>>.fromIterable(input.map((byte) => [byte]));
    final events = await decodeEventStream(stream).toList();
    expect(events.map((event) => event['id']).toList(), [4, 5]);
    expect(events.last['busy'], false);
  });

  test('cancellation closes a connection once, including a late registration', () {
    final cancellation = EventStreamCancellation();
    var calls = 0;
    cancellation.onCancel(() => calls++);
    cancellation.cancel();
    cancellation.cancel();
    expect(calls, 1);
    cancellation.onCancel(() => calls++);
    expect(calls, 2);
  });

  testWidgets('background activity is visible without marking the foreground busy', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: BackgroundTasksBar(tasks: [
      {'taskId': 'one', 'title': 'Next.js preview', 'command': 'npm run dev'},
    ]))));
    expect(find.text('1 background task running'), findsOneWidget);
    expect(find.text('Running in E2B · you can keep chatting'), findsOneWidget);
    await tester.tap(find.text('1 background task running'));
    await tester.pumpAndSettle();
    expect(find.text('npm run dev'), findsOneWidget);
  });
}
