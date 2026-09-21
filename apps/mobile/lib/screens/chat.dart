import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter/services.dart';
import 'package:gal/gal.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../api/client.dart';
import '../desktop.dart';
import '../api/models.dart';
import '../chat/chat_store.dart';
import '../chat/cli_update.dart';
import '../chat/commands.dart';
import '../chat/draft.dart';
import '../chat/notifications.dart';
import '../chat/computer.dart';
import '../chat/preview_urls.dart';
import '../screens/browser_handoff.dart';
import '../screens/preview.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/file_viewer.dart';
import '../widgets/markdown.dart';
import '../widgets/computer_pane.dart';
import '../widgets/media.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.instanceId, this.instance});
  final String instanceId;
  final CloudInstance? instance;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final events = <AppChatEvent>[];
  final answered = <String>{};
  final fetching = <String>{};
  late final ChatStore store;
  StreamSubscription<AppChatEvent>? _sub;
  StreamSubscription<ComputerFrame>? _browserSub;
  List<BotCommand> commands = defaultBotCommandsFor(AgentRuntime.supercharge);
  CloudInstance? inst;
  Map<String, dynamic>? cli;
  bool hideCliUpdate = false;
  bool sending = false;
  bool connecting = true;
  bool reconnecting = false;
  bool disposed = false;
  bool paymentBlocked = false;
  bool showKickoff = false;
  bool backgrounded = false;
  String? error;
  String connectLabel = 'Connecting to sandbox…';
  String? lastServerId;
  String? lastAssistantText;
  DateTime? turnStartedAt;
  Duration? lastTurnElapsed;
  bool pinnedToLatest = true;
  int toolCount = 0;
  int? etaMs;
  int? usageUsed;
  int? usageMax;
  int? usagePct;
  String? usageLabel;
  final pickerPage = <String, int>{};
  Timer? _tick;
  final pending = <DraftAttach>[];
  final computer = ComputerState();
  bool _computerOpen = false;
  bool _browserViewerOpen = false;
  bool _browserListening = false;
  Timer? _liveTick;

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;
  bool get working => turnStartedAt != null;
  String get instanceName => inst?.name ?? widget.instance?.name ?? 'Chat';
  AgentRuntime get runtime =>
      inst?.runtime ?? widget.instance?.runtime ?? AgentRuntime.supercharge;
  bool get _isSupercharge => runtime == AgentRuntime.supercharge;

  Duration get elapsed => turnStartedAt == null
      ? Duration.zero
      : DateTime.now().difference(turnStartedAt!);

  int get progressPct =>
      TaskNotifications.softPercent(tools: toolCount, elapsed: elapsed);

  @override
  void initState() {
    super.initState();
    store = ChatStore(id);
    WidgetsBinding.instance.addObserver(this);
    _scroll.addListener(_onUserScroll);
    _input.addListener(() {
      if (mounted) setState(() {});
    });
    _boot();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      backgrounded = false;
      unawaited(TaskNotifications.leaveBackground());
      unawaited(_catchUp());
      return;
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      backgrounded = true;
      _browserSub?.cancel();
      _browserSub = null;
      _browserListening = false;
      if (working) {
        unawaited(TaskNotifications.enterBackground());
      } else {
        _sub?.cancel();
      }
    }
  }

  Future<void> _boot() async {
    setState(() {
      connecting = true;
      paymentBlocked = false;
      connectLabel = inst?.isPaused == true
          ? 'Waking paused sandbox…'
          : 'Connecting to sandbox…';
    });
    final snap = await store.load();
    if (mounted && snap.events.isNotEmpty) {
      setState(() {
        events
          ..clear()
          ..addAll(snap.events);
        answered
          ..clear()
          ..addAll(snap.answered);
        lastServerId = _isServerSeq(snap.lastServerId)
            ? snap.lastServerId
            : null;
        connecting = false;
        computer.replay(events);
      });
      _scrollToEnd(instant: true);
      Future<void>.delayed(const Duration(milliseconds: 80), () {
        if (mounted) _scrollToEnd(instant: true);
      });
      Future<void>.delayed(const Duration(milliseconds: 280), () {
        if (mounted) _scrollToEnd(instant: true);
      });
    }
    try {
      inst = await api.getInstance(id);
      if (mounted) {
        setState(
          () => commands = defaultBotCommandsFor(
            inst?.runtime ?? AgentRuntime.supercharge,
          ),
        );
      }
      if (inst?.needsPayment == true) {
        if (!mounted) return;
        setState(() {
          connecting = false;
          paymentBlocked = true;
        });
        return;
      }
      // New sandboxes have an empty inbox. Do not keep the full-screen
      // "Connecting…" overlay until the first chat event — that never comes.
      if (mounted) setState(() => connecting = false);
    } on ApiException catch (e) {
      if (e.paymentRequired) {
        if (!mounted) return;
        setState(() {
          connecting = false;
          paymentBlocked = true;
          error = e.message;
        });
        return;
      }
      if (mounted) {
        setState(() {
          connecting = false;
          error = e.message;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          connecting = false;
          error = e.toString();
        });
      }
    }
    if (inst?.isPaused == true) {
      try {
        await api.wake(id);
      } catch (_) {}
    }
    unawaited(_hydrateFromRemote());
    _listen();
    api
        .commands(id)
        .then((c) {
          if (mounted && c.isNotEmpty) setState(() => commands = c);
        })
        .catchError((_) {});
    api
        .chatStatus(id)
        .then((s) {
          if (!mounted) return;
          setState(() {
            final u = s['usage'];
            if (u is Map) {
              usageUsed = (u['used'] as num?)?.toInt();
              usageMax = (u['max'] as num?)?.toInt();
              usagePct = (u['pct'] as num?)?.toInt();
              usageLabel = u['label'] as String?;
            }
            final t = s['turn'];
            if (t is Map && t['busy'] == true) {
              final started = (t['startedAt'] as num?)?.toInt();
              turnStartedAt = started != null && started > 0
                  ? DateTime.fromMillisecondsSinceEpoch(started)
                  : DateTime.now();
              toolCount = (t['tools'] as num?)?.toInt() ?? toolCount;
              computer.setAgentWorking(true);
            }
          });
        })
        .catchError((_) {});
    api
        .cliVersion(id)
        .then((c) {
          if (!mounted) return;
          setState(() => cli = c);
          unawaited(_maybeOfferCliUpdate(c));
        })
        .catchError((_) {});
    unawaited(TaskNotifications.requestPermissions());
    unawaited(_refreshConversations());
  }

  void _listen() {
    _sub?.cancel();
    _sub = _eventLoop().listen(
      (ev) {
        if (!mounted) return;
        setState(() {
          connecting = false;
          reconnecting = false;
          _ingest(ev);
        });
        if (pinnedToLatest) _scrollToEnd();
      },
      onError: (e) {
        if (!mounted) return;
        if (backgrounded) {
          setState(() => reconnecting = true);
          return;
        }
        final pay = e is ApiException && e.paymentRequired;
        setState(() {
          connecting = false;
          reconnecting = false;
          paymentBlocked = pay;
          error = e.toString();
        });
      },
    );
  }

  void _checkLivePause() {
    final at = computer.lastFrameAt;
    if (computer.live &&
        at != null &&
        DateTime.now().difference(at).inSeconds >= 3) {
      computer.markLivePaused();
    }
  }

  void _syncBrowserStream() {
    final want =
        !disposed &&
        !backgrounded &&
        !paymentBlocked &&
        (_computerOpen || computer.isBrowser || computer.live || working);
    if (want) {
      _listenBrowser();
    } else {
      _browserSub?.cancel();
      _browserSub = null;
      _browserListening = false;
      _liveTick?.cancel();
      _liveTick = null;
    }
  }

  void _listenBrowser() {
    if (_browserListening) return;
    _browserListening = true;
    _liveTick?.cancel();
    _liveTick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(_checkLivePause);
    });
    _browserSub?.cancel();
    _browserSub = _browserLoop().listen(
      (frame) {
        if (!mounted) return;
        setState(() {
          if (frame.type == 'frame' &&
              frame.bytes != null &&
              frame.bytes!.isNotEmpty) {
            computer.setLiveFrame(frame.bytes!);
          } else if (frame.type == 'status') {
            computer.setLiveStatus(
              connected: frame.connected,
              screencasting: frame.screencasting,
            );
          }
        });
      },
      onError: (_) {
        _browserListening = false;
        if (mounted) setState(computer.markLivePaused);
      },
      onDone: () {
        _browserListening = false;
      },
    );
  }

  Stream<ComputerFrame> _browserLoop() async* {
    var delay = 1;
    while (!disposed) {
      try {
        await for (final frame in api.browserFrames(id)) {
          delay = 1;
          yield frame;
        }
      } catch (_) {}
      if (disposed) return;
      await Future<void>.delayed(Duration(seconds: delay));
      if (delay < 8) delay *= 2;
    }
  }

  bool _isServerSeq(String? value) =>
      value != null && value.isNotEmpty && RegExp(r'^\d+$').hasMatch(value);

  Stream<AppChatEvent> _eventLoop() async* {
    var delay = 1;
    while (!disposed) {
      try {
        await for (final ev in api.events(
          id,
          since: _isServerSeq(lastServerId) ? lastServerId : null,
        )) {
          delay = 1;
          yield ev;
        }
      } on ApiException catch (e) {
        if (e.paymentRequired || e.status == 401 || e.status == 410) {
          rethrow;
        }
        if (!disposed && mounted) {
          setState(() {
            if (connecting && events.isEmpty) {
              error = e.message;
              connecting = false;
            } else if (!backgrounded) {
              reconnecting = true;
            }
          });
        }
      } catch (e) {
        if (!disposed && mounted && connecting && events.isEmpty) {
          setState(() {
            error = e.toString();
            connecting = false;
          });
        } else if (!disposed && mounted && !backgrounded) {
          setState(() => reconnecting = true);
        }
      }
      if (disposed) return;
      await Future<void>.delayed(Duration(seconds: delay));
      delay = math.min(delay * 2, 12);
    }
  }

  bool _alreadyHave(AppChatEvent ev) {
    if (ev.local || ev.id.isEmpty) return false;
    return events.any((e) {
      if (e.local || e.id != ev.id || e.type != ev.type) return false;
      if (ev.ts > 0 && e.ts > 0) return (e.ts - ev.ts).abs() < 8000;
      return e.text == ev.text && e.fileId == ev.fileId;
    });
  }

  void _ingest(AppChatEvent ev) {
    if (ev.type == 'ready' || ev.type == 'hello' || ev.type == 'ping') {
      return;
    }
    if (ev.type == 'conversation') {
      unawaited(_applyConversationEvent(ev));
      return;
    }
    if (ev.type == 'status') {
      final busy = ev.busy == true;
      if (busy) {
        if (ev.startedAt != null && ev.startedAt! > 0) {
          turnStartedAt = DateTime.fromMillisecondsSinceEpoch(ev.startedAt!);
        } else {
          turnStartedAt ??= DateTime.now();
        }
        if (ev.tools != null) toolCount = ev.tools!;
        if (ev.etaMs != null) etaMs = ev.etaMs;
        computer.setAgentWorking(true);
      } else if (working || sending || showKickoff) {
        _endTurn();
      } else {
        computer.setAgentWorking(false);
      }
      return;
    }
    if (ev.type == 'usage') {
      usageUsed = ev.used;
      usageMax = ev.max;
      usagePct = ev.pct;
      usageLabel = ev.label ?? ev.text;
      if ((usageLabel == null || usageLabel!.isEmpty) &&
          usageUsed != null &&
          usageMax != null) {
        usageLabel = '${_fmtTokens(usageUsed!)} / ${_fmtTokens(usageMax!)}';
      }
      return;
    }
    if (!ev.local && _isServerSeq(ev.id)) {
      lastServerId = ev.id;
      if (_alreadyHave(ev)) return;
    }
    if (ev.type == 'user' && !ev.local) {
      final text = ev.text.trim();
      final dup = events.any(
        (e) =>
            e.type == 'user' &&
            e.text.trim() == text &&
            (e.local ||
                (ev.ts > 0 && e.ts > 0 && (e.ts - ev.ts).abs() < 20000)),
      );
      if (dup) {
        _persist();
        return;
      }
    }
    if (ev.type == 'progress') {
      showKickoff = false;
      if (ev.tools != null) toolCount = math.max(toolCount, ev.tools!);
      final live = events.lastIndexWhere(
        (e) => e.type == 'progress' && !e.local,
      );
      if (live >= 0) {
        events[live] = ev;
      } else {
        events.add(ev);
      }
      unawaited(_notifyProgress());
      _persist();
      return;
    }
    if (ev.type == 'typing') {
      return;
    }
    if (ev.type == 'done') {
      if (working || sending || showKickoff) _endTurn();
      return;
    }
    if (ev.type == 'error') {
      lastAssistantText = ev.text;
      events.add(ev);
      _endTurn(error: true, body: ev.text);
      return;
    }
    if (ev.type == 'text') {
      sending = false;
      showKickoff = false;
      final live = events.lastIndexWhere(
        (e) => e.type == 'text' && !e.local && e.raw['final'] != true,
      );
      if (live >= 0) {
        events[live] = ev;
        if (ev.text.isNotEmpty) {
          lastAssistantText = ev.text;
          final show = parseComputerShow(ev.text);
          if (show != null) computer.tab = show;
        }
        _persist();
        unawaited(_notifyProgress());
        return;
      }
    }
    if (ev.type == 'ask' || ev.type == 'approve' || ev.type == 'file') {
      sending = false;
      showKickoff = false;
    }
    if ((ev.type == 'ask' || ev.type == 'approve') &&
        !answered.contains(ev.ref ?? ev.id)) {
      unawaited(
        TaskNotifications.showPermissionNeed(
          instanceId: id,
          name: instanceName,
          body: ev.text,
          kind: ev.type,
        ),
      );
    }
    if (ev.type == 'text' && ev.text.isNotEmpty) {
      lastAssistantText = ev.text;
      final show = parseComputerShow(ev.text);
      if (show != null) computer.tab = show;
    }
    if (ev.type == 'text' && _isModelSwitchNote(ev.text) && _justPickedModel) {
      _persist();
      return;
    }
    if (ev.type == 'computer') {
      showKickoff = false;
      computer.apply(ev);
      if (ev.kind == 'browser' || ev.tab == 'browser' || computer.isBrowser) {
        _syncBrowserStream();
      }
    }
    if (ev.type == 'file' && ev.isImage) {
      computer.setStill(path: ev.localPath, url: ev.url);
    }
    if (ev.type == 'tool') {
      showKickoff = false;
      if (ev.state != 'done') toolCount += 1;
      final i = events.lastIndexWhere(
        (e) => e.type == 'tool' && e.state != 'done',
      );
      if (i >= 0 && ev.state == 'done') {
        events[i] = ev;
        _persist();
        unawaited(_notifyProgress());
        return;
      }
    }
    if (ev.type == 'file' && ev.role == 'user') {
      final unmatched = <int>[];
      for (var i = 0; i < events.length; i++) {
        final e = events[i];
        if (e.isUser && e.type == 'file' && e.fileId == null && e.local) {
          unmatched.add(i);
        }
      }
      int? match;
      for (final i in unmatched.reversed) {
        if (events[i].name == ev.name) {
          match = i;
          break;
        }
      }
      if (match == null && unmatched.length == 1) match = unmatched.first;
      if (match != null) {
        events[match].raw['fileId'] = ev.fileId;
        events[match].raw['kind'] = ev.kind ?? events[match].kind;
        _persist();
        return;
      }
    }
    events.add(ev);
    if (ev.type == 'file' && ev.fileId != null && ev.localPath == null) {
      unawaited(
        _ensureLocalFile(ev, auto: ev.isImage).then((_) {
          if (!mounted) return;
          if (ev.isImage && ev.localPath != null) {
            setState(() => computer.setStill(path: ev.localPath, url: ev.url));
          }
        }),
      );
    }
    _persist();
    unawaited(_notifyProgress());
  }

  Future<void> _applyConversationEvent(AppChatEvent ev) async {
    final nextId = ev.sessionId;
    if (nextId == null || nextId.isEmpty) return;
    final remote = ev.conversations
        .where((m) => '${m['sessionId'] ?? ''}'.isNotEmpty)
        .map((m) => ConversationMeta.fromJson(m))
        .toList();

    // Already on this lane (optimistic /new or a first message already landed).
    if (store.activeSessionId == nextId) {
      if (remote.isNotEmpty) {
        await store.mergeRemote(remote, active: nextId);
      }
      if (mounted) setState(() => _endTurn());
      return;
    }

    final snapshot = List<AppChatEvent>.from(events);
    final answeredSnap = Set<String>.from(answered);
    final lastId = lastServerId;
    final previousId = ev.previousSessionId ?? store.activeSessionId;

    // Clear the old lane immediately so a racing first message is not archived
    // into the previous chat, and unlock the composer (/new is not a long turn).
    if (mounted) {
      setState(() {
        _endTurn();
        events.removeWhere(snapshot.contains);
        answered.clear();
        lastServerId = null;
        lastAssistantText = null;
        toolCount = 0;
        showKickoff = false;
        computer.clear();
      });
    }
    store.activeSessionId = nextId;

    await store.archiveAndStart(
      previousSessionId: previousId,
      newSessionId: nextId,
      previousTitle: ev.title,
      currentEvents: snapshot,
      answered: answeredSnap,
      lastServerId: lastId,
    );
    if (remote.isNotEmpty) {
      await store.mergeRemote(remote, active: nextId);
    }
    if (mounted) setState(() {});
  }

  Future<void> _hydrateFromRemote() async {
    await _refreshConversations();
    final sid = store.activeSessionId;
    if (sid == null || sid.isEmpty) return;
    try {
      final remote = await api.getConversation(id, sid);
      final msgs = (remote['messages'] as List?) ?? const [];
      if (msgs.isEmpty || !mounted) return;
      var added = false;
      for (final m in msgs.whereType<Map>()) {
        final role = '${m['role'] ?? ''}';
        final content = m['content'];
        final text = content is String
            ? content
            : (content == null ? '' : content.toString());
        if (text.trim().isEmpty) continue;
        final type = role == 'user' ? 'user' : 'text';
        final exists = events.any(
          (e) =>
              (type == 'user'
                  ? e.type == 'user'
                  : (e.type == 'text' || e.type == 'error')) &&
              e.text.trim() == text.trim(),
        );
        if (exists) continue;
        events.add(
          AppChatEvent({
            'type': type,
            'role': role,
            'text': text,
            'format': 'markdown',
            'final': type == 'text',
            'id': 'db-$sid-${events.length}',
            'ts': DateTime.now().millisecondsSinceEpoch,
          }),
        );
        added = true;
      }
      if (added && mounted) {
        setState(() {});
        _persist();
      }
    } catch (_) {}
  }

  Future<void> _pollTurnStatus() async {
    try {
      final s = await api.chatStatus(id);
      if (!mounted) return;
      final t = s['turn'];
      final busy = t is Map && t['busy'] == true;
      setState(() {
        final u = s['usage'];
        if (u is Map) {
          usageUsed = (u['used'] as num?)?.toInt();
          usageMax = (u['max'] as num?)?.toInt();
          usagePct = (u['pct'] as num?)?.toInt();
          usageLabel = u['label'] as String?;
        }
        if (busy) {
          final started = (t['startedAt'] as num?)?.toInt();
          turnStartedAt = started != null && started > 0
              ? DateTime.fromMillisecondsSinceEpoch(started)
              : (turnStartedAt ?? DateTime.now());
          toolCount = (t['tools'] as num?)?.toInt() ?? toolCount;
          computer.setAgentWorking(true);
        }
      });
      if (!busy && working) {
        await _hydrateFromRemote();
        if (mounted) setState(_endTurn);
      }
    } catch (_) {}
  }

  Future<void> _catchUp() async {
    await _pollTurnStatus();
    await _hydrateFromRemote();
    if (!mounted) return;
    _listen();
    _syncBrowserStream();
  }

  Future<void> _refreshConversations() async {
    try {
      final raw = await api.listConversations(id);
      final active = raw['active'] as String?;
      final list = (raw['conversations'] as List?) ?? const [];
      final remote = list
          .whereType<Map>()
          .map((e) => ConversationMeta.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      await store.mergeRemote(remote, active: active);
      if (mounted) setState(() {});
    } catch (_) {}
  }

  Future<void> _openConversation(ConversationMeta item) async {
    if (working) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Stop the current task before switching conversations.',
          ),
        ),
      );
      return;
    }
    Navigator.of(context).maybePop();
    await store.save(
      events: events,
      answered: answered,
      lastServerId: lastServerId,
    );
    try {
      await api.switchConversation(id, item.sessionId);
    } catch (_) {}
    final snap = await store.load(sessionId: item.sessionId);
    if (!mounted) return;
    setState(() {
      store.activeSessionId = item.sessionId;
      events
        ..clear()
        ..addAll(snap.events);
      answered
        ..clear()
        ..addAll(snap.answered);
      lastServerId = _isServerSeq(snap.lastServerId) ? snap.lastServerId : null;
      computer.replay(events);
    });
    if (snap.events.isEmpty) {
      try {
        final remote = await api.getConversation(id, item.sessionId);
        final msgs = (remote['messages'] as List?) ?? const [];
        if (!mounted) return;
        setState(() {
          for (final m in msgs.whereType<Map>()) {
            final role = '${m['role'] ?? ''}';
            final content = m['content'];
            final text = content is String
                ? content
                : content == null
                ? ''
                : content.toString();
            if (text.isEmpty) continue;
            events.add(
              AppChatEvent({
                'type': role == 'user' ? 'user' : 'text',
                'role': role,
                'text': text,
                'format': 'markdown',
                'id': 'resume-${item.sessionId}-${events.length}',
                'ts': DateTime.now().millisecondsSinceEpoch,
              }),
            );
          }
        });
      } catch (_) {}
    }
  }

  void _showHistory() {
    unawaited(_refreshConversations());
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Vc.card,
      showDragHandle: true,
      builder: (ctx) {
        final items = store.conversations;
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const ListTile(
                title: Text(
                  'Conversation history',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text('Previous chats stay here after New chat'),
              ),
              ListTile(
                leading: const Icon(Icons.edit_square, color: Vc.green),
                title: const Text(
                  'New chat',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: const Text(
                  'Keeps this conversation in history',
                  style: TextStyle(color: Vc.muted, fontSize: 12),
                ),
                onTap: () => unawaited(_startNewChat()),
              ),
              if (items.isEmpty)
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 0, 16, 24),
                  child: Text(
                    'No other conversations yet. New chat will keep this one here.',
                    style: TextStyle(color: Vc.muted),
                  ),
                )
              else
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 420),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      for (final c in items)
                        ListTile(
                          selected: c.sessionId == store.activeSessionId,
                          leading: Icon(
                            c.status == 'closed'
                                ? Icons.history
                                : Icons.chat_bubble_outline,
                            color: c.sessionId == store.activeSessionId
                                ? Vc.green
                                : Vc.muted,
                          ),
                          title: Text(
                            c.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            '${c.status} · ${c.sessionId}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 11,
                              color: Vc.muted,
                            ),
                          ),
                          onTap: () => _openConversation(c),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  void _persist() {
    store.scheduleSave(
      events: events,
      answered: answered,
      lastServerId: lastServerId,
    );
  }

  void _beginTurn() {
    turnStartedAt = DateTime.now();
    toolCount = 0;
    etaMs = null;
    showKickoff = true;
    sending = true;
    error = null;
    lastAssistantText = null;
    computer.setAgentWorking(true);
    _tick?.cancel();
    var statusTicks = 0;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || turnStartedAt == null) return;
      setState(() => _checkLivePause());
      unawaited(_notifyProgress());
      statusTicks += 1;
      if (statusTicks % 4 == 0) unawaited(_pollTurnStatus());
    });
    _syncBrowserStream();
    unawaited(
      TaskNotifications.startTurn(
        instanceId: id,
        name: instanceName,
        apiBase: api.baseUrl,
        token: api.token,
        since: _isServerSeq(lastServerId) ? lastServerId : null,
      ),
    );
  }

  void _endTurn({bool error = false, String? body}) {
    sending = false;
    showKickoff = false;
    etaMs = null;
    if (turnStartedAt != null) {
      lastTurnElapsed = DateTime.now().difference(turnStartedAt!);
    }
    turnStartedAt = null;
    computer.setAgentWorking(false);
    _tick?.cancel();
    _tick = null;
    _syncBrowserStream();
    _persist();
    unawaited(
      TaskNotifications.finishTurn(
        instanceId: id,
        name: instanceName,
        body: body ?? lastAssistantText,
        error: error,
      ),
    );
  }

  Future<void> _notifyProgress() async {
    if (turnStartedAt == null) return;
    await TaskNotifications.updateProgress(
      instanceId: id,
      name: instanceName,
      elapsed: elapsed,
      tools: toolCount,
      pct: progressPct,
    );
  }

  void _onUserScroll() {
    if (!_scroll.hasClients) return;
    final atLatest = _scroll.offset <= 80;
    if (atLatest != pinnedToLatest && mounted) {
      setState(() => pinnedToLatest = atLatest);
    }
  }

  void _scrollToEnd({bool instant = false, bool force = false}) {
    if (!force && !pinnedToLatest) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      if (instant) {
        _scroll.jumpTo(0);
        return;
      }
      _scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  void _jumpToLatest() {
    setState(() => pinnedToLatest = true);
    _scrollToEnd(force: true);
  }

  List<List<AppChatEvent>> _grouped() {
    final groups = <List<AppChatEvent>>[];
    for (final ev in events) {
      if (ev.type == 'computer') continue;
      if ((ev.type == 'ask' || ev.type == 'approve') &&
          answered.contains(ev.ref ?? ev.id)) {
        continue;
      }
      if (ev.type == 'tool' &&
          groups.isNotEmpty &&
          groups.last.first.type == 'tool') {
        groups.last.add(ev);
      } else {
        groups.add([ev]);
      }
    }
    return groups;
  }

  void _resolve(AppChatEvent ev) {
    setState(() => answered.add(ev.ref ?? ev.id));
    _persist();
  }

  @override
  void dispose() {
    disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _browserSub?.cancel();
    _tick?.cancel();
    _liveTick?.cancel();
    _input.dispose();
    _scroll.removeListener(_onUserScroll);
    _scroll.dispose();
    computer.dispose();
    unawaited(
      store.save(
        events: events,
        answered: answered,
        lastServerId: lastServerId,
      ),
    );
    if (turnStartedAt == null) {
      unawaited(TaskNotifications.cancelSilent());
    }
    super.dispose();
  }

  Future<void> _maybeOfferCliUpdate(Map<String, dynamic> raw) async {
    final info = CliVersion.fromJson(raw, runtime: runtime.apiValue);
    if (!info.updateAvailable) return;
    if (await CliUpdateOffer.isDismissed(id, info.latest)) {
      if (mounted) setState(() => hideCliUpdate = true);
      return;
    }
    await CliUpdateOffer.notifyOnce(
      instanceId: id,
      name: instanceName,
      info: info,
    );
  }

  Future<void> _runCliUpdate() async {
    if (sending || working) return;
    final latest = '${cli?['latest'] ?? ''}';
    if (inst?.runtime == AgentRuntime.supercharge) {
      await _applySuperchargeUpdate();
    } else {
      await _send('/update yes');
    }
    if (latest.isNotEmpty) {
      await CliUpdateOffer.dismiss(id, latest);
    }
    if (mounted) setState(() => hideCliUpdate = true);
  }

  Future<void> _applySuperchargeUpdate() async {
    setState(() => sending = true);
    events.add(
      AppChatEvent({
        'type': 'user',
        'text': '/update yes',
        'id': 'local-${DateTime.now().millisecondsSinceEpoch}',
        'ts': DateTime.now().millisecondsSinceEpoch,
        'format': 'markdown',
      }, local: true),
    );
    try {
      final result = await api.cliUpdate(id);
      final ok = result['ok'] == true;
      final from = result['from'] ?? '?';
      final to = result['to'] ?? result['verified'] ?? '?';
      events.add(
        AppChatEvent({
          'type': 'text',
          'text': ok
              ? '## Supercharge updated\n\n`$from` → `$to`\n\nDaemon restarted. Chats were kept. No new E2B template.'
              : '## Supercharge update failed\n\n```\n${result['error'] ?? result['logs'] ?? result}\n```',
          'final': true,
          'format': 'markdown',
          'id': 'local-update-${DateTime.now().millisecondsSinceEpoch}',
          'ts': DateTime.now().millisecondsSinceEpoch,
        }, local: true),
      );
    } catch (e) {
      events.add(
        AppChatEvent({
          'type': 'error',
          'text': e.toString(),
          'id': 'local-update-err-${DateTime.now().millisecondsSinceEpoch}',
          'ts': DateTime.now().millisecondsSinceEpoch,
        }, local: true),
      );
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  Future<void> _dismissCliUpdate() async {
    final latest = '${cli?['latest'] ?? ''}';
    await CliUpdateOffer.dismiss(id, latest);
    if (mounted) setState(() => hideCliUpdate = true);
  }

  Future<void> _startNewChat() async {
    if (working) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Stop the current task before starting a new chat.'),
        ),
      );
      return;
    }
    Navigator.of(context).maybePop();
    try {
      await api.startNewConversation(id);
    } catch (e) {
      if (!mounted) return;
      setState(() => error = e.toString());
    }
  }

  Future<void> _send([String? text]) async {
    final t = (text ?? _input.text).trim();
    if (sending) return;
    if (t.isEmpty && pending.isEmpty) return;
    if (pending.isEmpty && slashCommandName(t) == 'history') {
      _input.clear();
      _showHistory();
      return;
    }
    if (pending.isEmpty &&
        slashCommandName(t) == 'update' &&
        inst?.runtime == AgentRuntime.supercharge) {
      _input.clear();
      final arg = t.trim().toLowerCase().replaceFirst(
        RegExp(r'^/update\s*'),
        '',
      );
      if (arg == 'no' || arg == 'n' || arg == 'dismiss' || arg == 'later') {
        await _dismissCliUpdate();
        return;
      }
      if (arg == 'yes' ||
          arg == 'y' ||
          arg == 'apply' ||
          arg == 'install' ||
          arg == 'ok') {
        await _applySuperchargeUpdate();
        return;
      }
      try {
        final info = await api.cliVersion(id);
        if (mounted) setState(() => cli = info);
        events.add(
          AppChatEvent({
            'type': 'text',
            'text':
                '## Supercharge update\n\nRunning `${info['current'] ?? '?'}` · latest `${info['latest'] ?? '?'}`.\n\nReply **`/update yes`** to install daemon+CLI and restart (chats kept, no new template).',
            'final': true,
            'format': 'markdown',
            'id': 'local-update-check-${DateTime.now().millisecondsSinceEpoch}',
            'ts': DateTime.now().millisecondsSinceEpoch,
          }, local: true),
        );
        setState(() {});
      } catch (e) {
        if (mounted) setState(() => error = e.toString());
      }
      return;
    }
    final drafts = List<DraftAttach>.from(pending);
    final cmd = slashCommandName(t);
    final agentTurn =
        drafts.isNotEmpty ||
        cmd == null ||
        commandStartsAgentTurn(cmd, runtime: runtime);
    final newLane = isNewLaneCommand(t, runtime: runtime);
    _input.clear();
    HapticFeedback.lightImpact();
    setState(() {
      if (agentTurn) {
        _beginTurn();
      } else {
        sending = true;
      }
      pending.clear();
      if (t.isNotEmpty && !newLane) {
        events.add(
          AppChatEvent({
            'type': 'user',
            'text': t,
            'id': 'local-${DateTime.now().millisecondsSinceEpoch}',
            'ts': DateTime.now().millisecondsSinceEpoch,
            'format': 'markdown',
          }, local: true),
        );
      }
      for (final f in drafts) {
        events.add(
          AppChatEvent({
            'type': 'file',
            'role': 'user',
            'text': drafts.length == 1 ? t : '',
            'name': f.name,
            'kind': f.isImage ? 'photo' : 'document',
            'mime': f.mime,
            'size': f.size,
            'localPath': f.path,
            'id': f.id,
            'ts': DateTime.now().millisecondsSinceEpoch,
          }, local: true),
        );
      }
    });
    _persist();
    setState(() => pinnedToLatest = true);
    _scrollToEnd(force: true);
    try {
      if (drafts.isEmpty) {
        await api.sendChat(id, t);
      } else {
        await api.uploadFiles(
          id,
          caption: t,
          files: [
            for (final f in drafts)
              (name: f.name, bytes: f.bytes, mime: f.mime),
          ],
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endTurn(error: true, body: e.toString());
        error = e.toString();
      });
    } finally {
      if (!agentTurn && mounted) {
        setState(() => sending = false);
      }
    }
  }

  Future<void> _attach() async {
    if (sending) return;
    final picked = await FilePicker.pickFiles();
    if (picked.isEmpty) return;
    for (final f in picked) {
      if (pending.length >= 12) break;
      final bytes = await f.readAsBytes();
      if (bytes.isEmpty) continue;
      final mime = f.xFile.mimeType;
      final localId =
          'draft-${DateTime.now().millisecondsSinceEpoch}-${f.name}';
      final path = await store.saveMedia(
        name: f.name,
        bytes: bytes,
        id: localId,
      );
      pending.add(
        DraftAttach(
          id: localId,
          name: f.name,
          bytes: Uint8List.fromList(bytes),
          path: path,
          mime: mime,
          kind: looksLikeImage(name: f.name, mime: mime) ? 'photo' : 'document',
        ),
      );
    }
    if (mounted) setState(() {});
  }

  Future<void> _ensureLocalFile(AppChatEvent ev, {bool auto = false}) async {
    final fileId = ev.fileId;
    if (fileId == null) return;
    if (ev.localPath != null && File(ev.localPath!).existsSync()) return;
    final cached = await store.existingMedia(fileId);
    if (cached != null) {
      if (!mounted) return;
      setState(() => ev.setLocalPath(cached));
      _persist();
      return;
    }
    if (!auto && fetching.contains(fileId)) return;
    if (fetching.contains(fileId)) return;
    fetching.add(fileId);
    if (mounted) setState(() {});
    try {
      final file = await api.downloadFile(id, fileId);
      final path = await store.saveMedia(
        name: file.name,
        bytes: file.bytes,
        id: fileId,
      );
      if (!mounted) return;
      setState(() {
        ev.setLocalPath(path);
        ev.raw['name'] = file.name;
        ev.raw['mime'] = file.mime;
        ev.raw['size'] = file.bytes.length;
      });
      _persist();
    } catch (e) {
      if (mounted && !auto) setState(() => error = e.toString());
    } finally {
      fetching.remove(fileId);
      if (mounted) setState(() {});
    }
  }

  Future<void> _sharePath(String path, String name) async {
    await SharePlus.instance.share(
      ShareParams(files: [XFile(path)], text: name),
    );
  }

  Future<void> _saveImage(String path) async {
    try {
      if (isDesktop) {
        Directory? dest;
        try {
          dest = await getDownloadsDirectory();
        } catch (_) {}
        dest ??= await getApplicationDocumentsDirectory();
        final name = File(path).uri.pathSegments.last;
        final out = '${dest.path}/$name';
        await File(path).copy(out);
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Saved $out')));
        return;
      }
      final ok = await Gal.requestAccess();
      if (ok == false) {
        if (!mounted) return;
        setState(() => error = 'Photo permission denied');
        return;
      }
      await Gal.putImage(path);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Saved to gallery')));
    } catch (e) {
      if (!mounted) return;
      setState(() => error = e.toString());
    }
  }

  Future<void> _downloadFile(AppChatEvent ev) async {
    await _ensureLocalFile(ev);
    final path = ev.localPath;
    if (path == null || !File(path).existsSync()) return;
    try {
      Directory? dest;
      try {
        dest = await getDownloadsDirectory();
      } catch (_) {}
      dest ??= await getApplicationDocumentsDirectory();
      final out = '${dest.path}/${ev.name ?? File(path).uri.pathSegments.last}';
      await File(path).copy(out);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Saved $out')));
    } catch (e) {
      if (!mounted) return;
      setState(() => error = e.toString());
    }
  }

  void _openImage(AppChatEvent ev) {
    final path = ev.localPath;
    if (path == null) {
      unawaited(_ensureLocalFile(ev, auto: true));
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ImageLightbox(
          path: path,
          title: ev.name ?? 'Image',
          onSave: () => _saveImage(path),
          onShare: () => _sharePath(path, ev.name ?? 'image'),
        ),
      ),
    );
  }

  Future<void> _openFile(AppChatEvent ev) async {
    await _ensureLocalFile(ev, auto: true);
    if (!mounted) return;
    final path = ev.localPath;
    if (path == null || !File(path).existsSync()) {
      setState(() => error = 'Could not load ${ev.name ?? 'file'}');
      return;
    }
    if (ev.isImage) {
      _openImage(ev);
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileViewerScreen(
          path: path,
          title: ev.name ?? 'File',
          mime: ev.mime,
          onShare: () => unawaited(_sharePath(path, ev.name ?? 'file')),
          onSave: () => unawaited(_downloadFile(ev)),
        ),
      ),
    );
  }

  void _openDraft(DraftAttach f) {
    final path = f.path;
    if (path == null || !File(path).existsSync()) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileViewerScreen(
          path: path,
          title: f.name,
          mime: f.mime,
          onShare: () => unawaited(_sharePath(path, f.name)),
        ),
      ),
    );
  }

  Future<void> _customAnswer(AppChatEvent ev) async {
    final c = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Vc.card,
        title: const Text('Your answer'),
        content: TextField(
          controller: c,
          autofocus: true,
          maxLines: 4,
          decoration: const InputDecoration(hintText: 'Type your own answer'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, c.text.trim()),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (text == null || text.isEmpty) return;
    _resolve(ev);
    await api.answer(id, ref: ev.ref, answer: text);
  }

  Future<void> _customModel(AppChatEvent ev) async {
    final c = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Vc.card,
        title: const Text('Custom model'),
        content: TextField(
          controller: c,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'provider/model-id'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, c.text.trim()),
            child: const Text('Use'),
          ),
        ],
      ),
    );
    if (text == null || text.isEmpty) return;
    setState(() => _rememberPick(ev, text, label: text));
    _persist();
    await api.pick(id, ref: ev.ref, value: text, kind: ev.kind ?? 'model');
  }

  String _pickerLabel(AppChatEvent ev, String value) {
    for (final o in ev.options) {
      if ('${o['value']}' == value) {
        return '${o['label'] ?? o['value']}';
      }
    }
    return value;
  }

  void _rememberPick(AppChatEvent ev, String value, {String? label}) {
    ev.raw['picked'] = value;
    ev.raw['pickedLabel'] = label ?? _pickerLabel(ev, value);
    answered.add(ev.ref ?? ev.id);
  }

  bool _isModelSwitchNote(String text) {
    final t = text.trim();
    return RegExp(
      r'^(✓\s*)?model (switched|set) to\b',
      caseSensitive: false,
    ).hasMatch(t);
  }

  bool get _justPickedModel {
    for (var i = events.length - 1; i >= 0; i--) {
      final e = events[i];
      if (e.type == 'picker' &&
          (e.kind == 'model' || (e.title ?? '').toLowerCase() == 'model') &&
          answered.contains(e.ref ?? e.id)) {
        return true;
      }
      if (e.type == 'user' ||
          e.type == 'text' ||
          e.type == 'ask' ||
          e.type == 'tool') {
        return false;
      }
    }
    return false;
  }

  Widget _switchNote(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Vc.muted,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  void _pickCommand(BotCommand c) {
    if (c.command == 'history') {
      _input.clear();
      _showHistory();
      return;
    }
    if (commandSendsImmediately(c.name, runtime: runtime)) {
      _input.clear();
      _send(c.slash);
      return;
    }
    _input.value = TextEditingValue(
      text: '${c.slash} ',
      selection: TextSelection.collapsed(offset: c.slash.length + 1),
    );
  }

  void _commands() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Vc.card,
      isScrollControlled: true,
      builder: (ctx) {
        var q = '';
        return StatefulBuilder(
          builder: (ctx, setModal) {
            final filtered = filterCommands(commands, q);
            return SafeArea(
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.7,
                child: Column(
                  children: [
                    const ListTile(
                      title: Text(
                        'Commands',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: TextField(
                        decoration: const InputDecoration(
                          hintText: 'Search /commands',
                        ),
                        onChanged: (v) =>
                            setModal(() => q = v.trim().toLowerCase()),
                      ),
                    ),
                    Expanded(
                      child: ListView(
                        children: [
                          for (final c in filtered)
                            ListTile(
                              dense: true,
                              visualDensity: VisualDensity.compact,
                              title: Text(
                                c.slash,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                ),
                              ),
                              subtitle: Text(
                                c.description,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Vc.muted,
                                  fontSize: 12,
                                ),
                              ),
                              onTap: () {
                                Navigator.pop(ctx);
                                _pickCommand(c);
                              },
                            ),
                          if (filtered.isEmpty)
                            const ListTile(
                              title: Text(
                                'No matching commands',
                                style: TextStyle(color: Vc.muted),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _bubble(AppChatEvent ev) {
    switch (ev.type) {
      case 'user':
        return Align(
          alignment: Alignment.centerRight,
          child: GestureDetector(
            onLongPress: () {
              Clipboard.setData(ClipboardData(text: ev.text));
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('Copied')));
            },
            child: Container(
              margin: const EdgeInsets.fromLTRB(64, 8, 16, 8),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: const Color(0xFF2A2D33),
                borderRadius: BorderRadius.circular(18),
              ),
              child: ChatMarkdown(data: ev.text, onTapHref: _handleHref),
            ),
          ),
        );
      case 'tool':
        return ToolLine(event: ev);
      case 'approve':
        final locked = answered.contains(ev.ref ?? ev.id);
        return _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Approval needed',
                style: TextStyle(fontWeight: FontWeight.w700, color: Vc.amber),
              ),
              const SizedBox(height: 8),
              ChatMarkdown(data: ev.text),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final c in ['once', 'session', 'always', 'deny'])
                    OutlinedButton(
                      onPressed: locked
                          ? null
                          : () {
                              _resolve(ev);
                              api.approve(id, c);
                            },
                      child: Text(c),
                    ),
                ],
              ),
            ],
          ),
        );
      case 'ask':
        return _pagedAsk(ev);
      case 'picker':
        return _pagedPicker(ev);
      case 'file':
        final busy = ev.fileId != null && fetching.contains(ev.fileId);
        if (ev.isImage) {
          return ChatImageBubble(
            event: ev,
            downloading: busy,
            onOpen: () => _openImage(ev),
            onSave: () {
              if (ev.localPath != null) {
                unawaited(_saveImage(ev.localPath!));
              } else {
                unawaited(_ensureLocalFile(ev, auto: true));
              }
            },
            onShare: () {
              if (ev.localPath != null) {
                unawaited(_sharePath(ev.localPath!, ev.name ?? 'image'));
              }
            },
            onRetry: () => _ensureLocalFile(ev, auto: true),
          );
        }
        return ChatFileCard(
          event: ev,
          downloading: busy,
          onOpen: () => unawaited(_openFile(ev)),
          onDownload: () => _downloadFile(ev),
          onShare: () {
            if (ev.localPath != null) {
              unawaited(_sharePath(ev.localPath!, ev.name ?? 'file'));
            }
          },
        );
      case 'error':
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Text(ev.text, style: const TextStyle(color: Vc.red)),
        );
      case 'progress':
        if (ev.text.trim().isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                ev.kind == 'thinking' || ev.text == 'Working…'
                    ? 'Thinking'
                    : 'Working',
                style: const TextStyle(
                  color: Vc.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.2,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                ev.text,
                style: const TextStyle(
                  color: Vc.muted,
                  fontSize: 13,
                  height: 1.35,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        );
      case 'done':
      case 'typing':
      case 'computer':
        return const SizedBox.shrink();
      default:
        if (ev.text.isEmpty) return const SizedBox.shrink();
        final shown = rewriteLocalhostUrls(ev.text, _sandboxId);
        final previews = extractPreviewUrls(shown);
        return GestureDetector(
          onLongPress: () {
            Clipboard.setData(ClipboardData(text: shown));
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('Copied')));
          },
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ChatMarkdown(data: shown, onTapHref: _handleHref),
                if (previews.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(
                      spacing: 8,
                      children: [
                        for (final u in previews.take(3))
                          OutlinedButton.icon(
                            onPressed: () => _openPreview(u),
                            icon: const Icon(Icons.language, size: 16),
                            label: const Text('Open preview'),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        );
    }
  }

  Widget _card({required Widget child}) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Vc.card,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Vc.cardBorder),
      ),
      child: child,
    );
  }

  Widget _pagedAsk(AppChatEvent ev) {
    const pageSize = 10;
    final locked = answered.contains(ev.ref ?? ev.id);
    final choices = ev.choices;
    final key = 'ask:${ev.ref ?? ev.id}';
    final total = choices.length;
    final pages = total == 0 ? 1 : ((total + pageSize - 1) / pageSize).floor();
    final page = (pickerPage[key] ?? 0).clamp(0, pages - 1);
    final start = page * pageSize;
    final slice = choices.skip(start).take(pageSize).toList();
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ChatMarkdown(data: ev.text),
          const SizedBox(height: 8),
          if (total > pageSize)
            Text(
              '${start + 1}–${start + slice.length} of $total',
              style: const TextStyle(color: Vc.muted, fontSize: 12),
            ),
          for (var i = 0; i < slice.length; i += 2)
            Row(
              children: [
                for (var j = 0; j < 2 && i + j < slice.length; j++)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 6, bottom: 6),
                      child: OutlinedButton(
                        onPressed: locked
                            ? null
                            : () {
                                final abs = start + i + j;
                                _resolve(ev);
                                api.answer(
                                  id,
                                  ref: ev.ref,
                                  index: abs,
                                  answer: choices[abs],
                                );
                              },
                        child: Text(
                          '${start + i + j + 1}. ${slice[i + j]}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ),
                  ),
                if (slice.length - i == 1) const Expanded(child: SizedBox()),
              ],
            ),
          if (pages > 1)
            Row(
              children: [
                TextButton(
                  onPressed: page <= 0
                      ? null
                      : () => setState(() => pickerPage[key] = page - 1),
                  child: const Text('◀ Prev'),
                ),
                Expanded(
                  child: Text(
                    '${page + 1} / $pages',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Vc.muted, fontSize: 12),
                  ),
                ),
                TextButton(
                  onPressed: page >= pages - 1
                      ? null
                      : () => setState(() => pickerPage[key] = page + 1),
                  child: const Text('Next ▶'),
                ),
              ],
            ),
          ListTile(
            dense: true,
            enabled: !locked,
            contentPadding: EdgeInsets.zero,
            title: const Text(
              'Type your own…',
              style: TextStyle(color: Vc.green),
            ),
            onTap: locked ? null : () => _customAnswer(ev),
          ),
        ],
      ),
    );
  }

  Widget _pagedPicker(AppChatEvent ev) {
    const pageSize = 10;
    final locked = answered.contains(ev.ref ?? ev.id);
    final opts = ev.options;
    final key = ev.ref ?? ev.id;
    if (locked) {
      final name = '${ev.raw['pickedLabel'] ?? ev.raw['picked'] ?? ''}'.trim();
      final isModel =
          ev.kind == 'model' || (ev.title ?? '').toLowerCase() == 'model';
      if (name.isEmpty) {
        return _switchNote(isModel ? 'Model switched' : 'Selection saved');
      }
      return _switchNote(
        isModel ? 'Model switched to $name' : 'Switched to $name',
      );
    }
    final total = opts.length;
    final pages = total == 0 ? 1 : ((total + pageSize - 1) / pageSize).floor();
    final page = (pickerPage[key] ?? 0).clamp(0, pages - 1);
    final start = page * pageSize;
    final slice = opts.skip(start).take(pageSize).toList();
    return _card(
      child: Column(
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(ev.title ?? ev.raw['title']?.toString() ?? 'Choose'),
            subtitle: Text(
              [
                if (ev.text.isNotEmpty) ev.text,
                if (total > pageSize)
                  '${start + 1}–${start + slice.length} of $total',
              ].where((s) => s.trim().isNotEmpty).join(' · '),
              style: const TextStyle(color: Vc.muted, fontSize: 12),
            ),
          ),
          for (var i = 0; i < slice.length; i += 2)
            Row(
              children: [
                for (final o in slice.skip(i).take(2))
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(right: 6, bottom: 6),
                      child: OutlinedButton(
                        onPressed: locked
                            ? null
                            : () {
                                final value = '${o['value']}';
                                if (value == '__custom__') {
                                  unawaited(_customModel(ev));
                                  return;
                                }
                                setState(
                                  () => _rememberPick(
                                    ev,
                                    value,
                                    label: '${o['label'] ?? o['value']}',
                                  ),
                                );
                                _persist();
                                api.pick(
                                  id,
                                  ref: ev.ref,
                                  value: value,
                                  kind: ev.kind,
                                );
                              },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: o['current'] == true
                              ? Vc.green
                              : Colors.white,
                          side: BorderSide(
                            color: o['current'] == true
                                ? Vc.green
                                : Vc.cardBorder,
                          ),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 10,
                          ),
                        ),
                        child: Text(
                          '${o['label'] ?? o['value']}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
                if (slice.skip(i).length == 1)
                  const Expanded(child: SizedBox()),
              ],
            ),
          if (pages > 1)
            Row(
              children: [
                TextButton(
                  onPressed: page <= 0
                      ? null
                      : () => setState(() => pickerPage[key] = page - 1),
                  child: const Text('◀ Prev'),
                ),
                Expanded(
                  child: Text(
                    '${page + 1} / $pages',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Vc.muted, fontSize: 12),
                  ),
                ),
                TextButton(
                  onPressed: page >= pages - 1
                      ? null
                      : () => setState(() => pickerPage[key] = page + 1),
                  child: const Text('Next ▶'),
                ),
              ],
            ),
          ListTile(
            dense: true,
            enabled: !locked,
            contentPadding: EdgeInsets.zero,
            title: const Text(
              'Custom model…',
              style: TextStyle(color: Vc.green),
            ),
            onTap: locked ? null : () => unawaited(_customModel(ev)),
          ),
        ],
      ),
    );
  }

  String _fmtTokens(int n) {
    if (n < 1000) return '$n';
    if (n < 10000) return '${(n / 1000).toStringAsFixed(1)}k';
    if (n < 1000000) return '${(n / 1000).round()}k';
    return '${(n / 1000000).toStringAsFixed(1)}m';
  }

  String? get _usageText {
    if (usageLabel != null && usageLabel!.trim().isNotEmpty) return usageLabel;
    if (usageUsed != null && usageMax != null) {
      return '${_fmtTokens(usageUsed!)} / ${_fmtTokens(usageMax!)}';
    }
    return null;
  }

  String _fmtClock(Duration d) {
    final m = d.inMinutes;
    final s = d.inSeconds % 60;
    if (d.inHours > 0) return '${d.inHours}h ${m % 60}m';
    if (m > 0) return '${m}m ${s.toString().padLeft(2, '0')}s';
    return '${s}s';
  }

  String? get _headerClock {
    if (working) {
      final bits = <String>[_fmtClock(elapsed)];
      if (etaMs != null && etaMs! > 0) {
        bits.add('~${_fmtClock(Duration(milliseconds: etaMs!))} left');
      }
      if (toolCount > 0) {
        bits.add('$toolCount tool${toolCount == 1 ? '' : 's'}');
      }
      return bits.join(' · ');
    }
    if (lastTurnElapsed != null) return _fmtClock(lastTurnElapsed!);
    return null;
  }

  String? get _sandboxId => inst?.sandboxId ?? widget.instance?.sandboxId;

  String? _latestPreviewUrl() {
    for (final ev in events.reversed) {
      if (ev.text.isEmpty) continue;
      final found = extractPreviewUrls(ev.text);
      if (found.isNotEmpty) return found.last;
    }
    final sid = _sandboxId;
    if (sid != null && sid.isNotEmpty) {
      return buildPreviewUrl(sandboxId: sid, port: 3000);
    }
    return null;
  }

  bool _handleHref(String href) {
    if (!isPreviewUrl(href) &&
        !href.contains('localhost') &&
        !href.contains('127.0.0.1')) {
      return false;
    }
    final sid = _sandboxId;
    final url = isPreviewUrl(href) ? href : rewriteLocalhostUrls(href, sid);
    _openPreview(url);
    return true;
  }

  String get _computerTaskTitle {
    for (var i = events.length - 1; i >= 0; i--) {
      final e = events[i];
      if (e.isUser && e.text.trim().isNotEmpty) return e.text.trim();
    }
    return computer.peekLabel;
  }

  void _openComputer() {
    if (_computerOpen) return;
    _computerOpen = true;
    _syncBrowserStream();
    Navigator.of(context)
        .push(
          PageRouteBuilder<void>(
            fullscreenDialog: true,
            pageBuilder: (ctx, anim, sec) => ComputerPage(
              state: computer,
              instanceName: instanceName,
              onClose: () => Navigator.of(ctx).pop(),
              onSelectTab: (tab) {
                computer.tab = tab;
                if (tab == 'browser') _syncBrowserStream();
              },
              onRunCommand: _runComputerCommand,
              onBrowserHandoff: _isSupercharge ? _openBrowserHandoff : null,
            ),
            transitionsBuilder: (ctx, anim, sec, child) {
              return FadeTransition(opacity: anim, child: child);
            },
          ),
        )
        .whenComplete(() {
          _computerOpen = false;
          if (mounted) _syncBrowserStream();
        });
  }

  Future<void> _runComputerCommand(String command) async {
    final cmd = command.trim();
    if (cmd.isEmpty) return;
    computer.apply(
      AppChatEvent({
        'type': 'computer',
        'tab': 'terminal',
        'kind': 'shell',
        'state': 'start',
        'command': cmd,
        'label': cmd,
      }),
    );
    try {
      final result = await api.exec(id, command: cmd);
      computer.apply(
        AppChatEvent({
          'type': 'computer',
          'tab': 'terminal',
          'kind': 'shell',
          'state': 'done',
          'command': cmd,
          'stdout': [
            result.stdout,
            result.stderr,
          ].where((s) => s.trim().isNotEmpty).join('\n'),
          'exitCode': result.exitCode,
          'success': result.ok,
        }),
      );
    } catch (e) {
      computer.apply(
        AppChatEvent({
          'type': 'computer',
          'tab': 'terminal',
          'kind': 'shell',
          'state': 'done',
          'command': cmd,
          'stdout': e.toString(),
          'success': false,
        }),
      );
    }
  }

  Future<void> _openBrowserHandoff() async {
    if (_browserViewerOpen) return;
    computer.tab = 'browser';
    _syncBrowserStream();
    _browserViewerOpen = true;
    try {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => BrowserHandoffScreen(
            api: api,
            instanceId: id,
            onContinue: _sendBrowserContinuation,
          ),
        ),
      );
    } finally {
      _browserViewerOpen = false;
      if (mounted) _syncBrowserStream();
    }
  }

  Future<void> _sendBrowserContinuation(String prompt) async {
    final text = prompt.trim();
    if (text.isEmpty) return;
    if (working || sending || showKickoff) {
      setState(_endTurn);
    }
    await _send(text);
  }

  void _openPreview([String? url]) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PreviewBrowserScreen(
          instanceName: instanceName,
          initialUrl: url ?? _latestPreviewUrl(),
          sandboxId: _sandboxId,
          resolvePort: (port) => api.previewHost(id, port: port),
        ),
      ),
    );
  }

  Color get _usageColor {
    final p = usagePct ?? 0;
    if (p >= 90) return Vc.red;
    if (p >= 75) return Vc.amber;
    return Vc.muted;
  }

  Widget _commandOverlay() {
    final filtered = filterCommands(commands, _input.text);
    return Material(
      color: Vc.card,
      elevation: 8,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 240),
        child: ListView(
          shrinkWrap: true,
          padding: EdgeInsets.zero,
          children: [
            for (final c in filtered)
              ListTile(
                dense: true,
                visualDensity: VisualDensity.compact,
                minVerticalPadding: 0,
                title: Text(
                  c.slash,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                subtitle: Text(
                  c.description,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Vc.muted, fontSize: 11),
                ),
                onTap: () => _pickCommand(c),
              ),
            if (filtered.isEmpty)
              const ListTile(
                dense: true,
                title: Text(
                  'No matching commands',
                  style: TextStyle(color: Vc.muted),
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cliInfo = CliVersion.fromJson(cli, runtime: runtime.apiValue);
    final updateReady = cliInfo.updateAvailable && !hideCliUpdate;
    final palette = showCommandPalette(_input.text);
    final body = AppScaffold(
      currentInstanceId: id,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              instanceName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.3,
              ),
            ),
            if (_headerClock != null)
              Text(
                _headerClock!,
                style: TextStyle(
                  color: working ? Vc.greenSoft : Vc.muted,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
          ],
        ),
        actions: [
          if (_usageText != null)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(
                child: Tooltip(
                  message: usagePct != null
                      ? 'Context $usagePct% of model window'
                      : 'Context usage',
                  child: Text(
                    usagePct != null ? '$_usageText · $usagePct%' : _usageText!,
                    style: TextStyle(
                      color: _usageColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          IconButton(
            tooltip: 'Files',
            onPressed: () => context.push('/instance/$id/files', extra: inst),
            icon: const Icon(Icons.folder_open),
          ),
          IconButton(
            tooltip: 'Preview',
            onPressed: () => _openPreview(),
            icon: const Icon(Icons.language),
          ),
          IconButton(
            tooltip: 'Control',
            onPressed: () => context.push('/instance/$id', extra: inst),
            icon: const Icon(Icons.tune),
          ),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              if (updateReady)
                CliUpdateNote(
                  info: cliInfo,
                  busy: sending || working,
                  onUpdate: () => unawaited(_runCliUpdate()),
                  onDismiss: () => unawaited(_dismissCliUpdate()),
                ),
              if (reconnecting) const ReconnectBar(),
              if (error != null)
                ErrorBanner(
                  message: error!,
                  onRetry: _boot,
                  onDismiss: () => setState(() => error = null),
                ),
              Expanded(
                child: paymentBlocked
                    ? EmptyState(
                        icon: Icons.lock_outline,
                        title: 'Subscription needed',
                        detail:
                            'Renew this instance to keep chatting with the sandbox.',
                      )
                    : events.isEmpty && !connecting && !showKickoff
                    ? const EmptyState(
                        icon: Icons.chat_bubble_outline,
                        title: 'What should we work on?',
                        detail:
                            'Ask anything. Attach a file or type / for commands.',
                      )
                    : Builder(
                        builder: (ctx) {
                          final groups = _grouped();
                          return ListView.builder(
                            controller: _scroll,
                            reverse: true,
                            padding: const EdgeInsets.only(bottom: 8, top: 8),
                            itemCount: groups.length,
                            itemBuilder: (ctx, i) {
                              final logical = groups.length - 1 - i;
                              final batch = groups[logical];
                              if (batch.first.type == 'tool') {
                                final lastGroup = logical == groups.length - 1;
                                return ToolFold(
                                  tools: batch,
                                  expanded: working && lastGroup,
                                );
                              }
                              return _bubble(batch.first);
                            },
                          );
                        },
                      ),
              ),
              if (pending.isNotEmpty)
                DraftTray(
                  items: pending,
                  onRemove: (f) => setState(() => pending.remove(f)),
                  onOpen: _openDraft,
                ),
              if (palette) _commandOverlay(),
              if (paymentBlocked)
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: FilledButton(
                      onPressed: () => context.push(
                        '/billing',
                        extra: BillingArgs(instanceId: id),
                      ),
                      child: const Text('Renew subscription'),
                    ),
                  ),
                )
              else
                SafeArea(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ListenableBuilder(
                        listenable: computer,
                        builder: (context, _) => ComputerBar(
                          state: computer,
                          title: _computerTaskTitle,
                          onOpen: _openComputer,
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if ((working || showKickoff) &&
                                !events.any(
                                  (e) =>
                                      e.type == 'progress' &&
                                      e.text.trim().isNotEmpty,
                                ))
                              const Padding(
                                padding: EdgeInsets.fromLTRB(8, 0, 8, 8),
                                child: Text(
                                  'Thinking…',
                                  style: TextStyle(
                                    color: Vc.muted,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            Container(
                              decoration: BoxDecoration(
                                color: Vc.elevated,
                                borderRadius: BorderRadius.circular(26),
                                border: Border.all(color: Vc.cardBorder),
                              ),
                              padding: const EdgeInsets.fromLTRB(4, 4, 4, 4),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  IconButton(
                                    tooltip: 'Attach',
                                    onPressed: sending ? null : _attach,
                                    icon: const Icon(
                                      Icons.add,
                                      color: Vc.muted,
                                      size: 22,
                                    ),
                                  ),
                                  Expanded(
                                    child: TextField(
                                      controller: _input,
                                      minLines: 1,
                                      maxLines: 6,
                                      textInputAction: TextInputAction.newline,
                                      decoration: const InputDecoration(
                                        hintText: 'Message',
                                        border: InputBorder.none,
                                        enabledBorder: InputBorder.none,
                                        focusedBorder: InputBorder.none,
                                        filled: false,
                                        contentPadding: EdgeInsets.fromLTRB(
                                          0,
                                          10,
                                          8,
                                          10,
                                        ),
                                      ),
                                    ),
                                  ),
                                  IconButton(
                                    tooltip: 'Commands',
                                    onPressed: _commands,
                                    icon: const Icon(
                                      Icons.alternate_email,
                                      color: Vc.muted,
                                      size: 20,
                                    ),
                                  ),
                                  Material(
                                    color:
                                        sending ||
                                            (_input.text.trim().isEmpty &&
                                                pending.isEmpty)
                                        ? Vc.card
                                        : Colors.white,
                                    shape: const CircleBorder(),
                                    child: IconButton(
                                      onPressed:
                                          sending ||
                                              (_input.text.trim().isEmpty &&
                                                  pending.isEmpty)
                                          ? null
                                          : () => _send(),
                                      icon: sending
                                          ? const SizedBox(
                                              width: 16,
                                              height: 16,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Vc.muted,
                                              ),
                                            )
                                          : Icon(
                                              Icons.arrow_upward_rounded,
                                              size: 20,
                                              color:
                                                  sending ||
                                                      (_input.text
                                                              .trim()
                                                              .isEmpty &&
                                                          pending.isEmpty)
                                                  ? Vc.faint
                                                  : Colors.black,
                                            ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          if (!pinnedToLatest && events.isNotEmpty)
            Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 112),
                child: Material(
                  color: Vc.elevated,
                  borderRadius: BorderRadius.circular(999),
                  elevation: 4,
                  child: InkWell(
                    onTap: _jumpToLatest,
                    borderRadius: BorderRadius.circular(999),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.arrow_downward, size: 16, color: Vc.green),
                          SizedBox(width: 6),
                          Text(
                            'Jump to latest',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          if (connecting && events.isEmpty)
            BusyOverlay(
              message: connectLabel,
              detail: 'Waking the VM and opening the chat inbox',
            ),
        ],
      ),
    );
    if (isDesktop) return body;
    return WithForegroundTask(child: body);
  }
}
