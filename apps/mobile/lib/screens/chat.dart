import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/session.dart';

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
  String? error;

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;

  @override
  void initState() {
    super.initState();
    _listen();
    api.commands(id).then((c) {
      if (mounted) setState(() => commands = c);
    }).catchError((_) {});
  }

  void _listen() {
    _sub?.cancel();
    _sub = api.events(id).listen((ev) {
      setState(() => events.add(ev));
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.jumpTo(_scroll.position.maxScrollExtent);
        }
      });
    }, onError: (e) {
      if (mounted) setState(() => error = e.toString());
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
    });
    try {
      await api.sendChat(id, t);
    } catch (e) {
      setState(() => error = e.toString());
    }
    if (mounted) setState(() => sending = false);
  }

  Future<void> _attach() async {
    final picked = await FilePicker.pickFiles();
    if (picked.isEmpty) return;
    final f = picked.first;
    final bytes = await f.readAsBytes();
    setState(() => sending = true);
    try {
      await api.upload(
        id,
        name: f.name,
        bytes: bytes,
        caption: _input.text.trim(),
      );
      _input.clear();
    } catch (e) {
      setState(() => error = e.toString());
    }
    if (mounted) setState(() => sending = false);
  }

  void _commands() {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => ListView(
        children: [
          const ListTile(title: Text('Commands')),
          for (final c in commands)
            ListTile(
              title: Text('/${c.command}'),
              subtitle: Text(c.description),
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
      case 'typing':
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
          child: Text(ev.text.isEmpty ? '…' : ev.text, style: const TextStyle(color: Colors.white54)),
        );
      case 'tool':
        return Card(
          color: const Color(0xFF1F2937),
          child: ListTile(
            dense: true,
            leading: const Icon(Icons.build, size: 18),
            title: Text(ev.name ?? 'tool'),
            subtitle: Text(ev.text),
          ),
        );
      case 'approve':
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Approval needed', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                MarkdownBody(data: ev.text),
                const SizedBox(height: 8),
                Wrap(spacing: 8, children: [
                  for (final c in ['once', 'session', 'always', 'deny'])
                    OutlinedButton(onPressed: () => api.approve(id, c), child: Text(c)),
                ]),
              ],
            ),
          ),
        );
      case 'ask':
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                MarkdownBody(data: ev.text),
                const SizedBox(height: 8),
                for (var i = 0; i < ev.choices.length; i++)
                  ListTile(
                    dense: true,
                    title: Text('${i + 1}. ${ev.choices[i]}'),
                    onTap: () => api.answer(id, ref: ev.ref, index: i, answer: ev.choices[i]),
                  ),
              ],
            ),
          ),
        );
      case 'picker':
        return Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ListTile(title: Text(ev.raw['title']?.toString() ?? 'Choose')),
              for (final o in ev.options.take(30))
                ListTile(
                  dense: true,
                  title: Text('${o['label'] ?? o['value']}'),
                  selected: o['current'] == true,
                  onTap: () => api.pick(
                    id,
                    ref: ev.ref,
                    value: '${o['value']}',
                    kind: ev.kind,
                  ),
                ),
            ],
          ),
        );
      case 'file':
        return ListTile(
          leading: Icon(ev.kind == 'photo' ? Icons.image : Icons.attach_file),
          title: Text(ev.name ?? 'file'),
          subtitle: const Text('Saved from the sandbox'),
        );
      case 'error':
        return Padding(
          padding: const EdgeInsets.all(12),
          child: Text(ev.text, style: const TextStyle(color: Colors.redAccent)),
        );
      case 'done':
        return const SizedBox.shrink();
      default:
        if (ev.text.isEmpty) return const SizedBox.shrink();
        return Align(
          alignment: Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF111827),
              borderRadius: BorderRadius.circular(12),
            ),
            child: MarkdownBody(data: ev.text, selectable: true),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.instance?.name ?? 'Chat'),
        actions: [
          IconButton(onPressed: () => api.stopChat(id), icon: const Icon(Icons.stop)),
          IconButton(
            onPressed: () => context.push('/instance/$id', extra: widget.instance),
            icon: const Icon(Icons.settings),
          ),
        ],
      ),
      body: Column(
        children: [
          if (error != null)
            Material(
              color: Colors.red.shade900,
              child: ListTile(dense: true, title: Text(error!), onTap: () => setState(() => error = null)),
            ),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.only(bottom: 12),
              itemCount: events.length,
              itemBuilder: (ctx, i) => _bubble(events[i]),
            ),
          ),
          SafeArea(
            child: Row(
              children: [
                IconButton(onPressed: _commands, icon: const Icon(Icons.tag)),
                IconButton(onPressed: sending ? null : _attach, icon: const Icon(Icons.attach_file)),
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
                    ),
                  ),
                ),
                IconButton(
                  onPressed: sending ? null : () => _send(),
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
