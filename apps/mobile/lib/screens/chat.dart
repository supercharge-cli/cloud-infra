import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:gal/gal.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../chat/chat_store.dart';
import '../chat/commands.dart';
import '../chat/notifications.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/media.dart';
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
  int toolCount = 0;
  Timer? _tick;

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
    _input.addListener(() {
      if (mounted) setState(() {});
    });
    _boot();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      backgrounded = false;
      _listen();
      return;
    }
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      backgrounded = true;
      if (working) {
        unawaited(_notifyProgress());
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
      _scrollToEnd();
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
    } catch (_) {}
    if (inst?.isPaused == true) {
      try {
        await api.wake(id);
      } catch (_) {}
    }
    _listen();
    api.commands(id).then((c) {
      if (mounted && c.isNotEmpty) setState(() => commands = c);
    }).catchError((_) {});
    api.cliVersion(id).then((c) {
      if (mounted) setState(() => cli = c);
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
      _scrollToEnd();
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
    if (ev.type == 'text' && ev.text.isNotEmpty) lastAssistantText = ev.text;
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
      final i = events.lastIndexWhere(
        (e) => e.isUser && (e.type == 'file' || e.type == 'user') && e.name == ev.name && e.fileId == null,
      );
      if (i >= 0) {
        events[i].raw['fileId'] = ev.fileId;
        events[i].raw['kind'] = ev.kind ?? events[i].kind;
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
    unawaited(TaskNotifications.startTurn(instanceId: id, name: instanceName));
  }

  void _endTurn({bool error = false, String? body}) {
    sending = false;
    showKickoff = false;
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

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _sub?.cancel();
    _tick?.cancel();
    _input.dispose();
    _scroll.dispose();
    unawaited(store.save(events: events, answered: answered, lastServerId: lastServerId));
    if (turnStartedAt == null) {
      unawaited(TaskNotifications.cancelSilent());
    }
    super.dispose();
  }

  Future<void> _send([String? text]) async {
    final t = (text ?? _input.text).trim();
    if (t.isEmpty || sending) return;
    _input.clear();
    HapticFeedback.lightImpact();
    setState(() {
      _beginTurn();
      events.add(AppChatEvent({
        'type': 'user',
        'text': t,
        'id': 'local-${DateTime.now().millisecondsSinceEpoch}',
        'ts': DateTime.now().millisecondsSinceEpoch,
      }, local: true));
    });
    _persist();
    _scrollToEnd();
    try {
      await api.sendChat(id, t);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endTurn(error: true, body: e.toString());
        error = e.toString();
      });
    }
  }

  Future<void> _attach() async {
    final picked = await FilePicker.pickFiles();
    if (picked.isEmpty) return;
    final f = picked.first;
    final bytes = await f.readAsBytes();
    final caption = _input.text.trim();
    final mime = f.xFile.mimeType;
    final image = looksLikeImage(name: f.name, mime: mime);
    final localId = 'local-file-${DateTime.now().millisecondsSinceEpoch}';
    final path = await store.saveMedia(name: f.name, bytes: bytes, id: localId);
    setState(() {
      _beginTurn();
      events.add(AppChatEvent({
        'type': 'file',
        'role': 'user',
        'text': caption,
        'name': f.name,
        'kind': image ? 'photo' : 'document',
        'mime': mime,
        'size': bytes.length,
        'localPath': path,
        'id': localId,
        'ts': DateTime.now().millisecondsSinceEpoch,
      }, local: true));
    });
    _input.clear();
    _persist();
    _scrollToEnd();
    try {
      await api.upload(id, name: f.name, bytes: bytes, caption: caption, mime: mime);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _endTurn(error: true, body: e.toString());
        error = e.toString();
      });
    }
  }

  Future<void> _ensureLocalFile(AppChatEvent ev, {bool auto = false}) async {
    final fileId = ev.fileId;
    if (fileId == null) return;
    if (ev.localPath != null && File(ev.localPath!).existsSync()) return;
    final cached = await store.existingMedia(fileId, ev.name);
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
    setState(() => answered.add(ev.ref ?? ev.id));
    _persist();
    await api.answer(id, ref: ev.ref, answer: text);
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
              margin: const EdgeInsets.fromLTRB(48, 6, 12, 6),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Vc.greenDim,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(ev.text),
            ),
          ),
        );
      case 'tool':
        return Container(
          margin: const EdgeInsets.fromLTRB(12, 4, 48, 4),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFF111113),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Vc.cardBorder),
          ),
          child: Row(
            children: [
              Icon(
                ev.state == 'done' ? Icons.check_circle_outline : Icons.build,
                size: 16,
                color: ev.state == 'done' ? Vc.green : Vc.amber,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  ev.name != null ? '${ev.name} · ${ev.text}' : ev.text,
                  style: const TextStyle(fontSize: 12, color: Vc.muted),
                ),
              ),
            ],
          ),
        );
      case 'approve':
        final locked = answered.contains(ev.ref ?? ev.id);
        return _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Approval needed', style: TextStyle(fontWeight: FontWeight.w700, color: Vc.amber)),
              const SizedBox(height: 8),
              MarkdownBody(data: ev.text, styleSheet: _md, onTapLink: _openLink),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final c in ['once', 'session', 'always', 'deny'])
                    OutlinedButton(
                      onPressed: locked
                          ? null
                          : () {
                              setState(() => answered.add(ev.ref ?? ev.id));
                              _persist();
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
        final locked = answered.contains(ev.ref ?? ev.id);
        return _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              MarkdownBody(data: ev.text, styleSheet: _md, onTapLink: _openLink),
              const SizedBox(height: 8),
              for (var i = 0; i < ev.choices.length; i++)
                ListTile(
                  dense: true,
                  enabled: !locked,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${i + 1}. ${ev.choices[i]}'),
                  onTap: locked
                      ? null
                      : () {
                          setState(() => answered.add(ev.ref ?? ev.id));
                          _persist();
                          api.answer(id, ref: ev.ref, index: i, answer: ev.choices[i]);
                        },
                ),
              ListTile(
                dense: true,
                enabled: !locked,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  '${ev.choices.length + 1}. Type your own…',
                  style: const TextStyle(color: Vc.green),
                ),
                onTap: locked ? null : () => _customAnswer(ev),
              ),
            ],
          ),
        );
      case 'picker':
        final locked = answered.contains(ev.ref ?? ev.id);
        return _card(
          child: Column(
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(ev.title ?? ev.raw['title']?.toString() ?? 'Choose'),
                subtitle: ev.text.isEmpty ? null : Text(ev.text, style: const TextStyle(color: Vc.muted, fontSize: 12)),
              ),
              for (final o in ev.options.take(30))
                ListTile(
                  dense: true,
                  enabled: !locked,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${o['label'] ?? o['value']}'),
                  selected: o['current'] == true,
                  onTap: locked
                      ? null
                      : () {
                          setState(() => answered.add(ev.ref ?? ev.id));
                          _persist();
                          api.pick(id, ref: ev.ref, value: '${o['value']}', kind: ev.kind);
                        },
                ),
            ],
          ),
        );
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
        return Align(
          alignment: Alignment.centerLeft,
          child: GestureDetector(
            onLongPress: () {
              Clipboard.setData(ClipboardData(text: ev.text));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
            },
            child: Container(
              margin: const EdgeInsets.fromLTRB(12, 6, 48, 6),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Vc.card,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Vc.cardBorder),
              ),
              child: MarkdownBody(
                data: ev.text,
                selectable: true,
                styleSheet: _md,
                onTapLink: _openLink,
              ),
            ),
          ),
        );
    }
  }

  void _openLink(String text, String? href, String? title) {
    if (href == null) return;
    launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
  }

  MarkdownStyleSheet get _md => MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: const TextStyle(color: Colors.white, height: 1.4),
        code: const TextStyle(backgroundColor: Color(0xFF18181B), fontSize: 12),
        a: const TextStyle(color: Vc.green),
      );

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

  String _liveLabel() {
    final m = elapsed.inMinutes;
    final s = elapsed.inSeconds % 60;
    final clock = m <= 0 ? '${s}s' : '${m}m ${s.toString().padLeft(2, '0')}s';
    return 'Working · $clock · $toolCount tool${toolCount == 1 ? '' : 's'}';
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
    final updateReady = cli?['updateAvailable'] == true;
    final palette = showCommandPalette(_input.text);
    return WithForegroundTask(
      child: Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(instanceName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            if (working)
              Text(_liveLabel(), style: const TextStyle(fontSize: 11, color: Vc.green))
            else if (inst != null)
              Text(inst!.displayState, style: const TextStyle(fontSize: 11, color: Vc.muted)),
          ],
        ),
        actions: [
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
                Material(
                  color: const Color(0xFF1C1917),
                  child: ListTile(
                    dense: true,
                    title: Text(
                      'CLI ${cli!['current'] ?? '?'} · ${cli!['latest']} available',
                      style: const TextStyle(fontSize: 12),
                    ),
                    trailing: TextButton(
                      onPressed: () => context.push('/instance/$id', extra: inst),
                      child: const Text('Update'),
                    ),
                  ),
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
                            title: 'Start coding',
                            detail: 'Send a message, /command, or attach a file. Same agent as Telegram.',
                          )
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.only(bottom: 12, top: 8),
                            itemCount: events.length + (showKickoff ? 1 : 0),
                            itemBuilder: (ctx, i) {
                              if (i == events.length) {
                                return const Padding(
                                  padding: EdgeInsets.fromLTRB(12, 8, 12, 8),
                                  child: TypingDots(label: 'on it'),
                                );
                              }
                              return _bubble(events[i]);
                            },
                          ),
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
                  child: Container(
                    decoration: const BoxDecoration(
                      color: Vc.bg,
                      border: Border(top: BorderSide(color: Vc.cardBorder)),
                    ),
                    padding: const EdgeInsets.fromLTRB(4, 6, 4, 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        IconButton(onPressed: _commands, icon: const Icon(Icons.tag, color: Vc.muted)),
                        IconButton(
                          onPressed: sending ? null : _attach,
                          icon: const Icon(Icons.attach_file, color: Vc.muted),
                        ),
                        Expanded(
                          child: TextField(
                            controller: _input,
                            minLines: 1,
                            maxLines: 5,
                            textInputAction: TextInputAction.newline,
                            decoration: const InputDecoration(
                              hintText: 'Message your sandbox…',
                              border: InputBorder.none,
                              enabledBorder: InputBorder.none,
                              focusedBorder: InputBorder.none,
                              filled: false,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: sending ? null : () => _send(),
                          icon: sending
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Vc.green),
                                )
                              : const Icon(Icons.send, color: Vc.green),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
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