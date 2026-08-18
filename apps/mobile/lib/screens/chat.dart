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
import '../api/models.dart';
import '../chat/chat_store.dart';
import '../chat/cli_update.dart';
import '../chat/commands.dart';
import '../chat/draft.dart';
import '../chat/notifications.dart';
import '../chat/preview_urls.dart';
import '../screens/preview.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/file_viewer.dart';
import '../widgets/markdown.dart';
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
  List<BotCommand> commands = defaultBotCommands;
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
  int? usageUsed;
  int? usageMax;
  int? usagePct;
  String? usageLabel;
  final pickerPage = <String, int>{};
  Timer? _tick;
  final pending = <DraftAttach>[];

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;
  bool get working => turnStartedAt != null;
  String get instanceName => inst?.name ?? widget.instance?.name ?? 'Chat';

  Duration get elapsed =>
      turnStartedAt == null ? Duration.zero : DateTime.now().difference(turnStartedAt!);

  int get progressPct => TaskNotifications.softPercent(tools: toolCount, elapsed: elapsed);

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
      _listen();
      return;
    }
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      backgrounded = true;
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
      connectLabel = inst?.isPaused == true ? 'Waking paused sandbox…' : 'Connecting to sandbox…';
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
        connecting = false;
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
    _listen();
    api.commands(id).then((c) {
      if (mounted && c.isNotEmpty) setState(() => commands = c);
    }).catchError((_) {});
    api.chatStatus(id).then((s) {
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
        }
      });
    }).catchError((_) {});
    api.cliVersion(id).then((c) {
      if (!mounted) return;
      setState(() => cli = c);
      unawaited(_maybeOfferCliUpdate(c));
    }).catchError((_) {});
    unawaited(TaskNotifications.requestPermissions());
  }

  void _listen() {
    _sub?.cancel();
    _sub = _eventLoop().listen((ev) {
      if (!mounted) return;
      setState(() {
        connecting = false;
        reconnecting = false;
        _ingest(ev);
      });
      if (pinnedToLatest) _scrollToEnd();
    }, onError: (e) {
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
    });
  }

  Stream<AppChatEvent> _eventLoop() async* {
    var delay = 1;
    while (!disposed) {
      try {
        await for (final ev in api.events(id, since: lastServerId)) {
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
    if (ev.type == 'status') {
      final busy = ev.busy == true;
      if (busy) {
        if (ev.startedAt != null && ev.startedAt! > 0) {
          turnStartedAt = DateTime.fromMillisecondsSinceEpoch(ev.startedAt!);
        } else {
          turnStartedAt ??= DateTime.now();
        }
        if (ev.tools != null) toolCount = ev.tools!;
      } else {
        turnStartedAt = null;
      }
      return;
    }
    if (ev.type == 'usage') {
      usageUsed = ev.used;
      usageMax = ev.max;
      usagePct = ev.pct;
      usageLabel = ev.label ?? ev.text;
      if ((usageLabel == null || usageLabel!.isEmpty) && usageUsed != null && usageMax != null) {
        usageLabel = '${_fmtTokens(usageUsed!)} / ${_fmtTokens(usageMax!)}';
      }
      return;
    }
    if (!ev.local && ev.id.isNotEmpty) {
      lastServerId = ev.id;
      if (_alreadyHave(ev)) return;
    }
    if (ev.type == 'progress') {
      showKickoff = false;
      if (ev.tools != null) toolCount = math.max(toolCount, ev.tools!);
      unawaited(_notifyProgress());
      _persist();
      return;
    }
    if (ev.type == 'typing') {
      return;
    }
    if (ev.type == 'done') {
      _endTurn();
      return;
    }
    if (ev.type == 'error') {
      lastAssistantText = ev.text;
      events.add(ev);
      _endTurn(error: true, body: ev.text);
      return;
    }
    if (ev.type == 'text' || ev.type == 'ask' || ev.type == 'approve' || ev.type == 'file') {
      sending = false;
      showKickoff = false;
    }
    if ((ev.type == 'ask' || ev.type == 'approve') && !answered.contains(ev.ref ?? ev.id)) {
      unawaited(TaskNotifications.showPermissionNeed(
        instanceId: id,
        name: instanceName,
        body: ev.text,
        kind: ev.type,
      ));
    }
    if (ev.type == 'text' && ev.text.isNotEmpty) lastAssistantText = ev.text;
    if (ev.type == 'text' && _isModelSwitchNote(ev.text) && _justPickedModel) {
      _persist();
      return;
    }
    if (ev.type == 'tool') {
      showKickoff = false;
      if (ev.state != 'done') toolCount += 1;
      final i = events.lastIndexWhere((e) => e.type == 'tool' && e.state != 'done');
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
      unawaited(_ensureLocalFile(ev, auto: ev.isImage));
    }
    _persist();
    unawaited(_notifyProgress());
  }

  void _persist() {
    store.scheduleSave(events: events, answered: answered, lastServerId: lastServerId);
  }

  void _beginTurn() {
    turnStartedAt = DateTime.now();
    toolCount = 0;
    showKickoff = true;
    sending = true;
    error = null;
    lastAssistantText = null;
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || turnStartedAt == null) return;
      setState(() {});
      unawaited(_notifyProgress());
    });
    unawaited(TaskNotifications.startTurn(
      instanceId: id,
      name: instanceName,
      apiBase: api.baseUrl,
      token: api.token,
      since: lastServerId,
    ));
  }

  void _endTurn({bool error = false, String? body}) {
    sending = false;
    showKickoff = false;
    if (turnStartedAt != null) {
      lastTurnElapsed = DateTime.now().difference(turnStartedAt!);
    }
    turnStartedAt = null;
    _tick?.cancel();
    _tick = null;
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
      if ((ev.type == 'ask' || ev.type == 'approve') && answered.contains(ev.ref ?? ev.id)) {
        continue;
      }
      if (ev.type == 'tool' && groups.isNotEmpty && groups.last.first.type == 'tool') {
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
    _tick?.cancel();
    _input.dispose();
    _scroll.removeListener(_onUserScroll);
    _scroll.dispose();
    unawaited(store.save(events: events, answered: answered, lastServerId: lastServerId));
    if (turnStartedAt == null) {
      unawaited(TaskNotifications.cancelSilent());
    }
    super.dispose();
  }

  Future<void> _maybeOfferCliUpdate(Map<String, dynamic> raw) async {
    final info = CliVersion.fromJson(raw);
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
    await _send('/update yes');
    if (latest.isNotEmpty) {
      await CliUpdateOffer.dismiss(id, latest);
    }
    if (mounted) setState(() => hideCliUpdate = true);
  }

  Future<void> _dismissCliUpdate() async {
    final latest = '${cli?['latest'] ?? ''}';
    await CliUpdateOffer.dismiss(id, latest);
    if (mounted) setState(() => hideCliUpdate = true);
  }

  Future<void> _send([String? text]) async {
    final t = (text ?? _input.text).trim();
    if (sending) return;
    if (t.isEmpty && pending.isEmpty) return;
    final drafts = List<DraftAttach>.from(pending);
    _input.clear();
    HapticFeedback.lightImpact();
    setState(() {
      _beginTurn();
      pending.clear();
      if (t.isNotEmpty) {
        events.add(AppChatEvent({
          'type': 'user',
          'text': t,
          'id': 'local-${DateTime.now().millisecondsSinceEpoch}',
          'ts': DateTime.now().millisecondsSinceEpoch,
          'format': 'markdown',
        }, local: true));
      }
      for (final f in drafts) {
        events.add(AppChatEvent({
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
        }, local: true));
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
            for (final f in drafts) (name: f.name, bytes: f.bytes, mime: f.mime),
          ],
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endTurn(error: true, body: e.toString());
        error = e.toString();
      });
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
      final localId = 'draft-${DateTime.now().millisecondsSinceEpoch}-${f.name}';
      final path = await store.saveMedia(name: f.name, bytes: bytes, id: localId);
      pending.add(DraftAttach(
        id: localId,
        name: f.name,
        bytes: Uint8List.fromList(bytes),
        path: path,
        mime: mime,
        kind: looksLikeImage(name: f.name, mime: mime) ? 'photo' : 'document',
      ));
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
      final path = await store.saveMedia(name: file.name, bytes: file.bytes, id: fileId);
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
    await SharePlus.instance.share(ShareParams(files: [XFile(path)], text: name));
  }

  Future<void> _saveImage(String path) async {
    try {
      final ok = await Gal.requestAccess();
      if (ok == false) {
        if (!mounted) return;
        setState(() => error = 'Photo permission denied');
        return;
      }
      await Gal.putImage(path);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved to gallery')));
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
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Saved $out')));
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
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Send')),
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
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Use')),
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
      if (e.type == 'user' || e.type == 'text' || e.type == 'ask' || e.type == 'tool') {
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
          style: const TextStyle(color: Vc.muted, fontSize: 13, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }

  void _pickCommand(BotCommand c) {
    if (commandSendsImmediately(c.command)) {
      _input.clear();
      _send('/${c.command}');
      return;
    }
    _input.value = TextEditingValue(
      text: '/${c.command} ',
      selection: TextSelection.collapsed(offset: c.command.length + 2),
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
                    const ListTile(title: Text('Commands', style: TextStyle(fontWeight: FontWeight.w700))),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: TextField(
                        decoration: const InputDecoration(hintText: 'Search /commands'),
                        onChanged: (v) => setModal(() => q = v.trim().toLowerCase()),
                      ),
                    ),
                    Expanded(
                      child: ListView(
                        children: [
                          for (final c in filtered)
                            ListTile(
                              title: Text('/${c.command}'),
                              subtitle: Text(c.description, style: const TextStyle(color: Vc.muted)),
                              onTap: () {
                                Navigator.pop(ctx);
                                _pickCommand(c);
                              },
                            ),
                          if (filtered.isEmpty)
                            const ListTile(title: Text('No matching commands', style: TextStyle(color: Vc.muted))),
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
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
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
              const Text('Approval needed', style: TextStyle(fontWeight: FontWeight.w700, color: Vc.amber)),
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
              if (ev.localPath != null) unawaited(_sharePath(ev.localPath!, ev.name ?? 'image'));
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
            if (ev.localPath != null) unawaited(_sharePath(ev.localPath!, ev.name ?? 'file'));
          },
        );
      case 'error':
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Text(ev.text, style: const TextStyle(color: Vc.red)),
        );
      case 'done':
      case 'typing':
      case 'progress':
        return const SizedBox.shrink();
      default:
        if (ev.text.isEmpty) return const SizedBox.shrink();
        final shown = rewriteLocalhostUrls(ev.text, _sandboxId);
        final previews = extractPreviewUrls(shown);
        return GestureDetector(
          onLongPress: () {
            Clipboard.setData(ClipboardData(text: shown));
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
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
                                api.answer(id, ref: ev.ref, index: abs, answer: choices[abs]);
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
                  onPressed: page <= 0 ? null : () => setState(() => pickerPage[key] = page - 1),
                  child: const Text('◀ Prev'),
                ),
                Expanded(
                  child: Text('${page + 1} / $pages', textAlign: TextAlign.center, style: const TextStyle(color: Vc.muted, fontSize: 12)),
                ),
                TextButton(
                  onPressed: page >= pages - 1 ? null : () => setState(() => pickerPage[key] = page + 1),
                  child: const Text('Next ▶'),
                ),
              ],
            ),
          ListTile(
            dense: true,
            enabled: !locked,
            contentPadding: EdgeInsets.zero,
            title: const Text('Type your own…', style: TextStyle(color: Vc.green)),
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
      final isModel = ev.kind == 'model' || (ev.title ?? '').toLowerCase() == 'model';
      if (name.isEmpty) {
        return _switchNote(isModel ? 'Model switched' : 'Selection saved');
      }
      return _switchNote(isModel ? 'Model switched to $name' : 'Switched to $name');
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
                if (total > pageSize) '${start + 1}–${start + slice.length} of $total',
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
                                setState(() => _rememberPick(ev, value, label: '${o['label'] ?? o['value']}'));
                                _persist();
                                api.pick(id, ref: ev.ref, value: value, kind: ev.kind);
                              },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: o['current'] == true ? Vc.green : Colors.white,
                          side: BorderSide(color: o['current'] == true ? Vc.green : Vc.cardBorder),
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                        ),
                        child: Text(
                          '${o['label'] ?? o['value']}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                  ),
                if (slice.skip(i).length == 1) const Expanded(child: SizedBox()),
              ],
            ),
          if (pages > 1)
            Row(
              children: [
                TextButton(
                  onPressed: page <= 0 ? null : () => setState(() => pickerPage[key] = page - 1),
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
                  onPressed: page >= pages - 1 ? null : () => setState(() => pickerPage[key] = page + 1),
                  child: const Text('Next ▶'),
                ),
              ],
            ),
          ListTile(
            dense: true,
            enabled: !locked,
            contentPadding: EdgeInsets.zero,
            title: const Text('Custom model…', style: TextStyle(color: Vc.green)),
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
      final t = _fmtClock(elapsed);
      if (toolCount <= 0) return t;
      return '$t · $toolCount tool${toolCount == 1 ? '' : 's'}';
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
    if (!isPreviewUrl(href) && !href.contains('localhost') && !href.contains('127.0.0.1')) {
      return false;
    }
    final sid = _sandboxId;
    final url = isPreviewUrl(href)
        ? href
        : rewriteLocalhostUrls(href, sid);
    _openPreview(url);
    return true;
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
                title: Text('/${c.command}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(c.description, style: const TextStyle(color: Vc.muted, fontSize: 11)),
                onTap: () => _pickCommand(c),
              ),
            if (filtered.isEmpty)
              const ListTile(
                dense: true,
                title: Text('No matching commands', style: TextStyle(color: Vc.muted)),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cliInfo = CliVersion.fromJson(cli);
    final updateReady = cliInfo.updateAvailable && !hideCliUpdate;
    final palette = showCommandPalette(_input.text);
    return WithForegroundTask(
      child: AppScaffold(
        currentInstanceId: id,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              instanceName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: -0.3),
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
                  message: usagePct != null ? 'Context $usagePct% of model window' : 'Context usage',
                  child: Text(
                    usagePct != null ? '$_usageText · $usagePct%' : _usageText!,
                    style: TextStyle(color: _usageColor, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ),
          IconButton(
            tooltip: 'Preview',
            onPressed: () => _openPreview(),
            icon: const Icon(Icons.language),
          ),
          if (working)
            IconButton(
              tooltip: 'Stop',
              onPressed: () => api.stopChat(id),
              icon: const Icon(Icons.stop_circle_outlined),
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
                        detail: 'Renew this instance to keep chatting with the sandbox.',
                      )
                    : events.isEmpty && !connecting && !showKickoff
                        ? const EmptyState(
                            icon: Icons.chat_bubble_outline,
                            title: 'What should we work on?',
                            detail: 'Ask anything. Attach a file or type / for commands.',
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
                                    return ToolFold(tools: batch, expanded: working && lastGroup);
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
                      onPressed: () => context.push('/billing', extra: BillingArgs(instanceId: id)),
                      child: const Text('Renew subscription'),
                    ),
                  ),
                )
              else
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (working || showKickoff)
                          const Padding(
                            padding: EdgeInsets.fromLTRB(8, 0, 8, 8),
                            child: Text(
                              'Thinking…',
                              style: TextStyle(color: Vc.muted, fontSize: 13, fontWeight: FontWeight.w500),
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
                                icon: const Icon(Icons.add, color: Vc.muted, size: 22),
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
                                    contentPadding: EdgeInsets.fromLTRB(0, 10, 8, 10),
                                  ),
                                ),
                              ),
                              IconButton(
                                tooltip: 'Commands',
                                onPressed: _commands,
                                icon: const Icon(Icons.alternate_email, color: Vc.muted, size: 20),
                              ),
                              Material(
                                color: sending || (_input.text.trim().isEmpty && pending.isEmpty)
                                    ? Vc.card
                                    : Colors.white,
                                shape: const CircleBorder(),
                                child: IconButton(
                                  onPressed: sending || (_input.text.trim().isEmpty && pending.isEmpty)
                                      ? null
                                      : () => _send(),
                                  icon: sending
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(strokeWidth: 2, color: Vc.muted),
                                        )
                                      : Icon(
                                          Icons.arrow_upward_rounded,
                                          size: 20,
                                          color: sending || (_input.text.trim().isEmpty && pending.isEmpty)
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
                          Text('Jump to latest', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
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
    ),
    );
  }
}
