import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../chat/computer.dart';
import '../theme.dart';
import '../desktop.dart';
import '../widgets/computer_pane.dart';

class DesktopChatWorkspace extends StatefulWidget {
  const DesktopChatWorkspace({
    super.key,
    required this.chat,
    required this.computer,
    required this.showComputer,
    required this.onCloseComputer,
    required this.onRunCommand,
    required this.onManualControl,
  });

  final Widget chat;
  final ComputerState computer;
  final bool showComputer;
  final VoidCallback onCloseComputer;
  final Future<void> Function(String) onRunCommand;
  final Future<void> Function()? onManualControl;

  @override
  State<DesktopChatWorkspace> createState() => _DesktopChatWorkspaceState();
}

class _DesktopChatWorkspaceState extends State<DesktopChatWorkspace> {
  double _fraction = .54;
  final _command = TextEditingController();
  bool _running = false;

  @override
  void dispose() {
    _command.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    final command = _command.text.trim();
    if (command.isEmpty || _running) return;
    setState(() => _running = true);
    _command.clear();
    try {
      await widget.onRunCommand(command);
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final chat = Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: widget.chat,
        ),
      );
      if (!widget.showComputer) return chat;
      if (constraints.maxWidth < 780) {
        return Column(
          children: [
            Expanded(flex: 3, child: chat),
            const Divider(height: 1),
            Expanded(flex: 2, child: _computerPane()),
          ],
        );
      }
      final available = constraints.maxWidth - 7;
      final chatWidth = (available * _fraction).clamp(380.0, available - 340.0);
      return Row(
        children: [
          SizedBox(width: chatWidth, child: chat),
          Semantics(
            label: 'Resize chat and computer panes',
            child: FocusableActionDetector(
              mouseCursor: SystemMouseCursors.resizeColumn,
              shortcuts: const {
                SingleActivator(LogicalKeyboardKey.arrowLeft): _ResizeIntent(
                  -.04,
                ),
                SingleActivator(LogicalKeyboardKey.arrowRight): _ResizeIntent(
                  .04,
                ),
              },
              actions: {
                _ResizeIntent: CallbackAction<_ResizeIntent>(
                  onInvoke: (intent) {
                    setState(
                      () =>
                          _fraction = (_fraction + intent.delta).clamp(.3, .7),
                    );
                    return null;
                  },
                ),
              },
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onHorizontalDragUpdate: (details) => setState(() {
                  _fraction = (_fraction + details.delta.dx / available).clamp(
                    .3,
                    .7,
                  );
                }),
                child: Container(
                  width: 7,
                  color: Vc.cardBorder,
                  child: const Center(child: SizedBox(width: 1)),
                ),
              ),
            ),
          ),
          Expanded(child: _computerPane()),
        ],
      );
    },
  );

  Widget _computerPane() => ListenableBuilder(
    listenable: widget.computer,
    builder: (context, _) {
      final state = widget.computer;
      return ColoredBox(
        color: Vc.surface,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
              child: Row(
                children: [
                  SegmentedButton<String>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(
                        value: 'terminal',
                        icon: Icon(Icons.terminal, size: 16),
                        label: Text('Terminal'),
                      ),
                      ButtonSegment(
                        value: 'browser',
                        icon: Icon(Icons.public, size: 16),
                        label: Text('Browser'),
                      ),
                    ],
                    selected: {state.tab},
                    onSelectionChanged: (selection) =>
                        state.tab = selection.first,
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Hide computer (Ctrl+J)',
                    onPressed: widget.onCloseComputer,
                    icon: const Icon(Icons.close, size: 18),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: state.isBrowser
                  ? ComputerBrowserView(state: state, compact: false)
                  : ComputerTerminalView(state: state, compact: false),
            ),
            const Divider(height: 1),
            if (!state.isBrowser)
              Padding(
                padding: const EdgeInsets.all(10),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _command,
                        enabled: !_running,
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 13,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Run a command in the workspace…',
                          prefixText: '\$ ',
                          isDense: true,
                        ),
                        onSubmitted: (_) => unawaited(_run()),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton(
                      tooltip: 'Run command',
                      onPressed: _running ? null : _run,
                      icon: const Icon(Icons.play_arrow, color: Vc.greenSoft),
                    ),
                  ],
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.all(10),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        state.live
                            ? 'Watching the AI browser live'
                            : 'Waiting for browser activity',
                        style: const TextStyle(color: Vc.muted, fontSize: 12),
                      ),
                    ),
                    if (widget.onManualControl != null)
                      OutlinedButton.icon(
                        onPressed: widget.onManualControl,
                        icon: const Icon(Icons.ads_click, size: 16),
                        label: const Text('Take control'),
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

class _ResizeIntent extends Intent {
  const _ResizeIntent(this.delta);
  final double delta;
}

class DesktopComposerKeys extends StatelessWidget {
  const DesktopComposerKeys({
    super.key,
    required this.controller,
    required this.onSend,
    this.onPaste,
    required this.child,
  });
  final TextEditingController controller;
  final VoidCallback onSend;
  final VoidCallback? onPaste;
  final Widget child;

  @override
  Widget build(BuildContext context) => !isDesktop
      ? child
      : Focus(
          onKeyEvent: (_, event) {
            if (onPaste != null &&
                event is KeyDownEvent &&
                event.logicalKey == LogicalKeyboardKey.keyV &&
                HardwareKeyboard.instance.isControlPressed &&
                !HardwareKeyboard.instance.isShiftPressed) {
              onPaste!();
              return KeyEventResult.handled;
            }
            if (event is! KeyDownEvent ||
                (event.logicalKey != LogicalKeyboardKey.enter &&
                    event.logicalKey != LogicalKeyboardKey.numpadEnter) ||
                HardwareKeyboard.instance.isShiftPressed ||
                HardwareKeyboard.instance.isAltPressed ||
                (controller.value.composing.isValid &&
                    !controller.value.composing.isCollapsed)) {
              return KeyEventResult.ignored;
            }
            onSend();
            return KeyEventResult.handled;
          },
          child: child,
        );
}
