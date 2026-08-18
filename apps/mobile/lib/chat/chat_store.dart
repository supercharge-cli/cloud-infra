import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../api/models.dart';

class ConversationMeta {
  ConversationMeta({
    required this.sessionId,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    this.status = 'active',
    this.parentSessionId,
  });

  final String sessionId;
  String title;
  final int createdAt;
  int updatedAt;
  String status;
  String? parentSessionId;

  factory ConversationMeta.fromJson(Map<String, dynamic> j) => ConversationMeta(
        sessionId: '${j['sessionId'] ?? ''}',
        title: '${j['title'] ?? 'Conversation'}',
        createdAt: (j['createdAt'] as num?)?.toInt() ?? 0,
        updatedAt: (j['updatedAt'] as num?)?.toInt() ?? 0,
        status: '${j['status'] ?? 'active'}',
        parentSessionId: j['parentSessionId'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'title': title,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
        'status': status,
        if (parentSessionId != null) 'parentSessionId': parentSessionId,
      };
}

class ChatSnapshot {
  ChatSnapshot({
    required this.events,
    this.answered = const {},
    this.lastServerId,
    this.sessionId,
  });
  final List<AppChatEvent> events;
  final Set<String> answered;
  final String? lastServerId;
  final String? sessionId;
}

class ChatStore {
  ChatStore(this.instanceId);
  final String instanceId;

  Timer? _writeTimer;
  String? activeSessionId;
  List<ConversationMeta> conversations = [];

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

  File _eventsFile(Directory root, [String? sessionId]) {
    if (sessionId != null && sessionId.isNotEmpty) {
      return File('${root.path}/events-$sessionId.json');
    }
    return File('${root.path}/events.json');
  }

  File _indexFile(Directory root) => File('${root.path}/conversations.json');

  Future<void> _loadIndex() async {
    try {
      final file = _indexFile(await root());
      if (!await file.exists()) return;
      final data = jsonDecode(await file.readAsString());
      if (data is! Map) return;
      activeSessionId = data['activeSessionId'] as String?;
      final list = (data['conversations'] as List?) ?? const [];
      conversations = list
          .whereType<Map>()
          .map((e) => ConversationMeta.fromJson(Map<String, dynamic>.from(e)))
          .where((c) => c.sessionId.isNotEmpty)
          .toList()
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    } catch (_) {}
  }

  Future<void> _saveIndex() async {
    final file = _indexFile(await root());
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode({
      'activeSessionId': activeSessionId,
      'conversations': conversations.map((c) => c.toJson()).toList(),
    }));
    await tmp.rename(file.path);
  }

  ChatSnapshot _decodeSnapshot(Object? data, {String? sessionId}) {
    if (data is! Map) return ChatSnapshot(events: [], sessionId: sessionId);
    final list = (data['events'] as List?) ?? const [];
    final events = list
        .whereType<Map>()
        .map((e) => AppChatEvent.fromJson(Map<String, dynamic>.from(e)))
        .where((e) => e.type != 'typing' && e.type != 'progress' && e.type != 'conversation')
        .toList();
    final answered = ((data['answered'] as List?) ?? const [])
        .map((e) => '$e')
        .toSet();
    return ChatSnapshot(
      events: events,
      answered: answered,
      lastServerId: data['lastServerId'] as String?,
      sessionId: sessionId ?? data['sessionId'] as String?,
    );
  }

  Future<ChatSnapshot> load({String? sessionId}) async {
    await _loadIndex();
    final id = sessionId ?? activeSessionId;
    try {
      final dir = await root();
      final keyed = id != null ? _eventsFile(dir, id) : null;
      final legacy = _eventsFile(dir);
      final file = (keyed != null && await keyed.exists())
          ? keyed
          : (await legacy.exists() ? legacy : null);
      if (file == null) return ChatSnapshot(events: [], sessionId: id);
      final data = jsonDecode(await file.readAsString());
      return _decodeSnapshot(data, sessionId: id);
    } catch (_) {
      return ChatSnapshot(events: [], sessionId: id);
    }
  }

  Future<void> mergeRemote(List<ConversationMeta> remote, {String? active}) async {
    await _loadIndex();
    final byId = {for (final c in conversations) c.sessionId: c};
    for (final c in remote) {
      if (c.sessionId.isEmpty) continue;
      final prev = byId[c.sessionId];
      if (prev == null) {
        byId[c.sessionId] = c;
      } else {
        prev.title = c.title.isNotEmpty ? c.title : prev.title;
        prev.status = c.status;
        prev.updatedAt = c.updatedAt > prev.updatedAt ? c.updatedAt : prev.updatedAt;
        prev.parentSessionId = c.parentSessionId ?? prev.parentSessionId;
      }
    }
    conversations = byId.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    if (active != null && active.isNotEmpty) activeSessionId = active;
    await _saveIndex();
  }

  Future<void> archiveAndStart({
    required String? previousSessionId,
    required String newSessionId,
    String? previousTitle,
    required List<AppChatEvent> currentEvents,
    required Set<String> answered,
    String? lastServerId,
  }) async {
    await _loadIndex();
    final now = DateTime.now().millisecondsSinceEpoch;
    if (previousSessionId != null && previousSessionId.isNotEmpty) {
      await save(
        events: currentEvents,
        answered: answered,
        lastServerId: lastServerId,
        sessionId: previousSessionId,
      );
      final existing = conversations.where((c) => c.sessionId == previousSessionId).toList();
      if (existing.isEmpty) {
        conversations.add(ConversationMeta(
          sessionId: previousSessionId,
          title: _titleFrom(currentEvents, previousTitle) ?? 'Previous conversation',
          createdAt: currentEvents.isEmpty ? now : currentEvents.first.ts,
          updatedAt: now,
          status: 'closed',
        ));
      } else {
        existing.first
          ..status = 'closed'
          ..updatedAt = now
          ..title = previousTitle ?? existing.first.title;
      }
    }
    for (final c in conversations) {
      if (c.sessionId != newSessionId) c.status = 'closed';
    }
    if (!conversations.any((c) => c.sessionId == newSessionId)) {
      conversations.insert(
        0,
        ConversationMeta(
          sessionId: newSessionId,
          title: 'New conversation',
          createdAt: now,
          updatedAt: now,
          status: 'active',
          parentSessionId: previousSessionId,
        ),
      );
    } else {
      final next = conversations.firstWhere((c) => c.sessionId == newSessionId);
      next.status = 'active';
      next.updatedAt = now;
    }
    activeSessionId = newSessionId;
    await _saveIndex();
    await save(events: [], answered: {}, sessionId: newSessionId);
  }

  String? _titleFrom(List<AppChatEvent> events, String? fallback) {
    if (fallback != null && fallback.trim().isNotEmpty) return fallback.trim();
    for (final e in events) {
      if (e.isUser && e.text.trim().isNotEmpty && !e.text.startsWith('/')) {
        final t = e.text.trim();
        return t.length > 60 ? '${t.substring(0, 57)}…' : t;
      }
    }
    return null;
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
    String? sessionId,
  }) async {
    final persistable = events
        .where((e) => e.type != 'typing' && e.type != 'progress' && e.type != 'conversation')
        .toList();
    final id = sessionId ?? activeSessionId;
    final payload = {
      'version': 1,
      'sessionId': ?id,
      'lastServerId': ?lastServerId,
      'answered': answered.toList(),
      'events': persistable.map((e) => e.toJson()).toList(),
    };
    final dir = await root();
    final targets = <File>[_eventsFile(dir)];
    if (id != null && id.isNotEmpty) targets.add(_eventsFile(dir, id));
    final encoded = jsonEncode(payload);
    for (final file in targets) {
      final tmp = File('${file.path}.tmp');
      await tmp.writeAsString(encoded);
      await tmp.rename(file.path);
    }
    if (id != null) {
      final hit = conversations.where((c) => c.sessionId == id);
      if (hit.isNotEmpty) {
        hit.first.updatedAt = DateTime.now().millisecondsSinceEpoch;
        if (hit.first.title == 'New conversation') {
          final derived = _titleFrom(persistable, null);
          if (derived != null) hit.first.title = derived;
        }
        await _saveIndex();
      }
    }
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

  Future<String?> existingMedia(String fileId) async {
    final dir = await mediaDir();
    if (!await dir.exists()) return null;
    final prefix = '${fileId}_';
    await for (final entity in dir.list()) {
      if (entity is! File) continue;
      final base = entity.uri.pathSegments.last;
      // Match only this fileId prefix — never fall back to basename
      // (two uploads named photo.jpg must not swap).
      if (base.startsWith(prefix)) return entity.path;
    }
    return null;
  }
}