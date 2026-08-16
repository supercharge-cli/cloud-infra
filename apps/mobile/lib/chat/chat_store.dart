import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../api/models.dart';

class ChatSnapshot {
  ChatSnapshot({
    required this.events,
    this.answered = const {},
    this.lastServerId,
  });
  final List<AppChatEvent> events;
  final Set<String> answered;
  final String? lastServerId;
}

class ChatStore {
  ChatStore(this.instanceId);
  final String instanceId;

  Timer? _writeTimer;

  Future<Directory> root() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/chat/$instanceId');
    await dir.create(recursive: true);
    return dir;
  }

  Future<Directory> mediaDir() async {
    final dir = Directory('${(await root()).path}/media');
    await dir.create(recursive: true);
    return dir;
  }

  File _eventsFile(Directory root) => File('${root.path}/events.json');

  Future<ChatSnapshot> load() async {
    try {
      final file = _eventsFile(await root());
      if (!await file.exists()) return ChatSnapshot(events: []);
      final data = jsonDecode(await file.readAsString());
      if (data is! Map) return ChatSnapshot(events: []);
      final list = (data['events'] as List?) ?? const [];
      final events = list
          .whereType<Map>()
          .map((e) => AppChatEvent.fromJson(Map<String, dynamic>.from(e)))
          .where((e) => e.type != 'typing' && e.type != 'progress')
          .toList();
      final answered = ((data['answered'] as List?) ?? const [])
          .map((e) => '$e')
          .toSet();
      return ChatSnapshot(
        events: events,
        answered: answered,
        lastServerId: data['lastServerId'] as String?,
      );
    } catch (_) {
      return ChatSnapshot(events: []);
    }
  }

  void scheduleSave({
    required List<AppChatEvent> events,
    required Set<String> answered,
    String? lastServerId,
  }) {
    _writeTimer?.cancel();
    _writeTimer = Timer(const Duration(milliseconds: 280), () {
      unawaited(save(events: events, answered: answered, lastServerId: lastServerId));
    });
  }

  Future<void> save({
    required List<AppChatEvent> events,
    required Set<String> answered,
    String? lastServerId,
  }) async {
    final persistable = events.where((e) => e.type != 'typing' && e.type != 'progress').toList();
    final payload = {
      'version': 1,
      'lastServerId': ?lastServerId,
      'answered': answered.toList(),
      'events': persistable.map((e) => e.toJson()).toList(),
    };
    final file = _eventsFile(await root());
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode(payload));
    await tmp.rename(file.path);
  }

  Future<String> saveMedia({
    required String name,
    required List<int> bytes,
    String? id,
  }) async {
    final dir = await mediaDir();
    final safe = name.replaceAll(RegExp(r'[/\\]'), '_');
    final prefix = (id != null && id.isNotEmpty) ? '${id}_' : '${DateTime.now().millisecondsSinceEpoch}_';
    final path = '${dir.path}/$prefix$safe';
    await File(path).writeAsBytes(bytes, flush: true);
    return path;
  }

  Future<String?> existingMedia(String fileId, String? name) async {
    final dir = await mediaDir();
    if (!await dir.exists()) return null;
    await for (final entity in dir.list()) {
      if (entity is! File) continue;
      final base = entity.uri.pathSegments.last;
      if (base.startsWith('${fileId}_')) return entity.path;
      if (name != null && base.endsWith(name) && await entity.exists()) return entity.path;
    }
    return null;
  }
}