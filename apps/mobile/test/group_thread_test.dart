import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/chat/bot_profile.dart';
import 'package:vectra_cloud/chat/group_store.dart';
import 'package:vectra_cloud/chat/group_thread.dart';
import 'package:vectra_cloud/state/agents.dart';
import 'package:vectra_cloud/theme.dart';

const bots = [
  BotProfile(id: 'main', name: 'Main', icon: '🤖', instructions: '', defaultFolder: '/home/user/workspace', revision: 1),
  BotProfile(id: 'research', name: 'Research', icon: '🔎', instructions: '', defaultFolder: '/home/user/workspace/research', revision: 1),
];

class _Paths extends PathProviderPlatform {
  final root = Directory.systemTemp.createTempSync('vectra-group-tests');
  @override
  Future<String?> getApplicationDocumentsPath() async => root.path;
}

class _Client extends VectraClient {
  _Client() : super(baseUrl: 'https://fixture.invalid');
  final sent = <(String, String, List<String>)>[];
  final messages = <Map<String, dynamic>>[];
  bool fail = false;
  @override
  Future<Map<String, dynamic>> groupChat(String id) async => {
    'messages': messages,
    'activity': [{'botId': 'research', 'sessionId': 'group-research', 'state': 'working'}],
  };
  @override
  Future<Map<String, dynamic>> sendGroupMessage(String id, String text, String requestId, List<String> mentions) async {
    sent.add((requestId, text, mentions));
    if (fail) throw ApiException(502, 'Connection lost');
    messages.add({'id': requestId, 'text': text, 'senderBotId': null, 'createdAt': 1});
    return {'ok': true};
  }
}

Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await tester.pump(const Duration(milliseconds: 30));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    PathProviderPlatform.instance = _Paths();
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
  });
  tearDown(() { debugDefaultTargetPlatformOverride = null; });

  test('group cache separates account and sandbox identities', () async {
    final first = GroupStore('owner-one', 'sandbox');
    await first.save([{'id': 'one', 'text': 'one owner'}], 'draft');
    expect((await first.load())['draft'], 'draft');
    expect(await GroupStore('owner-two', 'sandbox').load(), isEmpty);
    expect(await GroupStore('owner-one', 'other-sandbox').load(), isEmpty);
  });

  testWidgets('group sends mention IDs and opens working agent exact thread', (tester) async {
    final client = _Client();
    final directory = AgentDirectory(() => client);
    final opened = <(String, String?)>[];
    await tester.pumpWidget(MaterialApp(theme: Vc.dark(desktop: true), home: Scaffold(body: GroupThread(
      api: client, instanceId: 'sandbox', accountId: 'owner', bots: bots, directory: directory,
      onOpenAgent: (bot, session) => opened.add((bot.id, session)),
    ))));
    await settle(tester);
    await tester.tap(find.text('Research · working'));
    expect(opened.single, ('research', 'group-research'));
    await tester.enterText(find.byKey(const ValueKey('group-composer')), '@Res');
    await tester.pump();
    await tester.tap(find.text('Research').last);
    await tester.pump();
    await tester.tap(find.byTooltip('Send group message'));
    await settle(tester);
    expect(client.sent.single.$2, '@Research');
    expect(client.sent.single.$3, ['research']);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    directory.dispose();
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('retry reuses request identity and does not create a second bubble', (tester) async {
    final client = _Client()..fail = true;
    final directory = AgentDirectory(() => client);
    await tester.pumpWidget(MaterialApp(theme: Vc.dark(), home: Scaffold(body: GroupThread(
      api: client, instanceId: 'sandbox', accountId: 'owner', bots: bots, directory: directory, onOpenAgent: (_, _) {},
    ))));
    await settle(tester);
    await tester.enterText(find.byKey(const ValueKey('group-composer')), 'Default to Main');
    await tester.pump();
    await tester.tap(find.byTooltip('Send group message'));
    await settle(tester);
    client.fail = false;
    await tester.tap(find.text('Retry'));
    await settle(tester);
    expect(client.sent, hasLength(2));
    expect(client.sent.first.$1, client.sent.last.$1);
    expect(client.sent.first.$3, isEmpty);
    expect(find.text('Default to Main'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    directory.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
}
