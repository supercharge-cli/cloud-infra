import 'dart:async';

import 'package:flutter/material.dart';

/// Inbox order for the multi-bot list. Unread first, then a live turn, then a queue.
int rosterRank({required bool unread, required bool working, required bool queued}) {
  if (unread) return 0;
  if (working) return 1;
  if (queued) return 2;
  return 3;
}

String formatTurnClock(Duration d) {
  final m = d.inMinutes;
  final s = d.inSeconds % 60;
  if (d.inHours > 0) return '${d.inHours}h ${m % 60}m';
  if (m > 0) return '${m}m ${s.toString().padLeft(2, '0')}s';
  return '${s}s';
}

/// One line under a bot name. A live state prefixes the last message.
String rosterPreview({
  required bool working,
  required bool queued,
  required String preview,
}) {
  if (working) return 'Working · $preview';
  if (queued) return 'Queued · $preview';
  return preview;
}

/// The turn clock ticks on its own. The chat screen does not rebuild for each second.
class TurnClock extends StatefulWidget {
  const TurnClock({
    super.key,
    required this.startedAt,
    this.etaMs,
    this.tools = 0,
    this.idle,
  });

  final DateTime? startedAt;
  final int? etaMs;
  final int tools;
  final Duration? idle;

  @override
  State<TurnClock> createState() => _TurnClockState();
}

class _TurnClockState extends State<TurnClock> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _arm();
  }

  @override
  void didUpdateWidget(TurnClock old) {
    super.didUpdateWidget(old);
    if (old.startedAt != widget.startedAt) _arm();
  }

  void _arm() {
    _timer?.cancel();
    if (widget.startedAt == null) return;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final started = widget.startedAt;
    final text = started == null
        ? (widget.idle == null ? 'Chat' : formatTurnClock(widget.idle!))
        : [
            formatTurnClock(DateTime.now().difference(started)),
            if (widget.etaMs != null && widget.etaMs! > 0)
              '~${formatTurnClock(Duration(milliseconds: widget.etaMs!))} left',
            if (widget.tools > 0)
              '${widget.tools} tool${widget.tools == 1 ? '' : 's'}',
          ].join(' · ');
    return Text(
      text,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(color: Color(0xFF8B93A7), fontSize: 11),
    );
  }
}
