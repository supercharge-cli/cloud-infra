import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/roster.dart';

void main() {
  test('unread bots sort ahead of a working bot', () {
    expect(
      rosterRank(unread: true, working: true, queued: false),
      lessThan(rosterRank(unread: false, working: true, queued: false)),
    );
    expect(
      rosterRank(unread: false, working: true, queued: false),
      lessThan(rosterRank(unread: false, working: false, queued: true)),
    );
  });

  test('a live bot keeps its last line', () {
    expect(
      rosterPreview(working: true, queued: false, preview: 'Editing main.dart'),
      'Working · Editing main.dart',
    );
    expect(
      rosterPreview(working: false, queued: false, preview: 'Your main assistant'),
      'Your main assistant',
    );
  });
}
