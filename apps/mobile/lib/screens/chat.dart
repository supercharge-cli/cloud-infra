import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/ui.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.instanceId, this.instance});
  final String instanceId;
  final CloudInstance? instance;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final events = <AppChatEvent>[];
  final answered = <String>{};
  StreamSubscription<AppChatEvent>? _sub;
  List<BotCommand> commands = [];
  CloudInstance? inst;
  Map<String, dynamic>? cli;
  bool sending = false;
  bool connecting = true;
  bool reconnecting = false;
  bool disposed = false;
  bool paymentBlocked = false;
  String? error;
  String connectLabel = 'Connecting to sandbox…';
  String? lastServerId;

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;

  bool get working {
    if (sending) return true;
    if (events.isEmpty) return false;
    final last = events.last.type;
    return last == 'typing' || last == 'tool';
  }

  @override
  void initState() {
    super.initState();
    inst = widget.instance;
    _boot();
  }

  Future<void> _boot() async {
    setState(() {
      connecting = true;
      paymentBlocked = false;
      connectLabel = inst?.isPaused == true ? 'Waking paused sandbox…' : 'Connecting to sandbox…';
    });
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
      if (mounted) setState(() => commands = c);
    }).catchError((_) {});
    api.cliVersion(id).then((c) {
      if (mounted) setState(() => cli = c);
    }).catchError((_) {});
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
            if (connecting) {
              error = e.message;
              connecting = false;
            } else {
              reconnecting = true;
            }
          });
        }
      } catch (e) {
        if (!disposed && mounted && connecting) {
          setState(() {
            error = e.toString();
            connecting = false;
          });
        } else if (!disposed && mounted) {
          setState(() => reconnecting = true);
        }
      }
      if (disposed) return;
      await Future<void>.delayed(Duration(seconds: delay));
      delay = math.min(delay * 2, 12);
    }
  }

  void _ingest(AppChatEvent ev) {
    if (!ev.local && ev.id.isNotEmpty) {
      lastServerId = ev.id;
      if (events.any((e) => !e.local && e.id == ev.id)) return;
    }
    if (ev.type == 'done') {
      sending = false;
      events.removeWhere((e) => e.type == 'typing');
      return;
    }
    if (ev.type == 'text' || ev.type == 'error') sending = false;
    if (ev.type == 'typing') {
      events.removeWhere((e) => e.type == 'typing');
      events.add(ev);
      return;
    }
    if (ev.type == 'tool') {
      events.removeWhere((e) => e.type == 'typing');
      final i = events.lastIndexWhere((e) => e.type == 'tool' && e.state != 'done');
      if (i >= 0) {
        events[i] = ev;
        return;
      }
    }
    events.add(ev);
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
    _sub?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? text]) async {
    final t = (text ?? _input.text).trim();
    if (t.isEmpty || sending) return;
    _input.clear();
    HapticFeedback.lightImpact();
    setState(() {
      sending = true;
      error = null;
      events.add(AppChatEvent({
        'type': 'user',
        'text': t,
        'id': 'local-${DateTime.now().millisecondsSinceEpoch}',
      }, local: true));
    });
    _scrollToEnd();
    try {
      await api.sendChat(id, t);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        sending = false;
        error = e.toString();
      });
    }
  }

  Future<void> _attach() async {
    final picked = await FilePicker.pickFiles();
    if (picked.isEmpty) return;
    final f = picked.first;
    final bytes = await f.readAsBytes();
    setState(() {
      sending = true;
      events.add(AppChatEvent({
        'type': 'user',
        'text': 'Attached ${f.name}',
        'id': 'local-file-${DateTime.now().millisecondsSinceEpoch}',
      }, local: true));
    });
    try {
      await api.upload(id, name: f.name, bytes: bytes, caption: _input.text.trim());
      _input.clear();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        sending = false;
        error = e.toString();
      });
    }
  }

  Future<void> _download(AppChatEvent ev) async {
    final fileId = ev.fileId;
    if (fileId == null) return;
    setState(() => error = null);
    try {
      final file = await api.downloadFile(id, fileId);
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/${file.name}';
      await File(path).writeAsBytes(file.bytes);
      await SharePlus.instance.share(ShareParams(files: [XFile(path)], text: file.name));
    } catch (e) {
      if (!mounted) return;
      setState(() => error = e.toString());
    }
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
    await api.answer(id, ref: ev.ref, answer: text);
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
            final filtered = commands.where((c) {
              if (q.isEmpty) return true;
              return c.command.contains(q) || c.description.toLowerCase().contains(q);
            }).toList();
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
                                _send('/${c.command}');
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
      case 'typing':
        return Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
          child: TypingDots(label: ev.text.isEmpty ? 'Working' : ev.text),
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
                          api.pick(id, ref: ev.ref, value: '${o['value']}', kind: ev.kind);
                        },
                ),
            ],
          ),
        );
      case 'file':
        return ListTile(
          leading: Icon(ev.kind == 'photo' ? Icons.image : Icons.attach_file, color: Vc.green),
          title: Text(ev.name ?? 'file'),
          subtitle: const Text('Tap to save / share', style: TextStyle(color: Vc.muted)),
          onTap: () => _download(ev),
        );
      case 'error':
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Text(ev.text, style: const TextStyle(color: Vc.red)),
        );
      case 'done':
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

  @override
  Widget build(BuildContext context) {
    final name = inst?.name ?? widget.instance?.name ?? 'Chat';
    final updateReady = cli?['updateAvailable'] == true;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            if (working)
              const TypingDots(label: 'Agent')
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
                    : events.isEmpty && !connecting
                        ? const EmptyState(
                            icon: Icons.chat_bubble_outline,
                            title: 'Start coding',
                            detail: 'Send a message, /command, or attach a file. Same agent as Telegram.',
                          )
                        : ListView.builder(
                            controller: _scroll,
                            padding: const EdgeInsets.only(bottom: 12, top: 8),
                            itemCount: events.length,
                            itemBuilder: (ctx, i) => _bubble(events[i]),
                          ),
              ),
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
          if (connecting)
            BusyOverlay(
              message: connectLabel,
              detail: 'Waking the VM and opening the chat inbox',
            ),
        ],
      ),
    );
  }
}
