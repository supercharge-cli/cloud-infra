import 'dart:io';

import 'package:flutter/material.dart';

import '../chat/computer.dart';
import '../theme.dart';

class ComputerPane extends StatelessWidget {
  const ComputerPane({
    super.key,
    required this.state,
    required this.working,
    required this.expanded,
    required this.onToggle,
    required this.onSelectTab,
  });

  final ComputerState state;
  final bool working;
  final bool expanded;
  final VoidCallback onToggle;
  final ValueChanged<String> onSelectTab;

  @override
  Widget build(BuildContext context) {
    const radius = 14.0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(radius),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFF0B0D10),
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: Vc.cardBorder),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              InkWell(
                onTap: onToggle,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                  child: Row(
                    children: [
                      Icon(
                        state.isBrowser ? Icons.public : Icons.terminal,
                        size: 16,
                        color: working ? Vc.greenSoft : Vc.muted,
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'Computer',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          state.peekLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, color: Vc.muted),
                        ),
                      ),
                      if (working)
                        const Padding(
                          padding: EdgeInsets.only(right: 4),
                          child: SizedBox(
                            width: 10,
                            height: 10,
                            child: CircularProgressIndicator(strokeWidth: 1.5, color: Vc.greenSoft),
                          ),
                        ),
                      IconButton(
                        tooltip: expanded ? 'Minimize' : 'Expand',
                        visualDensity: VisualDensity.compact,
                        onPressed: onToggle,
                        icon: Icon(
                          expanded ? Icons.expand_more : Icons.expand_less,
                          size: 20,
                          color: Vc.faint,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (expanded) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                  child: Row(
                    children: [
                      _TabChip(
                        label: 'Terminal',
                        selected: !state.isBrowser,
                        onTap: () => onSelectTab('terminal'),
                      ),
                      const SizedBox(width: 6),
                      _TabChip(
                        label: 'Browser',
                        selected: state.isBrowser,
                        onTap: () => onSelectTab('browser'),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final width = constraints.maxWidth;
                      final height = (width * 9 / 16).clamp(148.0, 200.0);
                      return ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: SizedBox(
                          width: width,
                          height: height,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: const Color(0xFF09090B),
                              border: Border.all(color: Vc.cardBorder),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: state.isBrowser
                                ? _BrowserView(state: state)
                                : _TerminalView(state: state),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _TabChip extends StatelessWidget {
  const _TabChip({required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? Vc.elevated : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: selected ? Vc.greenDim : Vc.cardBorder),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: selected ? Vc.greenSoft : Vc.muted,
          ),
        ),
      ),
    );
  }
}

class _TerminalView extends StatelessWidget {
  const _TerminalView({required this.state});
  final ComputerState state;

  @override
  Widget build(BuildContext context) {
    if (state.lines.isEmpty) {
      return const Center(
        child: Text('No commands yet', style: TextStyle(color: Vc.faint, fontSize: 12)),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      itemCount: state.lines.length,
      itemBuilder: (ctx, i) {
        final line = state.lines[i];
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '\$ ${line.command}',
                softWrap: true,
                overflow: TextOverflow.fade,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  height: 1.35,
                  color: line.running ? Vc.amber : Vc.greenSoft,
                ),
              ),
              if (line.stdout.isNotEmpty)
                Text(
                  line.stdout,
                  softWrap: true,
                  overflow: TextOverflow.fade,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    height: 1.35,
                    color: Color(0xFFD4D4D8),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _BrowserView extends StatelessWidget {
  const _BrowserView({required this.state});
  final ComputerState state;

  @override
  Widget build(BuildContext context) {
    Widget frame;
    final jpeg = state.liveJpeg;
    final path = state.stillPath;
    if (jpeg != null && jpeg.isNotEmpty) {
      frame = Image.memory(
        jpeg,
        fit: BoxFit.contain,
        width: double.infinity,
        height: double.infinity,
        alignment: Alignment.center,
        gaplessPlayback: true,
        filterQuality: FilterQuality.medium,
      );
    } else if (path != null && File(path).existsSync()) {
      frame = Image.file(
        File(path),
        fit: BoxFit.contain,
        width: double.infinity,
        height: double.infinity,
        alignment: Alignment.center,
      );
    } else if (state.stillUrl != null && state.stillUrl!.startsWith('http')) {
      frame = Image.network(
        state.stillUrl!,
        fit: BoxFit.contain,
        width: double.infinity,
        height: double.infinity,
        alignment: Alignment.center,
      );
    } else {
      frame = Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            state.browserLabel ?? 'No page open',
            textAlign: TextAlign.center,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Vc.muted, fontSize: 12),
          ),
        ),
      );
    }
    final liveChip = state.live
        ? 'LIVE'
        : state.livePaused
            ? 'Live paused'
            : null;
    return Stack(
      clipBehavior: Clip.hardEdge,
      fit: StackFit.expand,
      children: [
        ColoredBox(color: const Color(0xFF09090B), child: frame),
        if (liveChip != null)
          Positioned(
            top: 8,
            left: 8,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: (state.live ? Vc.greenDim : Colors.black).withValues(alpha: 0.8),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                child: Text(
                  liveChip,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: state.live ? Vc.greenSoft : Vc.muted,
                  ),
                ),
              ),
            ),
          ),
        if (state.browserLabel != null)
          Positioned(
            left: 8,
            right: 8,
            bottom: 8,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.72),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                child: Text(
                  [
                    state.browserLabel,
                    if (state.browserUrl != null) state.browserUrl,
                  ].whereType<String>().join('\n'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, color: Colors.white),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
