import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:vectra_cloud/api/models.dart';
import 'package:vectra_cloud/chat/chat_store.dart';
import 'package:vectra_cloud/chat/bot_profile.dart';

class _Paths extends PathProviderPlatform {
  _Paths(this.root);
  final String root;
  @override
  Future<String?> getApplicationDocumentsPath() async => root;
}

ConversationMeta conversation(String id, String bot) => ConversationMeta(
  sessionId: id,
  botId: bot,
  title: id,
  createdAt: 1,
  updatedAt: 1,
);
AppChatEvent message(String text) =>
    AppChatEvent({'type': 'user', 'text': text, 'id': text});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory root;
  late PathProviderPlatform previous;
  setUp(() {
    root = Directory.systemTemp.createTempSync('vectra-bot-state-');
    previous = PathProviderPlatform.instance;
    PathProviderPlatform.instance = _Paths(root.path);
  });
  tearDown(() {
    PathProviderPlatform.instance = previous;
    root.deleteSync(recursive: true);
  });

  test('legacy conversations belong to Main', () {
    expect(ConversationMeta.fromJson({'sessionId': 'old'}).botId, 'main');
  });

  test('profile picture reference cannot become an arbitrary avatar URL', () {
    BotProfile profile(String icon) => BotProfile.fromJson({
      'id': 'a', 'name': 'A', 'icon': icon, 'instructions': '',
      'defaultFolder': '/home/user/workspace/bots/a', 'revision': 1,
    });
    expect(profile('avatar:12345678-1234-4123-8123-123456789abc').avatarVersion,
        '12345678-1234-4123-8123-123456789abc');
    expect(profile('avatar:../../instance').avatarVersion, isNull);
    expect(profile('🤖').isImage, false);
  });

  test(
    'remote catalogue refresh never switches the selected bot chat',
    () async {
      final store = ChatStore('instance');
      await store.mergeRemote([conversation('a', 'alpha')], active: 'a');
      await store.mergeRemote(
        [conversation('b', 'beta')],
        active: 'b',
        selectActive: false,
      );
      expect(store.activeSessionId, 'a');
      expect(store.conversations.map((c) => c.botId).toSet(), {
        'alpha',
        'beta',
      });
      final reloaded = ChatStore('instance');
      await reloaded.load();
      expect(reloaded.activeSessionId, 'a');
    },
  );

  test(
    'new bot chat cannot borrow another bots last cached transcript',
    () async {
      final store = ChatStore('instance');
      await store.mergeRemote([
        conversation('a', 'alpha'),
        conversation('b', 'beta'),
      ], active: 'a');
      await store.save(
        events: [message('alpha only')],
        answered: {},
        lastServerId: '12',
      );
      expect(
        (await store.load(sessionId: 'b', fallbackToLegacy: false)).events,
        isEmpty,
      );
      expect((await store.load(sessionId: 'b')).events, isEmpty);
      expect(
        (await store.load(sessionId: 'a')).events.single.text,
        'alpha only',
      );
    },
  );

  test(
    'bot selection persists independently and cache cursors do not cross',
    () async {
      final store = ChatStore('instance');
      await store.mergeRemote([
        conversation('a', 'alpha'),
        conversation('b', 'beta'),
      ], active: 'a');
      await store.save(
        events: [message('alpha')],
        answered: {},
        lastServerId: '10',
      );
      await store.selectConversation('b');
      await store.save(
        events: [message('beta')],
        answered: {},
        lastServerId: '20',
      );
      final reloaded = ChatStore('instance');
      final latest = await reloaded.load();
      expect(reloaded.activeSessionId, 'b');
      expect(latest.events.single.text, 'beta');
      expect(
        (await reloaded.load(
          sessionId: 'a',
          fallbackToLegacy: false,
        )).lastServerId,
        '10',
      );
    },
  );
}
