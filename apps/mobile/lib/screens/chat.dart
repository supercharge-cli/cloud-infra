import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

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
  StreamSubscription<AppChatEvent>? _sub;
  List<BotCommand> commands = [];
  bool sending = false;
  bool connecting = true;
  String? error;
  String connectLabel = 'Connecting to sandbox…';

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
    _boot();
  }

  Future<void> _boot() async {
    setState(() {
      connecting = true;
      connectLabel = widget.instance?.isPaused == true
          ? 'Waking paused sandbox…'
          : 'Connecting to sandbox…';
    });
    try {
      if (widget.instance?.isPaused == true) {
        await api.wake(id);
      }
    } catch (_) {
      /* events() also wakes */
    }
    _listen();
    api.commands(id).then((c) {
      if (mounted) setState(() => commands = c);
    }).catchError((_) {});
  }

  void _listen() {
    _sub?.cancel();
    _sub = api.events(id).listen((ev) {
      if (!mounted) return;
      setState(() {
        connecting = false;
        if (ev.type == 'done' || ev.type == 'text') sending = false;
        events.add(ev);
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
          );
        }
      });
    }, onError: (e) {
      if (mounted) {
        setState(() {
          connecting = false;
          error = e.toString();
        });
      }
    }, onDone: () {
      if (mounted) setState(() => connecting = false);
    });
    // If the stream is up but quiet, drop the overlay after a beat
    Future<void>.delayed(const Duration(seconds: 8), () {
      if (mounted && connecting) setState(() => connecting = false);
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send([String? text]) async {
    final t = (text ?? _input.text).trim();
    if (t.isEmpty) return;
    _input.clear();
    setState(() {
      sending = true;
      error = null;
      events.add(AppChatEvent({'type': 'user', 'text': t, 'id': 'local-${DateTime.now().millisecondsSinceEpoch}'}, local: true));
    });
    try {
      await api.sendChat(id, t);
    } catch (e) {
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
      setState(() {
        sending = false;
        error = e.toString();
      });
    }
  }

  void _commands() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Vc.card,
      builder: (ctx) => ListView(
        children: [
          const ListTile(title: Text('Commands', style: TextStyle(fontWeight: FontWeight.w700))),
          for (final c in commands)
            ListTile(
              title: Text('/${c.command}'),
              subtitle: Text(c.description, style: const TextStyle(color: Vc.muted)),
              onTap: () {
                Navigator.pop(ctx);
                _send('/${c.command}');
              },
            ),
        ],
      ),
    );
  }

  Widget _bubble(AppChatEvent ev) {
    switch (ev.type) {
      case 'user':
        return Align(
          alignment: Alignment.centerRight,
          child: Container(
            margin: const EdgeInsets.fromLTRB(48, 6, 12, 6),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Vc.greenDim,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(ev.text),
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
              const Icon(Icons.build, size: 16, color: Vc.amber),
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
        return _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Approval needed', style: TextStyle(fontWeight: FontWeight.w700, color: Vc.amber)),
              const SizedBox(height: 8),
              MarkdownBody(data: ev.text, styleSheet: _md),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  for (final c in ['once', 'session', 'always', 'deny'])
                    OutlinedButton(onPressed: () => api.approve(id, c), child: Text(c)),
                ],
              ),
            ],
          ),
        );
      case 'ask':
        return _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              MarkdownBody(data: ev.text, styleSheet: _md),
              const SizedBox(height: 8),
              for (var i = 0; i < ev.choices.length; i++)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${i + 1}. ${ev.choices[i]}'),
                  onTap: () => api.answer(id, ref: ev.ref, index: i, answer: ev.choices[i]),
                ),
            ],
          ),
        );
      case 'picker':
        return _card(
          child: Column(
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(ev.raw['title']?.toString() ?? 'Choose'),
              ),
              for (final o in ev.options.take(30))
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${o['label'] ?? o['value']}'),
                  selected: o['current'] == true,
                  onTap: () => api.pick(id, ref: ev.ref, value: '${o['value']}', kind: ev.kind),
                ),
            ],
          ),
        );
      case 'file':
        return ListTile(
          leading: Icon(ev.kind == 'photo' ? Icons.image : Icons.attach_file, color: Vc.green),
          title: Text(ev.name ?? 'file'),
          subtitle: const Text('From sandbox', style: TextStyle(color: Vc.muted)),
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
          child: Container(
            margin: const EdgeInsets.fromLTRB(12, 6, 48, 6),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Vc.card,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Vc.cardBorder),
            ),
            child: MarkdownBody(data: ev.text, selectable: true, styleSheet: _md),
          ),
        );
    }
  }

  MarkdownStyleSheet get _md => MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: const TextStyle(color: Colors.white, height: 1.4),
        code: const TextStyle(backgroundColor: Color(0xFF18181B), fontSize: 12),
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
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.instance?.name ?? 'Chat', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            if (working) const TypingDots(label: 'Agent') else if (widget.instance != null)
              Text(widget.instance!.displayState, style: const TextStyle(fontSize: 11, color: Vc.muted)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Stop',
            onPressed: () => api.stopChat(id),
            icon: const Icon(Icons.stop_circle_outlined),
          ),
          IconButton(
            tooltip: 'Control',
            onPressed: () => context.push('/instance/$id', extra: widget.instance),
            icon: const Icon(Icons.tune),
          ),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              if (error != null)
                Material(
                  color: const Color(0xFF450A0A),
                  child: ListTile(
                    dense: true,
                    title: Text(error!, style: const TextStyle(color: Vc.red, fontSize: 13)),
                    onTap: () => setState(() => error = null),
                  ),
                ),
              Expanded(
                child: events.isEmpty && !connecting
                    ? const Center(
                        child: Text(
                          'Send a message to start coding in this sandbox.',
                          style: TextStyle(color: Vc.muted),
                          textAlign: TextAlign.center,
                        ),
                      )
                    : ListView.builder(
                        controller: _scroll,
                        padding: const EdgeInsets.only(bottom: 12, top: 8),
                        itemCount: events.length,
                        itemBuilder: (ctx, i) => _bubble(events[i]),
                      ),
              ),
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
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _send(),
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
