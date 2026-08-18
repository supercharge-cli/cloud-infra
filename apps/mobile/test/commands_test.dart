import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/chat/commands.dart';

void main() {
  test('compact is a one-tap slash command', () {
    expect(commandSendsImmediately('compact'), isTrue);
    final hits = filterCommands(defaultBotCommands, '/comp');
    expect(hits.any((c) => c.command == 'compact'), isTrue);
  });

  test('new and history are first-class conversation commands', () {
    expect(commandSendsImmediately('new'), isTrue);
    expect(commandSendsImmediately('history'), isTrue);
    final news = filterCommands(defaultBotCommands, '/new');
    expect(news.any((c) => c.command == 'new'), isTrue);
    expect(news.first.description.toLowerCase(), contains('history'));
    final hist = filterCommands(defaultBotCommands, '/hist');
    expect(hist.any((c) => c.command == 'history'), isTrue);
  });
}
