import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../desktop/chat_workspace.dart';
import '../state/agents.dart';
import '../theme.dart';
import '../widgets/markdown.dart';
import 'bot_avatar.dart';
import 'bot_profile.dart';
import 'group_store.dart';

class GroupThread extends StatefulWidget {
  const GroupThread({
    super.key,
    required this.api,
    required this.instanceId,
    required this.accountId,
    required this.bots,
    required this.directory,
    required this.onOpenAgent,
    this.active = true,
  });
  final VectraClient api;
  final String instanceId;
  final String accountId;
  final List<BotProfile> bots;
  final AgentDirectory directory;
  final void Function(BotProfile bot, String? sessionId) onOpenAgent;
  final bool active;

  @override
  State<GroupThread> createState() => _GroupThreadState();
}

class _GroupThreadState extends State<GroupThread> with WidgetsBindingObserver {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _focus = FocusNode();
  final _messages = <Map<String, dynamic>>[];
  final _activity = <Map<String, dynamic>>[];
  final _mentioned = <String>{};
  late final GroupStore _store;
  Timer? _poll;
  Timer? _saveTimer;
  Future<void> _saving = Future.value();
  bool _loading = true;
  bool _refreshing = false;
  bool _sending = false;
  bool _foreground = true;
  bool _paused = false;
  String? _error;
  String? _retryId;
  String? _retryText;
  List<String> _retryMentions = [];

  @override
  void initState() {
    super.initState();
    _store = GroupStore(
      '${widget.api.baseUrl}:${widget.accountId}',
      widget.instanceId,
    );
    WidgetsBinding.instance.addObserver(this);
    _input.addListener(_draftChanged);
    unawaited(_initialize());
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_foreground && widget.active) unawaited(_refresh());
    });
  }

  Future<void> _initialize() async {
    final cache = await _store.load();
    if (!mounted) return;
    _messages.addAll(
      (cache['messages'] as List? ?? const []).whereType<Map>().map(
        (row) => Map<String, dynamic>.from(row),
      ),
    );
    _input.text = '${cache['draft'] ?? ''}';
    final unconfirmed = _messages
        .where((row) => row['failed'] == true || row['pending'] == true)
        .firstOrNull;
    if (unconfirmed != null) {
      _retryId = '${unconfirmed['id']}';
      _retryText = '${unconfirmed['text']}';
      _retryMentions = (unconfirmed['mentions'] as List? ?? const [])
          .map((id) => '$id')
          .toList();
      _error =
          'A previous message was not confirmed. Retry checks the same message without sending it twice.';
    }
    setState(() => _loading = _messages.isEmpty);
    await _refresh();
  }

  @override
  void didUpdateWidget(GroupThread oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) unawaited(_refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground && widget.active) unawaited(_refresh());
  }

  void _draftChanged() {
    if (mounted) setState(() {});
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 400), _save);
  }

  void _save() {
    final messages = _messages
        .map((message) => Map<String, dynamic>.from(message))
        .toList();
    final draft = _input.text;
    _saving = _saving
        .then((_) => _store.save(messages, draft))
        .catchError((Object _) {});
  }

  Future<void> _refresh() async {
    if (_refreshing || !mounted) return;
    _refreshing = true;
    try {
      final response = await widget.api.groupChat(widget.instanceId);
      if (!mounted) return;
      final incoming = (response['messages'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      final activity = (response['activity'] as List? ?? const [])
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      final nearBottom =
          !_scroll.hasClients || _scroll.position.extentAfter < 100;
      final prior = _messages.length;
      setState(() {
        _paused = response['paused'] == true;
        if (!_paused) {
          final byId = {for (final row in _messages) '${row['id']}': row};
          for (final row in incoming) {
            byId['${row['id']}'] = row;
            if (row['id'] == _retryId) {
              _retryId = null;
              _retryText = null;
              _retryMentions = [];
            }
          }
          _messages
            ..clear()
            ..addAll(byId.values);
          _messages.sort(
            (a, b) => ((a['createdAt'] as num?) ?? 0).compareTo(
              (b['createdAt'] as num?) ?? 0,
            ),
          );
          _activity
            ..clear()
            ..addAll(activity);
        }
        _loading = false;
        if (_retryId == null) _error = null;
      });
      widget.directory.updateActivity(widget.instanceId, activity);
      if (nearBottom && _messages.length != prior) _toBottom();
      _save();
    } catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.toString();
        });
      }
    } finally {
      _refreshing = false;
    }
  }

  String _newId() =>
      'group-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32).toRadixString(16)}';

  Future<void> _send({bool retry = false}) async {
    if (_sending) return;
    if (!retry && _retryId != null) {
      setState(
        () => _error =
            'Retry the unconfirmed message first. Your new draft is kept here.',
      );
      return;
    }
    final text = retry ? _retryText ?? '' : _input.text.trim();
    if (text.isEmpty) return;
    if (utf8.encode(text).length > 16000) {
      setState(() => _error = 'Keep group messages under 16,000 bytes.');
      return;
    }
    final id = retry ? _retryId ?? _newId() : _newId();
    final mentions = retry
        ? _retryMentions
        : _mentioned.where((id) {
            final bot = widget.bots.where((bot) => bot.id == id).firstOrNull;
            return bot != null && text.contains('@${bot.name}');
          }).toList();
    setState(() {
      _sending = true;
      _error = null;
      if (!retry) {
        _messages.add({
          'id': id,
          'text': text,
          'senderBotId': null,
          'mentions': mentions,
          'createdAt': DateTime.now().millisecondsSinceEpoch,
          'pending': true,
        });
        _input.clear();
        _mentioned.clear();
      }
    });
    _toBottom();
    try {
      await widget.api.sendGroupMessage(widget.instanceId, text, id, mentions);
      if (!mounted) return;
      setState(() {
        for (final row in _messages.where((row) => row['id'] == id)) {
          row.remove('pending');
          row.remove('failed');
        }
        _retryId = null;
        _retryText = null;
        _retryMentions = [];
      });
      unawaited(_refresh());
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _retryId = id;
        _retryText = text;
        _retryMentions = mentions;
        for (final row in _messages.where((row) => row['id'] == id)) {
          row['failed'] = true;
          row.remove('pending');
        }
      });
    } finally {
      if (mounted) {
        setState(() => _sending = false);
        _save();
      }
    }
  }

  Future<void> _stopAgent(Map<String, dynamic> item) async {
    if (_sending) return;
    final botId = item['botId'] as String?;
    final chatId = item['sessionId'] as String?;
    if (botId == null || chatId == null) return;
    setState(() => _sending = true);
    try {
      await widget.api.stopChat(
        widget.instanceId,
        botId: botId,
        chatId: chatId,
      );
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Map<String, dynamic>? get _steerTarget {
    final text = _input.text;
    final active = _activity
        .where(
          (item) =>
              item['groupMessageId'] != null && item['state'] == 'working',
        )
        .toList();
    final mentioned = widget.bots
        .where((bot) => text.contains('@${bot.name}'))
        .map((bot) => bot.id)
        .toSet();
    final candidates = mentioned.isEmpty
        ? active
        : active.where((item) => mentioned.contains(item['botId'])).toList();
    return candidates.length == 1 ? candidates.single : null;
  }

  Future<void> _submit() async {
    final target = _steerTarget;
    if (target != null && _retryId == null) {
      await _steerAgent(target);
    } else {
      await _send();
    }
  }

  Future<void> _steerAgent(Map<String, dynamic> item) async {
    final text = _input.text.trim();
    if (_sending || item['state'] != 'working' || text.isEmpty) return;
    final botId = item['botId'] as String?;
    final chatId = item['sessionId'] as String?;
    if (botId == null || chatId == null) return;
    setState(() => _sending = true);
    try {
      await widget.api.steerChat(
        widget.instanceId,
        text,
        botId: botId,
        chatId: chatId,
      );
      if (mounted && _input.text.trim() == text) _input.clear();
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _toBottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (mounted && _scroll.hasClients) {
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    }
  });

  String? get _mentionQuery {
    final position = _input.selection.baseOffset;
    if (position < 0 || position > _input.text.length) return null;
    final before = _input.text.substring(0, position);
    final match = RegExp(r'(?:^|\s)@([^@\n]{0,60})$').firstMatch(before);
    return match?.group(1)?.toLowerCase();
  }

  void _mention(BotProfile bot) {
    final position = _input.selection.baseOffset.clamp(0, _input.text.length);
    final before = _input.text.substring(0, position);
    final at = before.lastIndexOf('@');
    final start = at < 0 ? position : at;
    final value =
        '${_input.text.substring(0, start)}@${bot.name} ${_input.text.substring(position)}';
    _mentioned.add(bot.id);
    _input.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: start + bot.name.length + 2),
    );
    _focus.requestFocus();
  }

  Widget _message(Map<String, dynamic> message) {
    final sender = message['senderBotId'] as String?;
    final mine = sender == null;
    final bot = widget.bots.where((bot) => bot.id == sender).firstOrNull;
    final stamp = DateTime.fromMillisecondsSinceEpoch(
      (message['createdAt'] as num?)?.toInt() ?? 0,
    ).toLocal();
    final time =
        '${stamp.hour.toString().padLeft(2, '0')}:${stamp.minute.toString().padLeft(2, '0')}';
    return Padding(
      padding: EdgeInsets.fromLTRB(mine ? 46 : 16, 4, mine ? 16 : 46, 6),
      child: Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: mine ? Vc.sentBubble : Vc.card,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!mine)
                    InkWell(
                      onTap: bot == null
                          ? null
                          : () => widget.onOpenAgent(
                              bot,
                              message['sessionId'] as String?,
                            ),
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 7),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (bot != null)
                              BotAvatar(
                                bot: bot,
                                instanceId: widget.instanceId,
                                client: widget.api,
                                radius: 12,
                              ),
                            const SizedBox(width: 7),
                            Text(
                              bot?.name ?? sender,
                              style: const TextStyle(
                                color: Vc.greenSoft,
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                            ),
                            const SizedBox(width: 6),
                            const Icon(
                              Icons.open_in_new,
                              size: 12,
                              color: Vc.muted,
                            ),
                          ],
                        ),
                      ),
                    ),
                  if (message['kind'] == 'error')
                    SelectableText(
                      '${message['text'] ?? ''}',
                      style: const TextStyle(fontSize: 14, height: 1.5, color: Vc.red),
                    )
                  else
                    ChatMarkdown(data: '${message['text'] ?? ''}', soft: true),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        time,
                        style: const TextStyle(color: Vc.muted, fontSize: 10),
                      ),
                      if (mine) ...[
                        const SizedBox(width: 6),
                        Icon(
                          message['failed'] == true
                              ? Icons.error_outline
                              : message['pending'] == true
                              ? Icons.schedule
                              : Icons.done_all,
                          size: 13,
                          color: message['failed'] == true
                              ? Vc.red
                              : Vc.greenSoft,
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final query = _mentionQuery;
    final suggestions = query == null
        ? <BotProfile>[]
        : widget.bots
              .where(
                (bot) =>
                    bot.name.toLowerCase().contains(query) ||
                    bot.id.toLowerCase().contains(query),
              )
              .take(6)
              .toList();
    return Column(
      children: [
        if (_activity.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
            child: SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final item in _activity)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Row(
                        children: [
                          ActionChip(
                            avatar: Icon(
                              item['state'] == 'working'
                                  ? Icons.bolt_outlined
                                  : Icons.schedule,
                              color: item['state'] == 'working'
                                  ? Vc.greenSoft
                                  : Vc.amber,
                              size: 17,
                            ),
                            label: Text(
                              '${widget.bots.where((bot) => bot.id == item['botId']).firstOrNull?.name ?? item['botId']} · ${item['state']}',
                            ),
                            onPressed: () {
                              final bot = widget.bots
                                  .where((bot) => bot.id == item['botId'])
                                  .firstOrNull;
                              if (bot != null) {
                                widget.onOpenAgent(
                                  bot,
                                  item['sessionId'] as String?,
                                );
                              }
                            },
                          ),
                          if (item['groupMessageId'] != null)
                            IconButton(
                              tooltip: 'Stop ${item['botId']}',
                              onPressed: _sending
                                  ? null
                                  : () => _stopAgent(item),
                              icon: const Icon(Icons.stop_circle_outlined),
                            ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        if (_paused)
          const Padding(
            padding: EdgeInsets.all(12),
            child: Text(
              'Workspace paused · send a message to wake it',
              style: TextStyle(color: Vc.amber),
            ),
          ),
        if (_error != null)
          Material(
            color: Vc.elevated,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Row(
                children: [
                  const Icon(Icons.info_outline, size: 17, color: Vc.amber),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _error!,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                  TextButton(
                    onPressed: _sending
                        ? null
                        : _retryId == null
                        ? _refresh
                        : () => _send(retry: true),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
        Expanded(
          child: _loading
              ? const Center(
                  child: Text(
                    'Opening group chat…',
                    style: TextStyle(color: Vc.muted),
                  ),
                )
              : _messages.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.forum_outlined,
                          size: 42,
                          color: Vc.greenSoft,
                        ),
                        const SizedBox(height: 18),
                        const Text(
                          'Your agents, together',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 10),
                        const Text(
                          'Ask the group and Main will answer. Use @ to choose an agent. Everyone can read this group; direct chats stay separate.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Vc.muted, height: 1.5),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  itemCount: _messages.length,
                  itemBuilder: (_, index) => _message(_messages[index]),
                ),
        ),
        if (suggestions.isNotEmpty)
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 260),
            child: Material(
              color: Vc.elevated,
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final bot in suggestions)
                    ListTile(
                      dense: true,
                      leading: BotAvatar(
                        bot: bot,
                        instanceId: widget.instanceId,
                        client: widget.api,
                        radius: 16,
                      ),
                      title: Text(bot.name),
                      subtitle: Text(
                        '@${bot.id}',
                        style: const TextStyle(color: Vc.muted, fontSize: 11),
                      ),
                      onTap: () => _mention(bot),
                    ),
                ],
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: Vc.elevated,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(5, 5, 7, 5),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    tooltip: 'Mention an agent',
                    icon: const Icon(Icons.alternate_email, color: Vc.muted),
                    onPressed: () {
                      final text = _input.text;
                      _input.value = TextEditingValue(
                        text:
                            '$text${text.isEmpty || text.endsWith(' ') ? '' : ' '}@',
                        selection: TextSelection.collapsed(
                          offset:
                              text.length +
                              (text.isEmpty || text.endsWith(' ') ? 1 : 2),
                        ),
                      );
                      _focus.requestFocus();
                    },
                  ),
                  Expanded(
                    child: DesktopComposerKeys(
                      controller: _input,
                      onSend: () => unawaited(_submit()),
                      child: TextField(
                        key: const ValueKey('group-composer'),
                        controller: _input,
                        focusNode: _focus,
                        minLines: 1,
                        maxLines: 6,
                        decoration: const InputDecoration(
                          hintText: 'Message the group · @ to mention',
                          filled: false,
                          border: InputBorder.none,
                          enabledBorder: InputBorder.none,
                          focusedBorder: InputBorder.none,
                        ),
                      ),
                    ),
                  ),
                  IconButton.filled(
                    tooltip: _steerTarget != null && _retryId == null
                        ? 'Steer ${_steerTarget!['botId']}'
                        : 'Send group message',
                    onPressed: _sending || _input.text.trim().isEmpty
                        ? null
                        : _submit,
                    icon: Icon(
                      _sending ? Icons.more_horiz : Icons.arrow_upward,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _saveTimer?.cancel();
    _save();
    _input.removeListener(_draftChanged);
    _input.dispose();
    _scroll.dispose();
    _focus.dispose();
    super.dispose();
  }
}
