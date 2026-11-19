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
import '../desktop/native.dart';
import '../desktop/shortcuts.dart';
import '../desktop/chat_workspace.dart';
import '../api/models.dart';
import '../chat/chat_store.dart';
import '../chat/bot_profile.dart';
import '../chat/bot_avatar.dart';
import '../chat/group_thread.dart';
import '../chat/github_auth_dialog.dart';
import '../desktop/shell.dart';
import '../chat/cli_update.dart';
import '../chat/commands.dart';
import '../chat/draft.dart';
import '../chat/event_stream.dart';
import '../chat/notifications.dart';
import '../chat/computer.dart';
import '../chat/roster.dart';
import '../chat/preview_urls.dart';
import '../screens/browser_handoff.dart';
import '../screens/preview.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/file_viewer.dart';
import '../widgets/background_tasks.dart';
import '../widgets/markdown.dart';
import '../widgets/computer_pane.dart';
import '../widgets/media.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.instanceId,
    this.instance,
    this.initialBotId,
    this.initialSessionId,
    this.showGroup = false,
  });
  final String instanceId;
  final CloudInstance? instance;
  final String? initialBotId;
  final String? initialSessionId;
  final bool showGroup;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatSwitchOrigin {
  const _ChatSwitchOrigin({
    required this.sessionId,
    required this.bot,
    required this.events,
    required this.answered,
    required this.cursor,
    required this.draft,
    required this.attachments,
    required this.startedAt,
    required this.sending,
    required this.queued,
  });

  final String? sessionId;
  final BotProfile? bot;
  final List<AppChatEvent> events;
  final Set<String> answered;
  final String? cursor;
  final String draft;
  final List<DraftAttach> attachments;
  final DateTime? startedAt;
  final bool sending;
  final bool queued;
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _input = TextEditingController();
  final _inputFocus = FocusNode();
  final _find = TextEditingController();
  final _findFocus = FocusNode();
  bool _findOpen = false;
  bool _desktopComputer = true;
  final _scroll = ScrollController();
  final events = <AppChatEvent>[];
  final answered = <String>{};
  final fetching = <String>{};
  late final ChatStore store;
  final bots = <BotProfile>[];
  BotProfile? selectedBot;
  final botRunning = <String>{};
  final botQueued = <String>{};
  final botUnread = <String>{};
  final _botByChat = <String, String>{};
  Timer? _botsRefresh;
  final _lastBotPreview = <String, String>{};
  final _lastBotActivity = <String, int>{};
  bool _chatQueued = false;
  bool _contactThreadLoading = false;
  bool _phoneContactsOpen = false;
  bool _groupOpen = false;
  final _contactsSearch = TextEditingController();
  bool _initialSelectionApplied = false;
  int _switchGeneration = 0;
  String? _openingBotId;
  bool _switchingBot = false;
  _ChatSwitchOrigin? _switchOrigin;
  final _botDrafts = <String, (String, List<DraftAttach>)>{};
  final _seenBotMessages = <String, String>{};
  final _latestBotMessages = <String, String>{};
  StreamSubscription<AppChatEvent>? _sub;
  EventStreamCancellation? _eventCancellation;
  int _eventGeneration = 0;
  bool _statusPolling = false;
  bool _botStatusPolling = false;
  String _botStatusSig = '';
  int _botStatusGeneration = 0;
  int _catalogueGeneration = 0;
  final backgroundTasks = <String, Map<String, dynamic>>{};
  StreamSubscription<ComputerFrame>? _browserSub;
  EventStreamCancellation? _browserCancellation;
  int _browserGeneration = 0;
  String? _browserTarget;
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
  final List<AppChatEvent> _pendingEvents = [];
  bool _flushScheduled = false;
  List<List<AppChatEvent>>? _groupsCache;
  int _groupsStamp = 0;
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
  bool get _botsEnabled => _isSupercharge && bots.isNotEmpty;
  String get _selectedBotId => selectedBot?.id ?? 'main';
  String? get _botScope =>
      _botsEnabled && store.activeSessionId != null ? _selectedBotId : null;
  String? get _chatScope => _botsEnabled ? store.activeSessionId : null;
  String? get _desktopBotTarget =>
      _botsEnabled ? (_groupOpen ? 'main' : _selectedBotId) : null;
  String? get _desktopChatTarget => _groupOpen ? null : _chatScope;
  String get _selectedBotName => selectedBot?.name ?? 'Main';
  String _botPreview(BotProfile bot) =>
      _lastBotPreview[bot.id] ??
      store.conversations
          .where((item) => item.botId == bot.id)
          .firstOrNull
          ?.title ??
      (bot.isMain ? 'Your main assistant' : 'Start a conversation');
  bool _botActive(BotProfile bot) => botRunning.any(
    (chatId) =>
        _botByChat[chatId] == bot.id ||
        store.conversations.any(
          (item) => item.sessionId == chatId && item.botId == bot.id,
        ),
  );
  bool _botWaiting(BotProfile bot) => botQueued.any(
    (chatId) =>
        _botByChat[chatId] == bot.id ||
        store.conversations.any(
          (item) => item.sessionId == chatId && item.botId == bot.id,
        ),
  );
  int _botUnread(BotProfile bot) => botUnread
      .where(
        (chatId) =>
            _botByChat[chatId] == bot.id ||
            store.conversations.any(
              (item) => item.sessionId == chatId && item.botId == bot.id,
            ),
      )
      .length;

  Duration get elapsed => turnStartedAt == null
      ? Duration.zero
      : DateTime.now().difference(turnStartedAt!);

  int get progressPct =>
      TaskNotifications.softPercent(tools: toolCount, elapsed: elapsed);

  _ChatSwitchOrigin _captureSwitchOrigin() => _ChatSwitchOrigin(
    sessionId: store.activeSessionId,
    bot: selectedBot,
    events: List<AppChatEvent>.of(events),
    answered: Set<String>.of(answered),
    cursor: lastServerId,
    draft: _input.text,
    attachments: List<DraftAttach>.of(pending),
    startedAt: turnStartedAt,
    sending: sending,
    queued: _chatQueued,
  );

  void _restoreSwitchOrigin(_ChatSwitchOrigin origin) {
    selectedBot = origin.bot;
    events
      ..clear()
      ..addAll(origin.events);
    answered
      ..clear()
      ..addAll(origin.answered);
    lastServerId = origin.cursor;
    turnStartedAt = origin.startedAt;
    sending = origin.sending;
    _chatQueued = origin.queued;
    _input.text = origin.draft;
    pending
      ..clear()
      ..addAll(origin.attachments);
    _switchBrowserTarget(_desktopBotTarget);
    computer.replay(events);
    _switchingBot = false;
    _contactThreadLoading = false;
    _openingBotId = null;
    _switchOrigin = null;
  }

  @override
  void initState() {
    super.initState();
    store = ChatStore(id);
    _groupOpen = widget.showGroup;
    _phoneContactsOpen = widget.showGroup && !isDesktop;
    _contactsSearch.addListener(() {
      if (mounted) setState(() {});
    });
    if (isDesktop) DesktopNative.onFilesDropped = _dropFiles;
    WidgetsBinding.instance.addObserver(this);
    _scroll.addListener(_onUserScroll);
    _input.addListener(() {
      if (mounted) setState(() {});
    });
    _boot();
  }

  @override
  void didUpdateWidget(ChatScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialBotId != widget.initialBotId ||
        oldWidget.initialSessionId != widget.initialSessionId ||
        oldWidget.showGroup != widget.showGroup) {
      if (widget.showGroup) {
        _switchBrowserTarget(_botsEnabled ? 'main' : null);
        setState(() {
          _groupOpen = true;
          _phoneContactsOpen = false;
        });
        _syncBrowserStream();
      } else if (widget.initialBotId != null) {
        final bot = bots
            .where((bot) => bot.id == widget.initialBotId)
            .firstOrNull;
        if (bot != null) unawaited(_openAgent(bot, widget.initialSessionId));
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (isDesktop) {
      backgrounded = state != AppLifecycleState.resumed;
      if (!backgrounded) {
        unawaited(_refreshBots());
        unawaited(_pollBotStatus());
      }
      _syncBrowserStream();
      return;
    }
    if (state == AppLifecycleState.resumed) {
      backgrounded = false;
      unawaited(TaskNotifications.leaveBackground());
      unawaited(_catchUp());
      if (_isSupercharge) unawaited(_refreshBots());
      unawaited(
        context.read<SessionController>().workspaces.refresh(force: false),
      );
      _syncBrowserStream();
      return;
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      backgrounded = true;
      _stopBrowserStream();
      if (working) {
        unawaited(TaskNotifications.enterBackground());
      } else {
        _eventCancellation?.cancel();
        _eventGeneration += 1;
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
    if (!mounted) return;
    final cachedBot = store.conversations
        .where((item) => item.sessionId == snap.sessionId)
        .firstOrNull
        ?.botId;
    final requestedBotMatches =
        widget.initialBotId == null || cachedBot == widget.initialBotId;
    if (snap.events.isNotEmpty && requestedBotMatches && !_groupOpen) {
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
    if (_isSupercharge) await _refreshBots();
    if (_botsEnabled) {
      unawaited(_pollBotStatus());
      await _refreshConversations();
      var chat = store.conversations
          .where(
            (item) =>
                item.botId == _selectedBotId &&
                (widget.initialSessionId != null || item.source != 'group') &&
                item.sessionId ==
                    (widget.initialSessionId ?? store.activeSessionId),
          )
          .firstOrNull;
      chat ??= store.conversations
          .where(
            (item) => item.botId == _selectedBotId && item.source != 'group',
          )
          .firstOrNull;
      if (chat == null) {
        try {
          final created = await api.startNewConversation(
            id,
            botId: _selectedBotId,
          );
          final rows = (created['conversations'] as List? ?? const [])
              .whereType<Map>()
              .map(
                (raw) =>
                    ConversationMeta.fromJson(Map<String, dynamic>.from(raw)),
              )
              .toList();
          await store.mergeRemote(rows, selectActive: false);
          chat = rows
              .where((item) => item.sessionId == created['active'])
              .firstOrNull;
        } catch (failure) {
          if (mounted) setState(() => error = failure.toString());
        }
      }
      if (chat != null) {
        await _openConversation(chat);
      }
      _initialSelectionApplied = true;
    } else {
      unawaited(_hydrateFromRemote());
      _listen();
    }
    if (!mounted || _switchingBot) return;
    api
        .commands(id)
        .then((c) {
          if (mounted && c.isNotEmpty) setState(() => commands = c);
        })
        .catchError((_) {});
    unawaited(_pollTurnStatus());
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
    if (_botsEnabled) {
      _botsRefresh?.cancel();
      _botsRefresh = Timer.periodic(const Duration(seconds: 6), (_) {
        if (backgrounded || disposed || inst?.isPaused == true) return;
        unawaited(_refreshBots());
        unawaited(_pollBotStatus());
      });
    }
    if (isDesktop) _syncBrowserStream();
  }

  Future<void> _refreshBots() async {
    if (!_isSupercharge || disposed) return;
    final generation = ++_catalogueGeneration;
    try {
      final raw = await api.listBots(id);
      final list = (raw['bots'] as List?) ?? const [];
      final remote = list
          .whereType<Map>()
          .map((item) => BotProfile.fromJson(Map<String, dynamic>.from(item)))
          .where((bot) => bot.id.isNotEmpty)
          .toList();
      if (!mounted || generation != _catalogueGeneration) return;
      final same =
          remote.length == bots.length &&
          [
            for (var i = 0; i < remote.length; i++)
              remote[i].id == bots[i].id && remote[i].name == bots[i].name,
          ].every((ok) => ok);
      if (same && selectedBot != null) {
        context.read<SessionController>().agents.update(id, bots);
        return;
      }
      setState(() {
        bots
          ..clear()
          ..addAll(remote);
        final current =
            (!_initialSelectionApplied ? widget.initialBotId : null) ??
            selectedBot?.id ??
            (store.conversations
                    .where((c) => c.sessionId == store.activeSessionId)
                    .firstOrNull
                    ?.botId ??
                'main');
        selectedBot =
            remote.where((bot) => bot.id == current).firstOrNull ??
            selectedBot ??
            remote.where((bot) => bot.isMain).firstOrNull;
      });
      context.read<SessionController>().agents.update(id, bots);
    } on ApiException catch (failure) {
      if (failure.status != 404 &&
          mounted &&
          bots.isEmpty &&
          generation == _catalogueGeneration) {
        setState(() => error = failure.message);
      }
    } catch (failure) {
      if (mounted && bots.isEmpty && generation == _catalogueGeneration) {
        setState(() => error = failure.toString());
      }
    }
  }

  Future<void> _pollBotStatus() async {
    if (!_botsEnabled || disposed || backgrounded || _botStatusPolling) return;
    _botStatusPolling = true;
    final generation = ++_botStatusGeneration;
    try {
      final raw = await api.chatStatus(id);
      if (!mounted ||
          disposed ||
          backgrounded ||
          generation != _botStatusGeneration) {
        return;
      }
      final active = ((raw['activeBotChats'] as List?) ?? const [])
          .map((item) => '$item')
          .toSet();
      final queued = ((raw['queuedBotChats'] as List?) ?? const [])
          .map((item) => '$item')
          .toSet();
      final convos = ((raw['conversations'] as List?) ?? const [])
          .whereType<Map>()
          .map(
            (item) =>
                '${item['sessionId']}:${item['lastMessageId']}:${item['updatedAt']}:${item['lastMessage']}',
          )
          .join(';');
      final sig = '${active.join(',')}|${queued.join(',')}|$convos';
      if (sig == _botStatusSig) return;
      _botStatusSig = sig;
      setState(() {
        botRunning
          ..clear()
          ..addAll(active);
        botQueued
          ..clear()
          ..addAll(queued);
        for (final item
            in ((raw['conversations'] as List?) ?? const []).whereType<Map>()) {
          final chat = '${item['sessionId'] ?? ''}';
          final owner = '${item['botId'] ?? ''}';
          if (chat.isNotEmpty && owner.isNotEmpty) _botByChat[chat] = owner;
          final preview = '${item['lastMessage'] ?? ''}'.trim();
          final existing = _lastBotActivity[owner] ?? 0;
          final updated = (item['updatedAt'] as num?)?.toInt() ?? 0;
          if (owner.isNotEmpty && preview.isNotEmpty && updated >= existing) {
            _lastBotActivity[owner] = updated;
            _lastBotPreview[owner] = preview;
          }
          final last = '${item['lastMessageId'] ?? ''}';
          if (chat.isNotEmpty && last.isNotEmpty) {
            _latestBotMessages[chat] = last;
            if (chat == store.activeSessionId && !_switchingBot) {
              _seenBotMessages[chat] = last;
              botUnread.remove(chat);
            } else if (_seenBotMessages[chat] == null) {
              _seenBotMessages[chat] = last;
            } else if (_seenBotMessages[chat] != last) {
              botUnread.add(chat);
            }
          }
        }
      });
      context.read<SessionController>().agents.updateActivity(id, [
        for (final chat in active)
          {
            'botId':
                _botByChat[chat] ??
                store.conversations
                    .where((c) => c.sessionId == chat)
                    .firstOrNull
                    ?.botId,
            'sessionId': chat,
            'state': 'working',
          },
        for (final chat in queued)
          {
            'botId':
                _botByChat[chat] ??
                store.conversations
                    .where((c) => c.sessionId == chat)
                    .firstOrNull
                    ?.botId,
            'sessionId': chat,
            'state': 'queued',
          },
      ], previews: _lastBotPreview);
      if (!_switchingBot) unawaited(_refreshConversations());
    } on Object {
      return;
    } finally {
      _botStatusPolling = false;
    }
  }

  void _listen() {
    _eventCancellation?.cancel();
    _sub?.cancel();
    final generation = ++_eventGeneration;
    final cancellation = EventStreamCancellation();
    _eventCancellation = cancellation;
    _sub = _eventLoop(generation, cancellation).listen(
      (ev) {
        if (!mounted || generation != _eventGeneration) return;
        _pendingEvents.add(ev);
        if (_flushScheduled) return;
        _flushScheduled = true;
        WidgetsBinding.instance.scheduleFrameCallback((_) {
          _flushScheduled = false;
          if (!mounted || generation != _eventGeneration) return;
          final batch = List<AppChatEvent>.of(_pendingEvents);
          _pendingEvents.clear();
          if (batch.isEmpty) return;
          setState(() {
            connecting = false;
            reconnecting = false;
            for (final event in batch) {
              _ingest(event);
            }
          });
          if (pinnedToLatest) _scrollToEnd(instant: true);
        });
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

  void _switchBrowserTarget(String? target) {
    if (_browserTarget == target) return;
    _stopBrowserStream();
    _browserTarget = target;
    computer.clear();
  }

  void _syncBrowserStream() {
    _switchBrowserTarget(_desktopBotTarget);
    final want =
        !disposed &&
        !backgrounded &&
        !_switchingBot &&
        !_browserViewerOpen &&
        !paymentBlocked &&
        (_computerOpen ||
            (isDesktop && _desktopComputer) ||
            computer.isBrowser ||
            computer.live ||
            working);
    if (want) {
      _listenBrowser();
    } else {
      _stopBrowserStream();
    }
  }

  void _stopBrowserStream() {
    _browserCancellation?.cancel();
    _browserCancellation = null;
    _browserGeneration++;
    unawaited(_browserSub?.cancel());
    _browserSub = null;
    _browserListening = false;
    _liveTick?.cancel();
    _liveTick = null;
  }

  void _listenBrowser() {
    if (_browserListening) return;
    _browserListening = true;
    _liveTick?.cancel();
    _liveTick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      _checkLivePause();
    });
    _browserCancellation?.cancel();
    unawaited(_browserSub?.cancel());
    final cancellation = EventStreamCancellation();
    _browserCancellation = cancellation;
    final generation = ++_browserGeneration;
    _browserSub = _browserLoop(generation, cancellation, _browserTarget).listen(
      (frame) {
        if (!mounted || generation != _browserGeneration) return;
        if (frame.type == 'frame' &&
            frame.bytes != null &&
            frame.bytes!.isNotEmpty) {
          computer.setLiveFrame(frame.bytes!);
        } else if (frame.type == 'status') {
          computer.setDesktopAvailable(frame.desktop == true);
          computer.setLiveStatus(
            connected: frame.connected,
            screencasting: frame.screencasting,
          );
        }
      },
      onError: (_) {
        if (generation != _browserGeneration) return;
        _browserListening = false;
        if (mounted) setState(computer.markLivePaused);
      },
      onDone: () {
        if (generation == _browserGeneration) _browserListening = false;
      },
    );
  }

  Stream<ComputerFrame> _browserLoop(
    int generation,
    EventStreamCancellation cancellation,
    String? botId,
  ) async* {
    var delay = 1;
    while (!disposed &&
        generation == _browserGeneration &&
        !cancellation.isCancelled) {
      try {
        await for (final frame in api.browserFrames(
          id,
          botId: botId,
          cancellation: cancellation,
        )) {
          if (generation != _browserGeneration || cancellation.isCancelled) {
            return;
          }
          delay = 1;
          yield frame;
        }
      } catch (_) {}
      if (disposed ||
          generation != _browserGeneration ||
          cancellation.isCancelled) {
        return;
      }
      await Future<void>.delayed(Duration(seconds: delay));
      if (delay < 8) delay *= 2;
    }
  }

  bool _isServerSeq(String? value) =>
      value != null && value.isNotEmpty && RegExp(r'^\d+$').hasMatch(value);

  Stream<AppChatEvent> _eventLoop(
    int generation,
    EventStreamCancellation cancellation,
  ) async* {
    var delay = 1;
    var connectedBefore = false;
    bool active() =>
        !disposed &&
        generation == _eventGeneration &&
        !cancellation.isCancelled;
    while (active()) {
      try {
        var receivedReady = false;
        await for (final ev in api.events(
          id,
          since: _isServerSeq(lastServerId) ? lastServerId : null,
          botId: _botScope,
          chatId: _chatScope,
          cancellation: cancellation,
        )) {
          if (!active()) return;
          delay = 1;
          if (ev.type == 'ready' && !receivedReady) {
            receivedReady = true;
            if (connectedBefore || ev.raw['resync'] == true) {
              unawaited(_pollTurnStatus());
              unawaited(_hydrateFromRemote());
            }
            connectedBefore = true;
          }
          yield ev;
        }
      } on ApiException catch (e) {
        if (!active()) return;
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
        if (!active()) return;
        if (!disposed && mounted && connecting && events.isEmpty) {
          setState(() {
            error = e.toString();
            connecting = false;
          });
        } else if (!disposed && mounted && !backgrounded) {
          setState(() => reconnecting = true);
        }
      }
      if (!active()) return;
      if (mounted && !backgrounded) setState(() => reconnecting = true);
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
    if (!ev.local) {
      final next = nextEventCursor(lastServerId, ev.id);
      if (next != lastServerId) {
        lastServerId = next;
        _persist();
      }
    }
    if (ev.type == 'ready' || ev.type == 'hello' || ev.type == 'ping') {
      return;
    }
    if (ev.type == 'bots') {
      unawaited(_refreshBots());
      return;
    }
    if (ev.type == 'conversation_created' || ev.type == 'bot_job') {
      unawaited(_refreshBots());
      unawaited(_refreshConversations());
      return;
    }
    if (ev.type == 'maintenance') {
      reconnecting = ev.raw['state'] != 'running';
      return;
    }
    if (ev.type == 'queued') {
      _chatQueued = true;
      botQueued.add(ev.sessionId ?? store.activeSessionId ?? '');
      return;
    }
    if (ev.type == 'resync') {
      unawaited(_pollTurnStatus());
      unawaited(_hydrateFromRemote());
      return;
    }
    if (ev.type == 'background') {
      final session = ev.sessionId;
      backgroundTasks.removeWhere((_, task) => task['sessionId'] == session);
      for (final task
          in (ev.raw['tasks'] as List? ?? const []).whereType<Map>()) {
        final value = Map<String, dynamic>.from(task);
        backgroundTasks['${value['sessionId']}:${value['taskId']}'] = value;
      }
      return;
    }
    if (ev.type == 'runtime') {
      if (ev.state == 'error') {
        error = ev.text.isEmpty
            ? 'Agent runtime stopped. Send a new message to reconnect.'
            : ev.text;
        unawaited(_pollTurnStatus());
      }
      return;
    }
    if (ev.type == 'snapshot') {
      _applyBackgroundSnapshot(ev.raw['backgroundTasks']);
      _chatQueued = ev.raw['queued'] == true;
      if (ev.busy == true) {
        turnStartedAt = (ev.startedAt ?? 0) > 0
            ? DateTime.fromMillisecondsSinceEpoch(ev.startedAt!)
            : (turnStartedAt ?? DateTime.now());
        toolCount = ev.tools ?? toolCount;
        computer.setAgentWorking(true);
      } else if (!_chatQueued && (working || sending)) {
        _endTurn();
      }
      return;
    }
    if (ev.type == 'conversation') {
      if (_botsEnabled) {
        unawaited(_refreshConversations());
        return;
      }
      unawaited(_applyConversationEvent(ev));
      return;
    }
    if (ev.type == 'status') {
      final busy = ev.busy == true;
      if (busy) {
        _chatQueued = false;
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
    if (!ev.local && _isServerSeq(ev.id) && _alreadyHave(ev)) return;
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
        final optimistic = events
            .where(
              (e) =>
                  e.type == 'user' &&
                  e.local &&
                  e.text.trim() == text &&
                  e.raw['messageId'] == null,
            )
            .lastOrNull;
        if (optimistic != null && ev.raw['messageId'] != null) {
          optimistic.raw['messageId'] = ev.raw['messageId'];
        }
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
      _chatQueued = false;
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
          if (_botsEnabled) _lastBotPreview[_selectedBotId] = ev.text.trim();
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
    if (_botsEnabled &&
        ev.text.trim().isNotEmpty &&
        (ev.type == 'text' || ev.type == 'user')) {
      _lastBotPreview[_selectedBotId] = ev.text.trim();
    }
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
    if (_switchingBot) return;
    final generation = _eventGeneration;
    final before = store.activeSessionId;
    await _refreshConversations();
    if (!mounted ||
        _switchingBot ||
        generation != _eventGeneration ||
        before != store.activeSessionId) {
      return;
    }
    final sid = store.activeSessionId;
    if (sid == null || sid.isEmpty) return;
    try {
      final remote = await api.getConversation(id, sid, botId: _botScope);
      final msgs = (remote['messages'] as List?) ?? const [];
      if (msgs.isEmpty ||
          !mounted ||
          generation != _eventGeneration ||
          sid != store.activeSessionId) {
        return;
      }
      var added = false;
      for (final m in msgs.whereType<Map>()) {
        final role = '${m['role'] ?? ''}';
        final content = m['content'];
        final text = content is String
            ? content
            : (content == null ? '' : content.toString());
        if (text.trim().isEmpty) continue;
        final type = role == 'user'
            ? 'user'
            : role == 'error'
            ? 'error'
            : 'text';
        final sensitive = m['sensitive'] == true;
        if (sensitive &&
            (_selectedBotId != 'github' ||
                _groupOpen ||
                !store.conversations.any(
                  (chat) =>
                      chat.sessionId == sid &&
                      chat.botId == 'github' &&
                      chat.source == 'direct',
                ))) {
          continue;
        }
        final messageId = '${m['id'] ?? ''}';
        final exists = events.any(
          (e) =>
              (type == 'user'
                  ? e.type == 'user'
                  : (e.type == 'text' || e.type == 'error')) &&
              (messageId.isNotEmpty && e.raw['messageId'] == messageId ||
                  e.raw['messageId'] == null && e.text.trim() == text.trim()),
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
            if (messageId.isNotEmpty) 'messageId': messageId,
            'ts': DateTime.now().millisecondsSinceEpoch,
          }),
        );
        added = true;
      }
      if (added && mounted) {
        final recent = events
            .where(
              (event) =>
                  event.text.trim().isNotEmpty &&
                  (event.type == 'text' || event.type == 'user'),
            )
            .lastOrNull;
        if (recent != null && _botsEnabled) {
          _lastBotPreview[_selectedBotId] = recent.text.trim();
        }
        setState(() {});
        _persist();
      }
    } catch (_) {}
  }

  void _applyBackgroundSnapshot(Object? raw) {
    if (raw is! List) return;
    backgroundTasks.clear();
    for (final task in raw.whereType<Map>()) {
      final value = Map<String, dynamic>.from(task);
      backgroundTasks['${value['sessionId']}:${value['taskId']}'] = value;
    }
  }

  Future<void> _pollTurnStatus() async {
    if (_statusPolling || disposed || _switchingBot) return;
    _statusPolling = true;
    try {
      final currentChat = _chatScope;
      final s = await api.chatStatus(id, sessionId: currentChat);
      if (!mounted || (_botsEnabled && currentChat != _chatScope)) return;
      final t = s['turn'];
      final busy = t is Map && t['busy'] == true;
      setState(() {
        _applyBackgroundSnapshot(s['backgroundTasks']);
        _chatQueued = t is Map && t['queued'] == true;
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
      if (!busy && !_chatQueued && working) {
        await _hydrateFromRemote();
        if (mounted && currentChat == _chatScope) setState(_endTurn);
      }
    } catch (_) {
      // The event stream owns reconnect; polling must not create another listener.
    } finally {
      _statusPolling = false;
    }
  }

  Future<void> _catchUp() async {
    await _pollTurnStatus();
    await _hydrateFromRemote();
    if (!mounted) return;
    _listen();
    _syncBrowserStream();
  }

  Future<void> _refreshConversations() async {
    if (_switchingBot) return;
    try {
      final botId = _botsEnabled ? _selectedBotId : null;
      final selected = store.activeSessionId;
      final generation = _switchGeneration;
      final raw = await api.listConversations(id, botId: botId);
      if (!mounted ||
          _switchingBot ||
          generation != _switchGeneration ||
          selected != store.activeSessionId ||
          (_botsEnabled && botId != _selectedBotId)) {
        return;
      }
      final active = raw['active'] as String?;
      final list = (raw['conversations'] as List?) ?? const [];
      final remote = list
          .whereType<Map>()
          .map((e) => ConversationMeta.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      if (!mounted ||
          _switchingBot ||
          generation != _switchGeneration ||
          selected != store.activeSessionId ||
          (_botsEnabled && botId != _selectedBotId)) {
        return;
      }
      await store.mergeRemote(
        remote,
        active: active,
        selectActive: !_botsEnabled,
      );
      if (mounted && !_switchingBot && generation == _switchGeneration) {
        setState(() {});
      }
    } catch (_) {}
  }

  Future<void> _openConversation(
    ConversationMeta item, {
    int? switchGeneration,
  }) async {
    if (switchGeneration == null && _switchingBot) return;
    if (working && !_botsEnabled) return;
    final expectedSwitch = switchGeneration ?? ++_switchGeneration;
    final origin = _switchOrigin ?? _captureSwitchOrigin();
    _switchOrigin = origin;
    _stopBrowserStream();
    _switchBrowserTarget(
      _botsEnabled ? (_groupOpen ? 'main' : item.botId) : null,
    );
    setState(() {
      _switchingBot = true;
      _contactThreadLoading = true;
      _openingBotId = item.botId;
      selectedBot =
          bots.where((bot) => bot.id == item.botId).firstOrNull ?? selectedBot;
      events.clear();
      answered.clear();
      lastServerId = null;
      sending = false;
      showKickoff = false;
      turnStartedAt = null;
      _chatQueued = botQueued.contains(item.sessionId);
      _input.clear();
      pending.clear();
      computer.clear();
    });
    final oldChat = origin.sessionId;
    _eventCancellation?.cancel();
    await _sub?.cancel();
    final generation = ++_eventGeneration;
    _tick?.cancel();
    if (!mounted || expectedSwitch != _switchGeneration) return;
    try {
      if (oldChat != null) {
        await store.save(
          events: origin.events,
          answered: origin.answered,
          lastServerId: origin.cursor,
          sessionId: oldChat,
        );
      }
      if (oldChat != null) {
        _botDrafts[oldChat] = (origin.draft, origin.attachments);
      }
      if (!_botsEnabled) await api.switchConversation(id, item.sessionId);
      final snap = await store.load(
        sessionId: item.sessionId,
        fallbackToLegacy: !_botsEnabled,
      );
      if (!mounted ||
          generation != _eventGeneration ||
          expectedSwitch != _switchGeneration) {
        return;
      }
      await store.selectConversation(item.sessionId);
      if (!mounted ||
          generation != _eventGeneration ||
          expectedSwitch != _switchGeneration) {
        return;
      }
      setState(() {
        selectedBot =
            bots.where((bot) => bot.id == item.botId).firstOrNull ??
            selectedBot;
        events
          ..clear()
          ..addAll(snap.events);
        answered
          ..clear()
          ..addAll(snap.answered);
        lastServerId = _isServerSeq(snap.lastServerId)
            ? snap.lastServerId
            : null;
        botUnread.remove(item.sessionId);
        if (_latestBotMessages[item.sessionId] case final last?) {
          _seenBotMessages[item.sessionId] = last;
        }
        _chatQueued = botQueued.contains(item.sessionId);
        turnStartedAt = botRunning.contains(item.sessionId)
            ? DateTime.now()
            : null;
        sending = false;
        showKickoff = false;
        lastAssistantText = null;
        toolCount = 0;
        final draft = _botDrafts[item.sessionId];
        _input.text = draft?.$1 ?? '';
        pending
          ..clear()
          ..addAll(draft?.$2 ?? const []);
        computer.clear();
        computer.replay(events);
        _switchingBot = false;
        _contactThreadLoading = false;
        _openingBotId = null;
        _switchOrigin = null;
      });
      _listen();
      _syncBrowserStream();
      await _hydrateFromRemote();
      await _pollTurnStatus();
    } catch (failure) {
      if (!mounted || expectedSwitch != _switchGeneration) return;
      setState(() {
        _restoreSwitchOrigin(origin);
        error = failure.toString();
      });
      _listen();
      _syncBrowserStream();
    } finally {
      if (mounted && expectedSwitch == _switchGeneration && _switchingBot) {
        setState(() {
          _switchingBot = false;
          _contactThreadLoading = false;
          _openingBotId = null;
          _switchOrigin = null;
        });
      }
    }
  }

  Future<void> _editBot([BotProfile? bot]) async {
    final name = TextEditingController(text: bot?.name ?? '');
    final folder = TextEditingController(text: bot?.defaultFolder ?? '');
    final instructions = TextEditingController(text: bot?.instructions ?? '');
    var icon = bot?.icon ?? '🤖';
    Uint8List? avatarBytes;
    String? avatarMime;
    final createKey =
        'app-${DateTime.now().microsecondsSinceEpoch}-${math.Random.secure().nextInt(1 << 32)}';
    var busy = false;
    const icons = [
      '🤖',
      '🔎',
      '🛠️',
      '🎨',
      '📝',
      '📊',
      '🧠',
      '🌐',
      '⚡',
      '✨',
      '💻',
      '🧪',
      '🔒',
    ];
    try {
      await showAdaptivePanel<void>(
        context: context,
        builder: (sheet) => StatefulBuilder(
          builder: (sheet, redraw) {
            Future<void> save({bool archive = false}) async {
              if (busy) return;
              redraw(() => busy = true);
              try {
                var targetId = '';
                if (archive && bot != null) {
                  await api.updateBot(id, bot.id, {'archived': true});
                } else {
                  final input = <String, dynamic>{
                    'name': name.text.trim(),
                    if (bot == null) 'createKey': createKey,
                    'icon': icon,
                    'instructions': instructions.text.trim(),
                    if (folder.text.trim().isNotEmpty)
                      'defaultFolder': folder.text.trim(),
                  };
                  if (bot == null) {
                    final created = await api.createBot(id, input);
                    targetId = '${(created['bot'] as Map?)?['id'] ?? ''}';
                  } else {
                    await api.updateBot(id, bot.id, input);
                    targetId = bot.id;
                  }
                  if (avatarBytes != null && targetId.isEmpty) {
                    throw StateError(
                      'The new bot was created but no ID was returned for its picture',
                    );
                  }
                  if (avatarBytes case final bytes? when targetId.isNotEmpty) {
                    await api.uploadBotAvatar(id, targetId, bytes, avatarMime!);
                  }
                }
                if (sheet.mounted) Navigator.pop(sheet);
                await _refreshBots();
                if (bot == null && targetId.isNotEmpty && mounted) {
                  final created = bots
                      .where((entry) => entry.id == targetId)
                      .firstOrNull;
                  if (created != null) await _selectBot(created);
                }
                if (archive && bot?.id == _selectedBotId && mounted) {
                  final main = bots.where((entry) => entry.isMain).firstOrNull;
                  if (main != null) await _selectBot(main);
                }
              } catch (failure) {
                if (sheet.mounted) {
                  ScaffoldMessenger.of(
                    sheet,
                  ).showSnackBar(SnackBar(content: Text(failure.toString())));
                }
                if (sheet.mounted) redraw(() => busy = false);
              }
            }

            return SafeArea(
              child: SizedBox(
                height: (MediaQuery.sizeOf(sheet).height * 0.78).clamp(
                  360.0,
                  740.0,
                ),
                child: Column(
                  children: [
                    ListTile(
                      title: Text(
                        bot == null ? 'Create bot' : 'Edit ${bot.name}',
                      ),
                    ),
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          TextField(
                            controller: name,
                            maxLength: 80,
                            decoration: const InputDecoration(
                              labelText: 'Name',
                            ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            children: [
                              for (final preset in icons)
                                ChoiceChip(
                                  label: Icon(botPresetIcon(preset), size: 20),
                                  selected: icon == preset,
                                  onSelected: (_) => redraw(() {
                                    icon = preset;
                                    avatarBytes = null;
                                    avatarMime = null;
                                  }),
                                ),
                            ],
                          ),
                          TextButton.icon(
                            icon: const Icon(Icons.image_outlined),
                            label: const Text(
                              'Choose profile picture (up to 1 MiB)',
                            ),
                            onPressed: () async {
                              final picked = await FilePicker.pickFiles();
                              if (picked.isEmpty) return;
                              final file = picked.first;
                              final extension = file.name
                                  .split('.')
                                  .last
                                  .toLowerCase();
                              final mime = switch (extension) {
                                'png' => 'png',
                                'jpg' || 'jpeg' => 'jpeg',
                                'webp' => 'webp',
                                _ => '',
                              };
                              final length = await file.length();
                              if (mime.isEmpty ||
                                  length == 0 ||
                                  length > 1024 * 1024) {
                                if (sheet.mounted) {
                                  ScaffoldMessenger.of(sheet).showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'Choose a PNG, JPEG, or WebP image up to 1 MiB.',
                                      ),
                                    ),
                                  );
                                }
                                return;
                              }
                              final bytes = await file.readAsBytes();
                              if (bytes.isEmpty || bytes.length > 1024 * 1024) {
                                return;
                              }
                              if (!sheet.mounted) return;
                              redraw(() {
                                avatarBytes = bytes;
                                avatarMime = 'image/$mime';
                                if (bot == null) icon = '🤖';
                              });
                            },
                          ),
                          if (avatarBytes != null)
                            Padding(
                              padding: const EdgeInsets.only(top: 8),
                              child: Row(
                                children: [
                                  ClipOval(
                                    child: Image.memory(
                                      avatarBytes!,
                                      width: 42,
                                      height: 42,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, _, _) => const Icon(
                                        Icons.broken_image_outlined,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  const Text(
                                    'Picture selected · saved after bot details',
                                  ),
                                ],
                              ),
                            ),
                          TextField(
                            controller: folder,
                            decoration: InputDecoration(
                              labelText: 'Default folder',
                              hintText: bot == null
                                  ? '/home/user/workspace/bots/<bot-id>'
                                  : null,
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: Text(
                              'Leave the folder empty and this bot gets its own directory under /home/user/workspace/bots. That directory is its working folder in direct chat and when it is mentioned in the group. Every bot stays in the shared group.',
                              style: TextStyle(color: Vc.muted, fontSize: 12),
                            ),
                          ),
                          TextField(
                            controller: instructions,
                            maxLines: 7,
                            maxLength: 16000,
                            decoration: const InputDecoration(
                              labelText: 'Custom instructions',
                              alignLabelWithHint: true,
                            ),
                          ),
                          const Text(
                            'Instruction edits apply to the next turn, after any running turn finishes.',
                            style: TextStyle(color: Vc.muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          if (bot != null && !bot.isMain)
                            TextButton(
                              onPressed: busy
                                  ? null
                                  : () => save(archive: true),
                              child: const Text('Archive'),
                            ),
                          const Spacer(),
                          TextButton(
                            onPressed: busy ? null : () => Navigator.pop(sheet),
                            child: const Text('Cancel'),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            onPressed: busy ? null : save,
                            child: Text(bot == null ? 'Create' : 'Save'),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      );
    } finally {
      name.dispose();
      folder.dispose();
      instructions.dispose();
    }
  }

  Future<void> _openAgent(BotProfile bot, String? sessionId) async {
    _switchBrowserTarget(_botsEnabled ? bot.id : null);
    setState(() {
      _groupOpen = false;
      _phoneContactsOpen = false;
    });
    if (sessionId == null) {
      await _selectBot(bot);
      return;
    }
    final conversation = store.conversations
        .where((item) => item.sessionId == sessionId && item.botId == bot.id)
        .firstOrNull;
    final target =
        conversation ??
        ConversationMeta.fromJson({
          'sessionId': sessionId,
          'botId': bot.id,
          'title': 'Agent activity',
          'createdAt': 0,
          'updatedAt': 0,
        });
    await _openConversation(target);
  }

  void _openGroup() {
    _switchBrowserTarget(_botsEnabled ? 'main' : null);
    setState(() {
      _groupOpen = true;
      _phoneContactsOpen = false;
    });
    _syncBrowserStream();
  }

  Future<void> _selectBot(BotProfile bot) async {
    _switchBrowserTarget(_botsEnabled ? bot.id : null);
    setState(() {
      _groupOpen = false;
      _phoneContactsOpen = false;
    });
    final activeSource = store.conversations
        .where((item) => item.sessionId == store.activeSessionId)
        .firstOrNull
        ?.source;
    if (selectedBot?.id == bot.id &&
        !_switchingBot &&
        activeSource != 'group') {
      _syncBrowserStream();
      return;
    }
    _stopBrowserStream();
    final selection = ++_switchGeneration;
    final origin = _switchOrigin ?? _captureSwitchOrigin();
    _switchOrigin = origin;
    if (!_switchingBot) {
      _eventCancellation?.cancel();
      unawaited(_sub?.cancel());
      ++_eventGeneration;
    }
    setState(() {
      _switchingBot = true;
      _contactThreadLoading = true;
      _openingBotId = bot.id;
      selectedBot = bot;
      _phoneContactsOpen = false;
      error = null;
    });
    try {
      final data = await api.listConversations(id, botId: bot.id);
      if (!mounted || selection != _switchGeneration) return;
      var remote = ((data['conversations'] as List?) ?? const [])
          .whereType<Map>()
          .map(
            (item) =>
                ConversationMeta.fromJson(Map<String, dynamic>.from(item)),
          )
          .where((item) => item.source != 'group')
          .toList();
      var active = data['active'] as String?;
      if (remote.isEmpty) {
        final created = await api.startNewConversation(id, botId: bot.id);
        if (!mounted || selection != _switchGeneration) return;
        active = created['active'] as String?;
        remote = ((created['conversations'] as List?) ?? const [])
            .whereType<Map>()
            .map(
              (item) =>
                  ConversationMeta.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList();
      }
      if (!mounted || selection != _switchGeneration) return;
      final selected =
          remote
              .where((item) => item.botId == bot.id && item.sessionId == active)
              .firstOrNull ??
          remote.where((item) => item.botId == bot.id).firstOrNull;
      if (selected == null) {
        throw StateError('No conversation returned for ${bot.name}');
      }
      await _openConversation(selected, switchGeneration: selection);
      if (mounted &&
          selection == _switchGeneration &&
          !_switchingBot &&
          selectedBot?.id == bot.id) {
        await store.mergeRemote(remote, selectActive: false);
      }
    } catch (failure) {
      if (!mounted || selection != _switchGeneration) return;
      setState(() {
        _restoreSwitchOrigin(origin);
        error = failure.toString();
      });
      _listen();
      _syncBrowserStream();
    }
  }

  void _showSandboxPicker() {
    final catalog = context.read<SessionController>().workspaces;
    unawaited(catalog.refresh(force: false));
    showAdaptivePanel<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: SizedBox(
          height: (MediaQuery.sizeOf(sheet).height * 0.6).clamp(240.0, 560.0),
          child: Column(
            children: [
              const ListTile(
                title: Text('Switch sandbox'),
                subtitle: Text('Chats and agents stay with their workspace'),
              ),
              Expanded(
                child: ListenableBuilder(
                  listenable: catalog,
                  builder: (context, _) => ListView(
                    children: [
                      for (final workspace in catalog.items)
                        ListTile(
                          selected: workspace.id == id,
                          leading: const Icon(Icons.cloud_outlined),
                          title: Text(workspace.name),
                          subtitle: Text(workspace.runtimeLabel),
                          trailing: workspace.id == id
                              ? const Icon(Icons.check, color: Vc.green)
                              : null,
                          onTap: () {
                            Navigator.pop(sheet);
                            if (workspace.id != id && mounted) {
                              context.go(
                                '/chat/${workspace.id}',
                                extra: workspace,
                              );
                            }
                          },
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _agentRow(BotProfile bot, {bool compact = false}) {
    final active = _botActive(bot);
    final queued = _botWaiting(bot);
    final unread = _botUnread(bot);
    return ListTile(
      key: ValueKey('agent-${bot.id}'),
      selected: !_groupOpen && bot.id == _selectedBotId,
      selectedTileColor: Vc.green.withValues(alpha: 0.09),
      contentPadding: EdgeInsets.symmetric(
        horizontal: compact ? 12 : 18,
        vertical: 4,
      ),
      leading: Stack(
        clipBehavior: Clip.none,
        children: [
          BotAvatar(
            bot: bot,
            instanceId: id,
            client: api,
            radius: compact ? 20 : 23,
          ),
          if (active)
            const Positioned(
              right: -2,
              bottom: -2,
              child: StatusDot('running', size: 12),
            ),
        ],
      ),
      title: Text(
        bot.name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        rosterPreview(
          working: active,
          queued: queued,
          preview: _botPreview(bot),
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: active ? Vc.greenSoft : queued ? Vc.amber : Vc.muted,
          fontSize: 13,
        ),
      ),
      trailing: unread > 0
          ? CircleAvatar(
              radius: 11,
              backgroundColor: Vc.green,
              child: Text(
                '$unread',
                style: const TextStyle(
                  color: Colors.black,
                  fontWeight: FontWeight.w800,
                  fontSize: 11,
                ),
              ),
            )
          : compact
          ? null
          : IconButton(
              tooltip: 'Edit ${bot.name}',
              onPressed: () => unawaited(_editBot(bot)),
              icon: const Icon(Icons.more_horiz, size: 20),
            ),
      onTap: () => unawaited(_selectBot(bot)),
    );
  }

  Widget _agentContacts({bool compact = false}) => Material(
    color: Vc.surface,
    child: Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
          child: Row(
            children: [
              const Expanded(
                child: Text(
                  'Chats',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                ),
              ),
              IconButton(
                tooltip: 'New bot',
                icon: const Icon(Icons.person_add_alt_1_outlined),
                onPressed: () => unawaited(_editBot()),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 12),
          child: TextField(
            controller: _contactsSearch,
            decoration: const InputDecoration(
              hintText: 'Search chats',
              prefixIcon: Icon(Icons.search, size: 18),
              isDense: true,
            ),
          ),
        ),
        if (_botsEnabled && runtime == AgentRuntime.supercharge)
          GitHubAuthConnection(api: api, instanceId: id),
        Expanded(
          child: ListView.builder(
            itemCount:
                2 +
                bots
                    .where(
                      (bot) => bot.name.toLowerCase().contains(
                        _contactsSearch.text.trim().toLowerCase(),
                      ),
                    )
                    .length,
            itemBuilder: (context, index) {
              if (index == 0) {
                return ListTile(
                key: const ValueKey('group-contact'),
                selected: _groupOpen,
                selectedTileColor: Vc.green.withValues(alpha: .10),
                leading: const CircleAvatar(
                  backgroundColor: Vc.greenDim,
                  child: Icon(Icons.forum_outlined, color: Vc.greenSoft),
                ),
                title: const Text(
                  'Agent group',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  '${bots.length} agents · @ to mention',
                  maxLines: 1,
                  style: const TextStyle(color: Vc.muted, fontSize: 12),
                ),
                onTap: _openGroup,
                );
              }
              if (index == 1) {
                return const Padding(
                  padding: EdgeInsets.fromLTRB(18, 16, 18, 6),
                  child: Text(
                    'Direct messages',
                    style: TextStyle(
                      color: Vc.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                );
              }
              final query = _contactsSearch.text.trim().toLowerCase();
              final rows = [
                for (final bot in bots)
                  if (bot.name.toLowerCase().contains(query)) bot,
              ]..sort((a, b) {
                final byRank = rosterRank(
                  unread: _botUnread(a) > 0,
                  working: _botActive(a),
                  queued: _botWaiting(a),
                ).compareTo(
                  rosterRank(
                    unread: _botUnread(b) > 0,
                    working: _botActive(b),
                    queued: _botWaiting(b),
                  ),
                );
                if (byRank != 0) return byRank;
                return a.name.toLowerCase().compareTo(b.name.toLowerCase());
              });
              return _agentRow(rows[index - 2], compact: compact);
            },
          ),
        ),
      ],
    ),
  );

  void _showBots() {
    unawaited(_refreshBots());
    showAdaptivePanel<void>(
      context: context,
      builder: (sheet) => SafeArea(
        child: SizedBox(
          height: (MediaQuery.sizeOf(sheet).height * 0.72).clamp(290.0, 650.0),
          child: Column(
            children: [
              ListTile(
                title: const Text('Chats'),
                subtitle: const Text('Your agents in this sandbox'),
                trailing: IconButton(
                  tooltip: 'New bot',
                  onPressed: () {
                    Navigator.pop(sheet);
                    unawaited(_editBot());
                  },
                  icon: const Icon(Icons.person_add_alt_1_outlined),
                ),
              ),
              Expanded(
                child: ListView(
                  children: [
                    for (final bot in bots)
                      ListTile(
                        key: ValueKey('agent-${bot.id}'),
                        selected: !_groupOpen && bot.id == _selectedBotId,
                        leading: BotAvatar(
                          bot: bot,
                          instanceId: id,
                          client: api,
                        ),
                        title: Text(bot.name),
                        subtitle: _botActive(bot)
                            ? const TypingDots(label: 'Working')
                            : Text(
                                _botWaiting(bot)
                                    ? 'Queued · waiting for a turn'
                                    : _botPreview(bot),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (_botUnread(bot) > 0)
                              CircleAvatar(
                                radius: 10,
                                backgroundColor: Vc.green,
                                child: Text(
                                  '${_botUnread(bot)}',
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: Colors.black,
                                  ),
                                ),
                              ),
                            IconButton(
                              tooltip: 'Edit ${bot.name}',
                              onPressed: () {
                                Navigator.pop(sheet);
                                unawaited(_editBot(bot));
                              },
                              icon: const Icon(Icons.more_horiz),
                            ),
                          ],
                        ),
                        onTap: () {
                          Navigator.pop(sheet);
                          unawaited(_selectBot(bot));
                        },
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showHistory() {
    unawaited(_refreshConversations());
    showAdaptivePanel<void>(
      context: context,
      builder: (ctx) {
        final items = _botsEnabled
            ? store.conversations
                  .where((conversation) => conversation.botId == _selectedBotId)
                  .toList()
            : store.conversations;
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
                onTap: () {
                  Navigator.pop(ctx);
                  unawaited(_startNewChat());
                },
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
                          onTap: () {
                            Navigator.pop(ctx);
                            _openConversation(c);
                          },
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
      _checkLivePause();
      unawaited(_notifyProgress());
      statusTicks += 1;
      if (statusTicks % 4 == 0) unawaited(_pollTurnStatus());
    });
    _syncBrowserStream();
    {
      unawaited(
        TaskNotifications.startTurn(
          instanceId: id,
          name: _botsEnabled
              ? '$instanceName · $_selectedBotName'
              : instanceName,
          botId: _botScope,
          chatId: _chatScope,
          apiBase: api.baseUrl,
          token: api.token,
          since: _isServerSeq(lastServerId) ? lastServerId : null,
        ),
      );
    }
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
    {
      unawaited(
        TaskNotifications.finishTurn(
          instanceId: id,
          name: instanceName,
          body: body ?? lastAssistantText,
          error: error,
        ),
      );
    }
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
    final last = events.isEmpty ? 0 : identityHashCode(events.last);
    final stamp = Object.hash(events.length, last, events.isEmpty ? 0 : events.last.text.hashCode, answered.length);
    if (_groupsCache != null && stamp == _groupsStamp) return _groupsCache!;
    final groups = <List<AppChatEvent>>[];
    for (final ev in events) {
      if (ev.type == 'computer') continue;
      if ((ev.type == 'ask' || ev.type == 'approve') &&
          answered.contains(ev.ref ?? ev.id)) {
        continue;
      }
      if (ev.type == 'tool' || ev.type == 'progress') continue;
      groups.add([ev]);
    }
    _groupsStamp = stamp;
    _groupsCache = groups;
    return groups;
  }

  void _resolve(AppChatEvent ev) {
    setState(() => answered.add(ev.ref ?? ev.id));
    _persist();
  }

  @override
  void dispose() {
    disposed = true;
    _eventGeneration += 1;
    _eventCancellation?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _stopBrowserStream();
    _tick?.cancel();
    _liveTick?.cancel();
    _botsRefresh?.cancel();
    store.cancelScheduledSave();
    _input.dispose();
    if (DesktopNative.onFilesDropped == _dropFiles) {
      DesktopNative.onFilesDropped = null;
    }
    _inputFocus.dispose();
    _contactsSearch.dispose();
    _find.dispose();
    _findFocus.dispose();
    _scroll.removeListener(_onUserScroll);
    _scroll.dispose();
    computer.dispose();
    store
        .save(events: events, answered: answered, lastServerId: lastServerId)
        .catchError((Object error, StackTrace stack) {
          stderr.writeln('Could not save chat history on close: $error');
        });
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
    if (working || _chatQueued) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Stop the current task before starting a new chat.'),
        ),
      );
      return;
    }
    try {
      final raw = await api.startNewConversation(id, botId: _botScope);
      if (_botsEnabled) {
        final created = '${raw['active'] ?? ''}';
        if (created.isNotEmpty) {
          final fresh = ConversationMeta(
            sessionId: created,
            botId: _selectedBotId,
            title: 'New conversation',
            createdAt: DateTime.now().millisecondsSinceEpoch,
            updatedAt: DateTime.now().millisecondsSinceEpoch,
          );
          await store.mergeRemote([fresh], selectActive: false);
          await _openConversation(fresh);
        }
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => error = e.toString());
    }
  }

  Future<void> _send([String? text]) async {
    final t = (text ?? _input.text).trim();
    if (_switchingBot ||
        sending ||
        (_botsEnabled && (working || _chatQueued))) {
      return;
    }
    if (t.isEmpty && pending.isEmpty) return;
    if (_botsEnabled && pending.isEmpty && slashCommandName(t) == 'new') {
      _input.clear();
      await _startNewChat();
      return;
    }
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
    final sentBot = _botScope;
    final sentChat = _chatScope;
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
        await api.sendChat(id, t, botId: sentBot, chatId: sentChat);
      } else {
        await api.uploadFiles(
          id,
          caption: t,
          botId: sentBot,
          chatId: sentChat,
          files: [
            for (final f in drafts)
              (name: f.name, bytes: f.bytes, mime: f.mime),
          ],
        );
      }
    } catch (e) {
      if (!mounted || sentChat != _chatScope) return;
      setState(() {
        _endTurn(error: true, body: e.toString());
        error = e.toString();
      });
    } finally {
      if (!agentTurn && mounted && sentChat == _chatScope) {
        setState(() => sending = false);
      }
    }
  }

  void _dropFiles(List<String> paths) {
    if (ModalRoute.of(context)?.isCurrent != true ||
        sending ||
        paymentBlocked) {
      return;
    }
    unawaited(_attachPaths(paths));
  }

  Future<void> _attachPaths(List<String> paths) async {
    try {
      for (final path in paths.take(12 - pending.length)) {
        final file = File(path);
        if (!await file.exists()) continue;
        if (await file.length() > 50 * 1024 * 1024) {
          throw StateError('Files must be smaller than 50 MB.');
        }
        final bytes = await file.readAsBytes();
        if (!mounted) return;
        await _addAttachment(file.uri.pathSegments.last, bytes);
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  Future<void> _addAttachment(
    String name,
    Uint8List bytes, {
    String? mime,
  }) async {
    if (pending.length >= 12 || bytes.isEmpty || sending) return;
    final localId = 'draft-${DateTime.now().microsecondsSinceEpoch}';
    final path = await store.saveMedia(name: name, bytes: bytes, id: localId);
    if (!mounted || sending) return;
    setState(
      () => pending.add(
        DraftAttach(
          id: localId,
          name: name,
          bytes: bytes,
          path: path,
          mime: mime,
          kind: looksLikeImage(name: name, mime: mime) ? 'photo' : 'document',
        ),
      ),
    );
    _inputFocus.requestFocus();
  }

  Future<void> _pasteClipboard() async {
    try {
      final text = await Clipboard.getData(Clipboard.kTextPlain);
      if (!mounted) return;
      if (text?.text?.isNotEmpty == true) {
        final selection = _input.selection;
        final start = selection.isValid ? selection.start : _input.text.length;
        final end = selection.isValid ? selection.end : start;
        final value = _input.text.replaceRange(start, end, text!.text!);
        _input.value = TextEditingValue(
          text: value,
          selection: TextSelection.collapsed(offset: start + text.text!.length),
        );
        return;
      }
      final bytes = await DesktopNative.clipboardImage();
      if (!mounted || bytes == null) return;
      await _addAttachment(
        'clipboard-${DateTime.now().millisecondsSinceEpoch}.png',
        bytes,
        mime: 'image/png',
      );
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
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
    if (isDesktop) {
      try {
        final saved = await DesktopNative.saveFile(path, name);
        if (saved != null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Saved ${saved.toFilePath()}')),
          );
        }
      } catch (e) {
        if (mounted) setState(() => error = e.toString());
      }
      return;
    }
    await SharePlus.instance.share(
      ShareParams(files: [XFile(path)], text: name),
    );
  }

  Future<void> _saveImage(String path) async {
    try {
      if (isDesktop) {
        final saved = await DesktopNative.saveFile(
          path,
          File(path).uri.pathSegments.last,
        );
        if (saved != null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Saved ${saved.toFilePath()}')),
          );
        }
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
      if (isDesktop) {
        final saved = await DesktopNative.saveFile(
          path,
          ev.name ?? File(path).uri.pathSegments.last,
          mime: ev.mime,
        );
        if (saved != null && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Saved ${saved.toFilePath()}')),
          );
        }
        return;
      }
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
    showAdaptivePanel<void>(
      context: context,
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
    if (isDesktop) {
      setState(() => _desktopComputer = !_desktopComputer);
      _syncBrowserStream();
      return;
    }
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
              onManualBrowserControl: _isSupercharge
                  ? _openBrowserHandoff
                  : null,
              preview: PreviewBrowserScreen(
                embedded: true,
                instanceName: instanceName,
                initialUrl: _latestPreviewUrl(),
                sandboxId: _sandboxId,
                resolvePort: (port) => api.previewHost(id, port: port),
              ),
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
    final targetBot = _desktopBotTarget;
    final targetChat = _desktopChatTarget;
    final targetGroup = _groupOpen;
    computer.tab = 'browser';
    _browserViewerOpen = true;
    _syncBrowserStream();
    try {
      final result = await Navigator.of(context, rootNavigator: true)
          .push<String>(
            MaterialPageRoute<String>(
              fullscreenDialog: true,
              builder: (_) => BrowserHandoffScreen(
                api: api,
                instanceId: id,
                botId: targetBot,
                chatId: targetChat,
                onContinue: (prompt) => _sendBrowserContinuation(
                  prompt,
                  botId: targetBot,
                  chatId: targetChat,
                  group: targetGroup,
                ),
              ),
            ),
          );
      if (mounted && result != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(result)));
      }
    } finally {
      _browserViewerOpen = false;
      if (mounted) _syncBrowserStream();
    }
  }

  Future<void> _sendBrowserContinuation(
    String prompt, {
    String? botId,
    String? chatId,
    required bool group,
  }) async {
    final text = prompt.trim();
    if (text.isEmpty) return;
    if (group ||
        _groupOpen != group ||
        _desktopBotTarget != botId ||
        _desktopChatTarget != chatId) {
      await api.sendChat(id, text, botId: botId, chatId: chatId);
      return;
    }
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

  Future<void> _steerTask() async {
    final text = _input.text.trim();
    final botId = _botScope;
    final chatId = _chatScope;
    if (!_botsEnabled ||
        _groupOpen ||
        !working ||
        _chatQueued ||
        sending ||
        pending.isNotEmpty ||
        text.isEmpty ||
        botId == null ||
        chatId == null) {
      return;
    }
    setState(() => sending = true);
    try {
      await api.steerChat(id, text, botId: botId, chatId: chatId);
      if (mounted && chatId == _chatScope && _input.text.trim() == text) {
        setState(() => _input.clear());
      }
    } catch (failure) {
      if (mounted && chatId == _chatScope) {
        setState(() => error = failure.toString());
      }
    } finally {
      if (mounted && chatId == _chatScope) setState(() => sending = false);
    }
  }

  Future<void> _stopTask() async {
    if (!working && !sending && !_chatQueued) return;
    try {
      await api.stopChat(id, botId: _botScope, chatId: _chatScope);
      if (mounted) {
        setState(() {
          _chatQueued = false;
          _endTurn(body: 'Task stopped.');
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString());
    }
  }

  void _showFind() {
    setState(() => _findOpen = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _findFocus.requestFocus();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cliInfo = CliVersion.fromJson(cli, runtime: runtime.apiValue);
    final updateReady = cliInfo.updateAvailable && !hideCliUpdate;
    final palette = showCommandPalette(_input.text);
    final transcript = Stack(
      children: [
        Column(
          children: [
            if (isDesktop && _findOpen)
              Padding(
                padding: const EdgeInsets.all(12),
                child: TextField(
                  controller: _find,
                  focusNode: _findFocus,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: 'Find in conversation…',
                    prefixIcon: const Icon(Icons.search, size: 18),
                    suffixIcon: IconButton(
                      tooltip: 'Close search',
                      onPressed: () => setState(() {
                        _findOpen = false;
                        _find.clear();
                      }),
                      icon: const Icon(Icons.close, size: 18),
                    ),
                  ),
                ),
              ),
            if (updateReady)
              CliUpdateNote(
                info: cliInfo,
                busy: sending || working,
                onUpdate: () => unawaited(_runCliUpdate()),
                onDismiss: () => unawaited(_dismissCliUpdate()),
              ),
            if (reconnecting && !_contactThreadLoading) const ReconnectBar(),
            if (_chatQueued && !_contactThreadLoading)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                child: Text(
                  'Queued in this sandbox · this bot will start when a slot is free',
                  style: TextStyle(color: Vc.amber, fontSize: 12),
                ),
              ),
            if (backgroundTasks.isNotEmpty && !_contactThreadLoading)
              BackgroundTasksBar(tasks: backgroundTasks.values.toList()),
            if (error != null)
              ErrorBanner(
                message: error!,
                onRetry: _boot,
                onDismiss: () => setState(() => error = null),
              ),
            Expanded(
              child: _contactThreadLoading
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.chat_bubble_outline,
                            size: 28,
                            color: Vc.muted,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'Opening ${bots.where((bot) => bot.id == _openingBotId).firstOrNull?.name ?? 'chat'}…',
                            style: const TextStyle(color: Vc.muted),
                          ),
                        ],
                      ),
                    )
                  : paymentBlocked
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
                        final query = _findOpen
                            ? _find.text.trim().toLowerCase()
                            : '';
                        final groups = _grouped()
                            .where(
                              (batch) =>
                                  query.isEmpty ||
                                  batch.any(
                                    (event) => event.text
                                        .toLowerCase()
                                        .contains(query),
                                  ),
                            )
                            .toList();
                        if (groups.isEmpty && query.isNotEmpty) {
                          return const Center(
                            child: Text(
                              'No matching messages',
                              style: TextStyle(color: Vc.muted),
                            ),
                          );
                        }
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
                              return RepaintBoundary(
                                child: ToolFold(
                                  tools: batch,
                                  expanded: working && lastGroup,
                                ),
                              );
                            }
                            return RepaintBoundary(child: _bubble(batch.first));
                          },
                        );
                      },
                    ),
            ),
            if (pending.isNotEmpty && !_contactThreadLoading)
              DraftTray(
                items: pending,
                onRemove: (f) => setState(() => pending.remove(f)),
                onOpen: _openDraft,
              ),
            if (palette && !_contactThreadLoading) _commandOverlay(),
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
            else if (!_contactThreadLoading)
              SafeArea(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!isDesktop)
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
                          if (!_contactThreadLoading &&
                              (working || showKickoff) &&
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
                              borderRadius: BorderRadius.circular(
                                isDesktop ? 10 : 26,
                              ),
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
                                  child: DesktopComposerKeys(
                                    controller: _input,
                                    onSend: () =>
                                        _botsEnabled &&
                                            !_groupOpen &&
                                            working &&
                                            !_chatQueued
                                        ? _steerTask()
                                        : _send(),
                                    onPaste: _pasteClipboard,
                                    child: TextField(
                                      controller: _input,
                                      focusNode: _inputFocus,
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
                                ),
                                if ((!_groupOpen || !_botsEnabled) &&
                                    (working || sending || _chatQueued))
                                  IconButton(
                                    tooltip: isDesktop
                                        ? 'Stop task (Ctrl+.)'
                                        : 'Stop task',
                                    onPressed: _stopTask,
                                    icon: const Icon(
                                      Icons.stop_circle_outlined,
                                      color: Vc.red,
                                    ),
                                  ),
                                IconButton(
                                  tooltip: 'Commands (Ctrl+K)',
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
                                    tooltip:
                                        _botsEnabled &&
                                            !_groupOpen &&
                                            working &&
                                            !_chatQueued
                                        ? 'Steer'
                                        : isDesktop
                                        ? 'Send (Enter)'
                                        : 'Send',
                                    onPressed:
                                        _switchingBot ||
                                            sending ||
                                            (_botsEnabled && _chatQueued) ||
                                            (_botsEnabled &&
                                                working &&
                                                pending.isNotEmpty) ||
                                            (_input.text.trim().isEmpty &&
                                                pending.isEmpty)
                                        ? null
                                        : _botsEnabled && !_groupOpen && working
                                        ? _steerTask
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
                          if (isDesktop)
                            const Padding(
                              padding: EdgeInsets.fromLTRB(10, 7, 10, 0),
                              child: Text(
                                'Enter to send · Shift+Enter for a new line · Ctrl+K for commands',
                                style: TextStyle(color: Vc.muted, fontSize: 11),
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
                    padding: EdgeInsets.symmetric(horizontal: 14, vertical: 8),
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
    );
    final chatContent = _botsEnabled && _groupOpen
        ? GroupThread(
            key: ValueKey('group-$id'),
            api: api,
            instanceId: id,
            accountId: context.read<SessionController>().user?.id ?? '',
            bots: bots,
            directory: context.read<SessionController>().agents,
            onOpenAgent: (bot, session) => unawaited(_openAgent(bot, session)),
          )
        : transcript;
    final body = AppScaffold(
      currentInstanceId: id,
      isRoot: true,
      onBack: () {
        if (_botsEnabled && !_phoneContactsOpen) {
          setState(() => _phoneContactsOpen = true);
          return true;
        }
        return false;
      },
      fullWidth: true,
      commands: {
        DesktopCommand.newChat: working || sending || _chatQueued
            ? null
            : _startNewChat,
        DesktopCommand.history: _showHistory,
        DesktopCommand.commands: _commands,
        DesktopCommand.focusComposer: _inputFocus.requestFocus,
        DesktopCommand.attach: sending ? null : _attach,
        DesktopCommand.stop: working || sending || _chatQueued
            ? _stopTask
            : null,
        DesktopCommand.computer: _openComputer,
        DesktopCommand.preview: () => _openPreview(),
        DesktopCommand.refresh: _catchUp,
        DesktopCommand.search: _showFind,
      },
      appBar: AppBar(
        leading: !isDesktop && _botsEnabled && !_phoneContactsOpen
            ? IconButton(
                tooltip: 'Back to chats',
                onPressed: () => setState(() => _phoneContactsOpen = true),
                icon: const Icon(Icons.arrow_back),
              )
            : null,
        title: Row(
          children: [
            if (_groupOpen && !_phoneContactsOpen) ...[
              const CircleAvatar(
                radius: 18,
                backgroundColor: Vc.greenDim,
                child: Icon(
                  Icons.forum_outlined,
                  color: Vc.greenSoft,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
            ] else if (_botsEnabled &&
                !_phoneContactsOpen &&
                selectedBot != null) ...[
              BotAvatar(
                bot: selectedBot!,
                instanceId: id,
                client: api,
                radius: 18,
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _phoneContactsOpen
                        ? 'Chats'
                        : _groupOpen && _botsEnabled
                        ? 'Agent group'
                        : _botsEnabled
                        ? _selectedBotName
                        : instanceName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  _groupOpen && _botsEnabled
                      ? Text(
                          '${bots.length} agents · Main answers unless tagged',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Vc.muted, fontSize: 11),
                        )
                      : _botsEnabled
                      ? Text(
                          instanceName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Vc.muted, fontSize: 11),
                        )
                      : TurnClock(
                          startedAt: turnStartedAt,
                          etaMs: etaMs,
                          tools: toolCount,
                          idle: lastTurnElapsed,
                        ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          ListenableBuilder(
            listenable: context.read<SessionController>().workspaces,
            builder: (context, _) =>
                context.read<SessionController>().workspaces.items.length > 1
                ? TextButton.icon(
                    onPressed: _showSandboxPicker,
                    icon: const Icon(Icons.swap_horiz_rounded, size: 17),
                    label: const Text('Sandbox'),
                  )
                : const SizedBox.shrink(),
          ),
          if (_botsEnabled)
            IconButton(
              tooltip: 'Bots',
              onPressed: isDesktop
                  ? _showBots
                  : () => setState(
                      () => _phoneContactsOpen = !_phoneContactsOpen,
                    ),
              icon: Icon(
                _phoneContactsOpen
                    ? Icons.chat_bubble_outline
                    : Icons.people_outline,
              ),
            ),
          if (isDesktop) ...[
            IconButton(
              tooltip: 'New conversation (Ctrl+N)',
              onPressed: working || sending || _chatQueued
                  ? null
                  : _startNewChat,
              icon: const Icon(Icons.edit_square, size: 19),
            ),
            IconButton(
              tooltip: 'Conversation history (Ctrl+H)',
              onPressed: _showHistory,
              icon: const Icon(Icons.history, size: 20),
            ),
            IconButton(
              tooltip: 'Show / hide computer (Ctrl+J)',
              onPressed: _openComputer,
              icon: const Icon(Icons.vertical_split_outlined, size: 19),
            ),
          ],
          if (_usageText != null &&
              (!isDesktop || MediaQuery.sizeOf(context).width >= 1200))
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
          if (isDesktop) ...[
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
          ] else
            PopupMenuButton<String>(
              tooltip: 'Chat options',
              onSelected: (value) {
                switch (value) {
                  case 'files':
                    context.push('/instance/$id/files', extra: inst);
                  case 'preview':
                    _openPreview();
                  case 'control':
                    context.push('/instance/$id', extra: inst);
                  case 'computer':
                    _openComputer();
                  case 'history':
                    _showHistory();
                  case 'agent':
                    unawaited(_editBot());
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'agent', child: Text('New agent')),
                PopupMenuItem(
                  value: 'computer',
                  child: Text('Desktop / Take over'),
                ),
                PopupMenuItem(value: 'files', child: Text('Files')),
                PopupMenuItem(value: 'preview', child: Text('Website preview')),
                PopupMenuItem(
                  value: 'history',
                  child: Text('Conversation history'),
                ),
                PopupMenuItem(
                  value: 'control',
                  child: Text('Workspace settings'),
                ),
              ],
            ),
        ],
      ),
      body: isDesktop
          ? Row(
              children: [
                if (_botsEnabled &&
                    DesktopLayout.of(context)?.sidebarVisible != true &&
                    MediaQuery.sizeOf(context).width >= 850) ...[
                  SizedBox(width: 248, child: _agentContacts(compact: true)),
                  const VerticalDivider(width: 1),
                ],
                Expanded(
                  child: DesktopChatWorkspace(
                    chat: chatContent,
                    computer: computer,
                    showComputer: _desktopComputer,
                    onCloseComputer: _openComputer,
                    onRunCommand: _runComputerCommand,
                    onManualControl: _isSupercharge
                        ? _openBrowserHandoff
                        : null,
                    preview: PreviewBrowserScreen(
                      embedded: true,
                      instanceName: instanceName,
                      initialUrl: _latestPreviewUrl(),
                      sandboxId: _sandboxId,
                      resolvePort: (port) => api.previewHost(id, port: port),
                    ),
                  ),
                ),
              ],
            )
          : _botsEnabled && _phoneContactsOpen
          ? _agentContacts()
          : chatContent,
    );
    if (isDesktop) return body;
    return WithForegroundTask(child: body);
  }
}
