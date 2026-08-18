import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/commands.dart';

void main() {
  test('compact is a one-tap slash command', () {
    expect(commandSendsImmediately('compact'), isTrue);
    final hits = filterCommands(defaultBotCommands, '/comp');
    expect(hits.any((c) => c.command == 'compact'), isTrue);
  });
}
