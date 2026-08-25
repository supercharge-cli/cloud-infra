import 'dart:io';

import 'package:flutter/material.dart';

import '../chat/computer.dart';
import '../theme.dart';

class ComputerBar extends StatelessWidget {
  const ComputerBar({
    super.key,
    required this.state,
    required this.title,
    required this.onOpen,
  });

  final ComputerState state;
  final String title;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
      child: Material(
        color: const Color(0xFF1C1E24),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onOpen,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 10, 8),
            child: Row(
              children: [
                ComputerThumb(state: state, width: 58, height: 42),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: Color(0xFFD4D4D8),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                const Icon(Icons.keyboard_arrow_down_rounded, size: 22, color: Vc.faint),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class ComputerPage extends StatelessWidget {
  const ComputerPage({
    super.key,
    required this.state,
    required this.instanceName,
    required this.onClose,
    required this.onSelectTab,
    this.onBrowserHandoff,
  });

  final ComputerState state;
  final String instanceName;
  final VoidCallback onClose;
  final ValueChanged<String> onSelectTab;
  final Future<void> Function()? onBrowserHandoff;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        return PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) onClose();
          },
          child: Scaffold(
            backgroundColor: const Color(0xFF0B0B0D),
            body: SafeArea(
              child: Column(
                children: [
                  SizedBox(
                    height: 52,
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Close',
                          onPressed: onClose,
                          icon: const Icon(Icons.close, size: 22),
                        ),
                        Expanded(
                          child: Text(
                            "$instanceName's computer",
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                          ),
                        ),
                        PopupMenuButton<String>(
                          tooltip: 'Terminal or Browser',
                          initialValue: state.tab,
                          onSelected: onSelectTab,
                          position: PopupMenuPosition.under,
                          itemBuilder: (ctx) => [
                            PopupMenuItem(
                              value: 'terminal',
                              child: _ViewMenuRow(
                                icon: Icons.terminal,
                                label: 'Terminal',
                                selected: !state.isBrowser,
                              ),
                            ),
                            PopupMenuItem(
                              value: 'browser',
                              child: _ViewMenuRow(
                                icon: Icons.public,
                                label: 'Browser',
                                selected: state.isBrowser,
                              ),
                            ),
                          ],
                          child: Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: Vc.cardBorder),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      state.isBrowser ? Icons.public : Icons.desktop_windows_outlined,
                                      size: 18,
                                      color: Colors.white,
                                    ),
                                    const SizedBox(width: 2),
                                    const Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: Vc.faint),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        if (onBrowserHandoff != null)
                          IconButton(
                            tooltip: 'Take browser control',
                            onPressed: onBrowserHandoff,
                            icon: const Icon(Icons.security, size: 20),
                          ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: const Color(0xFF141518),
                          borderRadius: BorderRadius.circular(22),
                          border: Border.all(color: const Color(0xFF2A2E36)),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(22),
                          child: Column(
                            children: [
                              SizedBox(
                                height: 40,
                                child: Center(
                                  child: Text(
                                    instanceName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 12, color: Vc.muted),
                                  ),
                                ),
                              ),
                              const Divider(height: 1, color: Color(0xFF2A2E36)),
                              Expanded(
                                child: state.isBrowser
                                    ? ComputerBrowserView(state: state, compact: false)
                                    : ComputerTerminalView(state: state, compact: false),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
                    child: Row(
                      children: [
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: const Color(0xFF1C1E24),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Vc.cardBorder),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: Icon(
                              state.isBrowser ? Icons.public : Icons.terminal,
                              size: 22,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                state.usingLabel,
                                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                state.usingDetail,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 13, color: Vc.muted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: state.live || state.agentWorking ? Vc.green : Vc.faint,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          state.live
                              ? 'Live'
                              : state.livePaused
                                  ? 'Live paused'
                                  : state.agentWorking
                                      ? 'Live'
                                      : 'Idle',
                          style: const TextStyle(fontSize: 13, color: Vc.muted, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _ViewMenuRow extends StatelessWidget {
  const _ViewMenuRow({required this.icon, required this.label, required this.selected});
  final IconData icon;
  final String label;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: selected ? Vc.greenSoft : Colors.white),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? Vc.greenSoft : Colors.white,
            ),
          ),
        ),
        if (selected) const Icon(Icons.check, size: 16, color: Vc.greenSoft),
      ],
    );
  }
}

class ComputerThumb extends StatelessWidget {
  const ComputerThumb({
    super.key,
    required this.state,
    this.width = 58,
    this.height = 42,
  });

  final ComputerState state;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: SizedBox(
        width: width,
        height: height,
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Color(0xFF09090B)),
            if (state.hasPreview)
              ComputerBrowserView(state: state, compact: true, fit: BoxFit.cover)
            else
              Padding(
                padding: const EdgeInsets.all(5),
                child: Align(
                  alignment: Alignment.topLeft,
                  child: Text(
                    state.isBrowser ? 'browser' : (state.lines.isEmpty ? '\$ _' : '\$ ${state.peekLabel}'),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 7,
                      height: 1.25,
                      color: state.isBrowser ? Vc.muted : Vc.greenSoft,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class ComputerTerminalView extends StatelessWidget {
  const ComputerTerminalView({super.key, required this.state, this.compact = false});
  final ComputerState state;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (state.lines.isEmpty) {
      return const Center(
        child: Text('No commands yet', style: TextStyle(color: Vc.faint, fontSize: 13)),
      );
    }
    final fontSize = compact ? 10.0 : 12.5;
    return ListView.builder(
      padding: EdgeInsets.fromLTRB(compact ? 8 : 14, compact ? 6 : 12, compact ? 8 : 14, compact ? 8 : 16),
      itemCount: state.lines.length,
      itemBuilder: (ctx, i) {
        final line = state.lines[i];
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '\$ ${line.command}',
                softWrap: true,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: fontSize,
                  height: 1.4,
                  color: line.running ? Vc.amber : Vc.greenSoft,
                ),
              ),
              if (line.stdout.isNotEmpty)
                Text(
                  line.stdout,
                  softWrap: true,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: fontSize,
                    height: 1.4,
                    color: const Color(0xFFD4D4D8),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class ComputerBrowserView extends StatelessWidget {
  const ComputerBrowserView({
    super.key,
    required this.state,
    this.compact = false,
    this.fit = BoxFit.contain,
  });

  final ComputerState state;
  final bool compact;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    Widget frame;
    final jpeg = state.liveJpeg;
    final path = state.stillPath;
    if (jpeg != null && jpeg.isNotEmpty) {
      frame = Image.memory(
        jpeg,
        fit: fit,
        width: double.infinity,
        height: double.infinity,
        alignment: Alignment.center,
        gaplessPlayback: true,
        filterQuality: FilterQuality.medium,
      );
    } else if (path != null && File(path).existsSync()) {
      frame = Image.file(
        File(path),
        fit: fit,
        width: double.infinity,
        height: double.infinity,
        alignment: Alignment.center,
      );
    } else if (state.stillUrl != null && state.stillUrl!.startsWith('http')) {
      frame = Image.network(
        state.stillUrl!,
        fit: fit,
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
            style: const TextStyle(color: Vc.muted, fontSize: 13),
          ),
        ),
      );
    }
    if (compact) return frame;
    return Stack(
      clipBehavior: Clip.hardEdge,
      fit: StackFit.expand,
      children: [
        ColoredBox(color: const Color(0xFF09090B), child: frame),
        if (state.browserLabel != null && state.browserLabel!.isNotEmpty)
          Positioned(
            left: 12,
            right: 12,
            bottom: 12,
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
