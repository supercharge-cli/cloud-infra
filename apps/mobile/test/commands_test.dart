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

  test('/new does not lock the composer as an agent turn', () {
    expect(commandStartsAgentTurn('new'), isFalse);
    expect(commandStartsAgentTurn('reset'), isFalse);
    expect(commandStartsAgentTurn('clear'), isFalse);
    expect(commandStartsAgentTurn('history'), isFalse);
    expect(commandStartsAgentTurn('compact'), isTrue);
    expect(isNewLaneCommand('/new'), isTrue);
    expect(isNewLaneCommand('/reset'), isTrue);
    expect(isNewLaneCommand('hello'), isFalse);
    expect(slashCommandName('/new'), 'new');
    expect(slashCommandName('/history open abc'), 'history');
  });
}
