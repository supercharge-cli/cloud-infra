import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../desktop.dart';
import '../theme.dart';

enum DesktopCommand {
  workspaces,
  newWorkspace,
  newChat,
  history,
  commands,
  focusComposer,
  attach,
  stop,
  files,
  computer,
  preview,
  settings,
  account,
  refresh,
  search,
  save,
  export,
  sidebar,
  shortcuts,
}

class CommandIntent extends Intent {
  const CommandIntent(this.command);
  final DesktopCommand command;
}

class CommandBinding {
  const CommandBinding(
    this.command,
    this.label,
    this.key, {
    this.control = true,
    this.shift = false,
    this.alt = false,
  });

  final DesktopCommand command;
  final String label;
  final LogicalKeyboardKey key;
  final bool control;
  final bool shift;
  final bool alt;

  SingleActivator get activator => SingleActivator(
    key,
    control: control,
    shift: shift,
    alt: alt,
    includeRepeats: false,
  );

  String get shortcut => [
    if (control) 'Ctrl',
    if (alt) 'Alt',
    if (shift) 'Shift',
    key == LogicalKeyboardKey.comma ? ',' : key.keyLabel,
  ].join('+');
}

const desktopBindings = [
  CommandBinding(
    DesktopCommand.workspaces,
    'Workspaces',
    LogicalKeyboardKey.digit1,
  ),
  CommandBinding(
    DesktopCommand.newWorkspace,
    'New workspace',
    LogicalKeyboardKey.keyN,
    shift: true,
  ),
  CommandBinding(
    DesktopCommand.newChat,
    'New conversation',
    LogicalKeyboardKey.keyN,
  ),
  CommandBinding(
    DesktopCommand.history,
    'Conversation history',
    LogicalKeyboardKey.keyH,
  ),
  CommandBinding(
    DesktopCommand.commands,
    'Command palette',
    LogicalKeyboardKey.keyK,
  ),
  CommandBinding(
    DesktopCommand.focusComposer,
    'Focus message',
    LogicalKeyboardKey.keyL,
  ),
  CommandBinding(
    DesktopCommand.attach,
    'Attach files',
    LogicalKeyboardKey.keyO,
  ),
  CommandBinding(DesktopCommand.stop, 'Stop task', LogicalKeyboardKey.period),
  CommandBinding(
    DesktopCommand.files,
    'Workspace files',
    LogicalKeyboardKey.keyE,
    shift: true,
  ),
  CommandBinding(
    DesktopCommand.computer,
    'Show / hide computer',
    LogicalKeyboardKey.keyJ,
  ),
  CommandBinding(
    DesktopCommand.preview,
    'Website preview',
    LogicalKeyboardKey.keyP,
    shift: true,
  ),
  CommandBinding(
    DesktopCommand.settings,
    'Workspace settings',
    LogicalKeyboardKey.comma,
  ),
  CommandBinding(
    DesktopCommand.account,
    'Account',
    LogicalKeyboardKey.comma,
    shift: true,
  ),
  CommandBinding(DesktopCommand.refresh, 'Refresh', LogicalKeyboardKey.keyR),
  CommandBinding(
    DesktopCommand.search,
    'Find in this view',
    LogicalKeyboardKey.keyF,
  ),
  CommandBinding(DesktopCommand.save, 'Save', LogicalKeyboardKey.keyS),
  CommandBinding(
    DesktopCommand.export,
    'Export workspace',
    LogicalKeyboardKey.keyS,
    shift: true,
  ),
  CommandBinding(
    DesktopCommand.sidebar,
    'Show / hide sidebar',
    LogicalKeyboardKey.keyB,
  ),
  CommandBinding(
    DesktopCommand.shortcuts,
    'Keyboard shortcuts',
    LogicalKeyboardKey.f1,
    control: false,
  ),
];

CommandBinding bindingFor(DesktopCommand command) =>
    desktopBindings.firstWhere((binding) => binding.command == command);

typedef CommandHandlers = Map<DesktopCommand, VoidCallback?>;

class DesktopCommands extends StatelessWidget {
  const DesktopCommands({
    super.key,
    required this.handlers,
    required this.child,
  });
  final CommandHandlers handlers;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!isDesktop) return child;
    return CallbackShortcuts(
      bindings: {
        for (final binding in desktopBindings)
          binding.activator: ?handlers[binding.command],
        const SingleActivator(LogicalKeyboardKey.f5, includeRepeats: false):
            ?handlers[DesktopCommand.refresh],
      },
      child: Focus(autofocus: true, child: FocusTraversalGroup(child: child)),
    );
  }
}

class ShortcutBadge extends StatelessWidget {
  const ShortcutBadge(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
    decoration: BoxDecoration(
      color: Vc.elevated,
      border: Border.all(color: Vc.cardBorder),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(label, style: const TextStyle(color: Vc.muted, fontSize: 11)),
  );
}

Future<void> showKeyboardShortcuts(BuildContext context) => showDialog<void>(
  context: context,
  builder: (context) => AlertDialog(
    title: const Text('Keyboard shortcuts'),
    content: SizedBox(
      width: 480,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final binding in desktopBindings)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(child: Text(binding.label)),
                    ShortcutBadge(binding.shortcut),
                  ],
                ),
              ),
            const Divider(height: 24),
            for (final item in const [
              ('Send message', 'Enter'),
              ('New line', 'Shift+Enter'),
              ('Back / close view', 'Alt+Left / Esc'),
              ('Fullscreen', 'F11'),
              ('Move between controls', 'Tab / Shift+Tab'),
              ('Text editing', 'Ctrl+A / C / X / V / Z'),
            ])
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(child: Text(item.$1)),
                    ShortcutBadge(item.$2),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            const Text(
              'Commands apply to the active view. Text fields keep their standard editing shortcuts.',
              style: TextStyle(color: Vc.muted, fontSize: 12),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Close'),
      ),
    ],
  ),
);

Future<T?> showAdaptivePanel<T>({
  required BuildContext context,
  required WidgetBuilder builder,
}) {
  if (!isDesktop) {
    return showModalBottomSheet<T>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: builder,
    );
  }
  return showDialog<T>(
    context: context,
    builder: (context) => Dialog(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: 620,
          maxHeight: MediaQuery.sizeOf(context).height * .8,
        ),
        child: builder(context),
      ),
    ),
  );
}
