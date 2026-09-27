import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme.dart';
import '../widgets/side_panel.dart';
import 'native.dart';
import 'shortcuts.dart';

class DesktopLayout extends InheritedWidget {
  const DesktopLayout({
    super.key,
    required this.sidebarVisible,
    required this.toggleSidebar,
    required super.child,
  });
  final bool sidebarVisible;
  final VoidCallback toggleSidebar;

  static DesktopLayout? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<DesktopLayout>();

  @override
  bool updateShouldNotify(DesktopLayout oldWidget) =>
      sidebarVisible != oldWidget.sidebarVisible;
}

class DesktopShell extends StatefulWidget {
  const DesktopShell({super.key, required this.child});
  final Widget child;

  @override
  State<DesktopShell> createState() => _DesktopShellState();
}

class _DesktopShellState extends State<DesktopShell> {
  bool sidebar = true;

  @override
  Widget build(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;
    final parts = path.split('/');
    final instanceId =
        parts.length > 2 && {'chat', 'instance'}.contains(parts[1])
        ? parts[2]
        : null;
    final handlers = <DesktopCommand, VoidCallback?>{
      DesktopCommand.workspaces: () => context.go('/'),
      DesktopCommand.account: () => context.go('/account'),
      DesktopCommand.shortcuts: () => showKeyboardShortcuts(context),
      DesktopCommand.sidebar: () => setState(() => sidebar = !sidebar),
      DesktopCommand.settings: () =>
          context.go(instanceId == null ? '/account' : '/instance/$instanceId'),
      DesktopCommand.files: instanceId == null
          ? null
          : () => context.go('/instance/$instanceId/files'),
    };
    return DesktopCommands(
      handlers: handlers,
      child: CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.f11, includeRepeats: false):
              DesktopNative.toggleFullscreen,
        },
        child: Scaffold(
          body: LayoutBuilder(
            builder: (context, constraints) {
              final showSidebar = sidebar && constraints.maxWidth >= 850;
              return DesktopLayout(
                sidebarVisible: showSidebar,
                toggleSidebar: () => setState(() => sidebar = !sidebar),
                child: Row(
                  children: [
                    if (showSidebar) ...[
                      SizedBox(
                        width: 232,
                        child: VectraSidePanel(
                          key: const ValueKey('desktop-sidebar'),
                          currentInstanceId: instanceId,
                          embedded: true,
                        ),
                      ),
                      const VerticalDivider(width: 1),
                    ],
                    Expanded(
                      child: Focus(autofocus: true, child: widget.child),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class DesktopMenuBar extends StatelessWidget {
  const DesktopMenuBar({super.key, required this.handlers});
  final CommandHandlers handlers;

  Widget _command(DesktopCommand command) {
    final binding = bindingFor(command);
    return MenuItemButton(
      onPressed: handlers[command],
      shortcut: binding.activator,
      child: Text(binding.label),
    );
  }

  @override
  Widget build(BuildContext context) => MenuBar(
    style: const MenuStyle(
      elevation: WidgetStatePropertyAll(0),
      backgroundColor: WidgetStatePropertyAll(Vc.surface),
      padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 8)),
      shape: WidgetStatePropertyAll(RoundedRectangleBorder()),
    ),
    children: [
      SubmenuButton(
        menuChildren: [
          _command(DesktopCommand.workspaces),
          _command(DesktopCommand.newWorkspace),
          _command(DesktopCommand.newChat),
          const Divider(),
          _command(DesktopCommand.attach),
          _command(DesktopCommand.save),
          _command(DesktopCommand.export),
        ],
        child: const Text('File'),
      ),
      SubmenuButton(
        menuChildren: [
          _command(DesktopCommand.search),
          _command(DesktopCommand.commands),
          _command(DesktopCommand.focusComposer),
        ],
        child: const Text('Edit'),
      ),
      SubmenuButton(
        menuChildren: [
          _command(DesktopCommand.history),
          _command(DesktopCommand.files),
          _command(DesktopCommand.computer),
          _command(DesktopCommand.preview),
          const Divider(),
          _command(DesktopCommand.refresh),
          MenuItemButton(
            onPressed: DesktopNative.toggleFullscreen,
            shortcut: const SingleActivator(LogicalKeyboardKey.f11),
            child: const Text('Fullscreen'),
          ),
        ],
        child: const Text('View'),
      ),
      SubmenuButton(
        menuChildren: [
          _command(DesktopCommand.settings),
          _command(DesktopCommand.account),
          _command(DesktopCommand.stop),
        ],
        child: const Text('Workspace'),
      ),
      SubmenuButton(
        menuChildren: [_command(DesktopCommand.shortcuts)],
        child: const Text('Help'),
      ),
    ],
  );
}
