import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:vectra_cloud/api/models.dart';
import 'package:vectra_cloud/chat/chat_store.dart';

class _TestPaths extends PathProviderPlatform {
  _TestPaths(this.documentsPath);

  String documentsPath;

  @override
  Future<String?> getApplicationDocumentsPath() async => documentsPath;
}

AppChatEvent _message(String text) => AppChatEvent({
  'id': text,
  'type': 'user',
  'text': text,
  'ts': DateTime.now().millisecondsSinceEpoch,
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory documents;
  late _TestPaths paths;
  late PathProviderPlatform previousPaths;

  setUp(() {
    previousPaths = PathProviderPlatform.instance;
    documents = Directory.systemTemp.createTempSync('vectra-chat-store-test-');
    paths = _TestPaths(documents.path);
    PathProviderPlatform.instance = paths;
  });

  tearDown(() {
    PathProviderPlatform.instance = previousPaths;
    documents.deleteSync(recursive: true);
  });

  test(
    'overlapping saves from one store preserve the latest complete snapshot',
    () async {
      final store = ChatStore('sandbox');
      store.activeSessionId = 'owner';
      final writes = <Future<void>>[];
      for (var i = 0; i < 40; i++) {
        writes.add(
          store.save(
            events: [_message('message-$i')],
            answered: {'answer-$i'},
            lastServerId: '$i',
          ),
        );
      }
      await Future.wait(writes);

      final directory = await store.root();
      final latest =
          jsonDecode(await File('${directory.path}/events.json').readAsString())
              as Map<String, dynamic>;
      final bySession =
          jsonDecode(
                await File(
                  '${directory.path}/events-owner.json',
                ).readAsString(),
              )
              as Map<String, dynamic>;
      expect(latest, bySession);
      expect(latest['lastServerId'], '39');
      expect(latest['answered'], ['answer-39']);
      expect((latest['events'] as List).single['text'], 'message-39');
      expect(
        (await directory.list().toList()).where(
          (entry) => entry.path.contains('.tmp-'),
        ),
        isEmpty,
      );
    },
  );

  test(
    'different running app stores cannot steal each other’s temporary files',
    () async {
      final first = ChatStore('shared-sandbox')..activeSessionId = 'owner';
      final second = ChatStore('shared-sandbox')..activeSessionId = 'owner';
      final writes = <Future<void>>[];
      for (var i = 0; i < 20; i++) {
        writes.add(first.save(events: [_message('first-$i')], answered: {}));
        writes.add(second.save(events: [_message('second-$i')], answered: {}));
      }
      await Future.wait(writes);

      final directory = await first.root();
      for (final name in ['events.json', 'events-owner.json']) {
        final raw = await File('${directory.path}/$name').readAsString();
        final events =
            (jsonDecode(raw) as Map<String, dynamic>)['events'] as List;
        expect(events, hasLength(1));
        expect(
          '${events.single['text']}',
          matches(RegExp(r'^(first|second)-\d+$')),
        );
      }
      expect(
        (await directory.list().toList()).where(
          (entry) => entry.path.contains('.tmp-'),
        ),
        isEmpty,
      );
    },
  );

  test('overlapping index and event saves do not lose metadata', () async {
    final store = ChatStore('indexed');
    final conversation = ConversationMeta(
      sessionId: 'owner',
      title: 'New conversation',
      createdAt: 1,
      updatedAt: 1,
    );
    await store.mergeRemote([conversation], active: 'owner');
    final writes = <Future<void>>[];
    for (var i = 0; i < 12; i++) {
      writes.add(store.mergeRemote([conversation], active: 'owner'));
      writes.add(store.save(events: [_message('turn-$i')], answered: {}));
    }
    await Future.wait(writes);

    final directory = await store.root();
    final index =
        jsonDecode(
              await File('${directory.path}/conversations.json').readAsString(),
            )
            as Map<String, dynamic>;
    expect(index['activeSessionId'], 'owner');
    expect(index['conversations'], hasLength(1));
    expect((index['conversations'] as List).single['sessionId'], 'owner');
    expect(
      jsonDecode(
        await File('${directory.path}/events-owner.json').readAsString(),
      ),
      isA<Map>(),
    );
  });

  test(
    'a failed save reports its error and leaves later saves usable',
    () async {
      final obstacle = File('${documents.path}/not-a-directory');
      await obstacle.writeAsString('do not overwrite');
      paths.documentsPath = obstacle.path;
      final store = ChatStore('sandbox');
      await expectLater(
        store.save(events: [_message('first')], answered: {}),
        throwsA(isA<FileSystemException>()),
      );
      expect(await obstacle.readAsString(), 'do not overwrite');

      paths.documentsPath = documents.path;
      await store.save(events: [_message('recovered')], answered: {});
      final loaded = await store.load();
      expect(loaded.events.single.text, 'recovered');
    },
  );

  test(
    'a debounced write failure is handled rather than escaping its timer',
    () async {
      final obstacle = File('${documents.path}/not-a-directory');
      await obstacle.writeAsString('do not overwrite');
      paths.documentsPath = obstacle.path;
      final errors = <Object>[];
      final store = ChatStore(
        'sandbox',
        onWriteError: (error, _) => errors.add(error),
      );
      store.scheduleSave(events: [_message('first')], answered: {});
      await Future<void>.delayed(const Duration(milliseconds: 500));
      expect(errors, hasLength(1));
      expect(errors.single, isA<FileSystemException>());
      expect(await obstacle.readAsString(), 'do not overwrite');
    },
  );
}
