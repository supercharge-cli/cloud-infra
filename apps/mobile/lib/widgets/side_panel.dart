import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../desktop.dart';
import '../desktop/shell.dart';
import '../desktop/shortcuts.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../main.dart';
import '../state/session.dart';
import '../state/workspaces.dart';
import '../theme.dart';
import 'ui.dart';

class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    required this.body,
    this.appBar,
    this.floatingActionButton,
    this.isRoot = false,
    this.currentInstanceId,
    this.extendBodyBehindAppBar = false,
    this.commands = const {},
    this.fullWidth = false,
  });

  final Widget body;
  final PreferredSizeWidget? appBar;
  final Widget? floatingActionButton;
  final bool isRoot;
  final String? currentInstanceId;
  final bool extendBodyBehindAppBar;
  final CommandHandlers commands;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    if (isDesktop) {
      final layout = DesktopLayout.of(context);
      final handlers = <DesktopCommand, VoidCallback?>{
        DesktopCommand.workspaces: () => context.go('/'),
        DesktopCommand.account: () => context.go('/account'),
        DesktopCommand.settings: () => context.go(
          currentInstanceId == null
              ? '/account'
              : '/instance/$currentInstanceId',
        ),
        DesktopCommand.files: currentInstanceId == null
            ? null
            : () => context.go('/instance/$currentInstanceId/files'),
        DesktopCommand.shortcuts: () => showKeyboardShortcuts(context),
        DesktopCommand.sidebar: layout?.toggleSidebar,
        ...commands,
      };
      final bar = appBar;
      return DesktopCommands(
        handlers: handlers,
        child: CallbackShortcuts(
          bindings: {
            const SingleActivator(
              LogicalKeyboardKey.arrowLeft,
              alt: true,
              includeRepeats: false,
            ): () {
              if (context.canPop()) {
                context.pop();
              } else if (!isRoot) {
                context.go('/');
              }
            },
          },
          child: Scaffold(
            drawer: layout?.sidebarVisible == true
                ? null
                : VectraSidePanel(currentInstanceId: currentInstanceId),
            appBar: PreferredSize(
              preferredSize: const Size.fromHeight(94),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DesktopMenuBar(handlers: handlers),
                  if (bar is AppBar)
                    AppBar(
                      toolbarHeight: 54,
                      title: bar.title,
                      titleSpacing: 16,
                      automaticallyImplyLeading: layout?.sidebarVisible != true,
                      actions: [
                        ...?bar.actions,
                        IconButton(
                          tooltip: 'Keyboard shortcuts (F1)',
                          onPressed: () => showKeyboardShortcuts(context),
                          icon: const Icon(Icons.keyboard_outlined, size: 19),
                        ),
                        const SizedBox(width: 8),
                      ],
                    ),
                ],
              ),
            ),
            body: fullWidth
                ? body
                : Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1080),
                      child: body,
                    ),
                  ),
            floatingActionButton: floatingActionButton,
          ),
        ),
      );
    }
    return AppPopScope(
      isRoot: isRoot,
      child: Scaffold(
        drawer: VectraSidePanel(currentInstanceId: currentInstanceId),
        appBar: appBar,
        body: body,
        floatingActionButton: floatingActionButton,
        extendBodyBehindAppBar: extendBodyBehindAppBar,
      ),
    );
  }
}

class VectraSidePanel extends StatefulWidget {
  const VectraSidePanel({
    super.key,
    this.currentInstanceId,
    this.embedded = false,
  });
  final String? currentInstanceId;
  final bool embedded;

  @override
  State<VectraSidePanel> createState() => _VectraSidePanelState();
}

class _VectraSidePanelState extends State<VectraSidePanel> {
  WorkspaceCatalog? _catalog;
  List<CloudInstance> get items => _catalog?.items ?? const [];
  bool get loading => _catalog?.loading ?? false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = context.read<SessionController>().workspaces;
    if (_catalog == next) return;
    _catalog?.removeListener(_catalogChanged);
    _catalog = next;
    next.addListener(_catalogChanged);
    if (!next.initialized && !next.loading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _catalog == next && !next.initialized && !next.loading) {
          unawaited(next.refresh());
        }
      });
    }
  }

  void _catalogChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _catalog?.removeListener(_catalogChanged);
    super.dispose();
  }

  void _go(String path, {Object? extra}) {
    unawaited(_catalog?.refresh(force: false));
    final router = GoRouter.of(context);
    final loc = GoRouterState.of(context).uri.path;
    if (!widget.embedded) Navigator.of(context).pop();
    if (loc == path) return;
    if (widget.embedded) {
      router.go(path, extra: extra);
      return;
    }
    if (path == '/') {
      router.go('/');
      return;
    }
    router.push(path, extra: extra);
  }

  Future<void> _signOut() async {
    final session = context.read<SessionController>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will need to sign in again on this device.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    if (!widget.embedded) Navigator.of(context).pop();
    if (ok == true) await session.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final email = session.user?.email ?? '';
    final initial = email.isNotEmpty ? email[0].toUpperCase() : '?';
    if (widget.embedded) return _desktopPanel(email);
    return Drawer(
      backgroundColor: Vc.surface,
      width: 304,
      shape: const RoundedRectangleBorder(),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 12),
              child: Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: Vc.green.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: Vc.green.withValues(alpha: 0.35),
                      ),
                    ),
                    child: Center(
                      child: Text(
                        initial,
                        style: const TextStyle(
                          color: Vc.green,
                          fontWeight: FontWeight.w800,
                          fontSize: 18,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'VECTRA',
                          style: TextStyle(
                            color: Vc.green,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.6,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          email.isEmpty ? 'Signed in' : email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          session.user?.role ?? 'user',
                          style: const TextStyle(color: Vc.faint, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
              child: Text(
                'MENU',
                style: TextStyle(
                  color: Vc.faint,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.2,
                ),
              ),
            ),
            _item(
              icon: Icons.grid_view_rounded,
              label: 'Workspaces',
              selected: GoRouterState.of(context).uri.path == '/',
              onTap: () => _go('/'),
            ),
            _item(
              icon: Icons.payments_outlined,
              label: 'Billing',
              selected: GoRouterState.of(context).uri.path == '/billing',
              onTap: () => _go('/billing'),
            ),
            _item(
              icon: Icons.eco_outlined,
              label: 'Pollinations',
              selected: GoRouterState.of(
                context,
              ).uri.path.startsWith('/pollinations'),
              onTap: () => _go('/pollinations'),
            ),
            _item(
              icon: Icons.language,
              label: 'Open website in browser',
              onTap: () {
                final nav = Navigator.of(context);
                nav.pop();
                launchUrl(
                  Uri.parse('$apiBase/dashboard'),
                  mode: LaunchMode.externalApplication,
                );
              },
            ),
            _item(
              icon: Icons.person_outline,
              label: 'Account',
              selected: GoRouterState.of(context).uri.path == '/account',
              onTap: () => _go('/account'),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 6),
              child: Row(
                children: [
                  const Text(
                    'WORKSPACES',
                    style: TextStyle(
                      color: Vc.faint,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const Spacer(),
                  if (loading)
                    const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Vc.green,
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: items.isEmpty && !loading
                  ? const Padding(
                      padding: EdgeInsets.fromLTRB(18, 8, 18, 0),
                      child: Text(
                        'No workspaces yet.',
                        style: TextStyle(color: Vc.muted, fontSize: 13),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.only(bottom: 12),
                      itemCount: items.length,
                      itemBuilder: (ctx, i) {
                        final inst = items[i];
                        final on = inst.id == widget.currentInstanceId;
                        return _item(
                          icon: Icons.cloud_outlined,
                          label: inst.name,
                          detail: inst.displayState,
                          selected: on,
                          trailing: StatusDot(inst.displayState, size: 8),
                          onTap: () => _go('/chat/${inst.id}', extra: inst),
                        );
                      },
                    ),
            ),
            const Divider(height: 1),
            _item(
              icon: Icons.logout,
              label: 'Sign out',
              color: Vc.red,
              onTap: _signOut,
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _desktopPanel(String email) {
    final path = GoRouterState.of(context).uri.path;
    return Material(
      color: Vc.surface,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(18, 22, 18, 20),
              child: Row(
                children: [
                  Icon(Icons.cloud_outlined, color: Vc.greenSoft, size: 23),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Vectra Cloud',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            _item(
              icon: Icons.space_dashboard_outlined,
              label: 'Workspaces',
              selected: path == '/',
              onTap: () => _go('/'),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 22, 8, 6),
              child: Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Your workspaces',
                      style: TextStyle(
                        color: Vc.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Refresh workspaces',
                    onPressed: loading
                        ? null
                        : () {
                            unawaited(_catalog?.refresh());
                          },
                    icon: const Icon(Icons.refresh, size: 16),
                  ),
                ],
              ),
            ),
            Expanded(
              child: loading && items.isEmpty
                  ? const Center(
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : items.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(18),
                      child: Text(
                        'No workspaces yet',
                        style: TextStyle(color: Vc.muted),
                      ),
                    )
                  : ListView.builder(
                      itemCount: items.length,
                      itemBuilder: (context, index) {
                        final item = items[index];
                        return _item(
                          icon: Icons.chat_bubble_outline,
                          label: item.name,
                          detail: item.runtimeLabel,
                          trailing: StatusDot(item.displayState, size: 7),
                          selected: item.id == widget.currentInstanceId,
                          onTap: () => _go('/chat/${item.id}', extra: item),
                        );
                      },
                    ),
            ),
            const Divider(height: 1),
            const SizedBox(height: 8),
            _item(
              icon: Icons.eco_outlined,
              label: 'Pollinations',
              selected: path.startsWith('/pollinations'),
              onTap: () => _go('/pollinations'),
            ),
            _item(
              icon: Icons.payments_outlined,
              label: 'Billing',
              selected: path == '/billing',
              onTap: () => _go('/billing'),
            ),
            _item(
              icon: Icons.person_outline,
              label: 'Account',
              selected: path == '/account',
              onTap: () => _go('/account'),
            ),
            _item(
              icon: Icons.keyboard_outlined,
              label: 'Keyboard shortcuts',
              onTap: () => showKeyboardShortcuts(context),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 10, 6, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      email.isEmpty ? 'Connected' : email,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Vc.muted, fontSize: 11),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Sign out',
                    onPressed: _signOut,
                    icon: const Icon(Icons.logout, size: 17, color: Vc.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _item({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    String? detail,
    Widget? trailing,
    bool selected = false,
    Color? color,
  }) {
    final c = color ?? (selected ? Vc.green : Colors.white);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      child: Material(
        color: selected ? Vc.green.withValues(alpha: 0.12) : Colors.transparent,
        borderRadius: BorderRadius.circular(widget.embedded ? 6 : 12),
        child: InkWell(
          borderRadius: BorderRadius.circular(widget.embedded ? 6 : 12),
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: 10,
              vertical: widget.embedded ? 9 : 11,
            ),
            child: Row(
              children: [
                Icon(icon, size: 20, color: c),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: c,
                          fontWeight: selected
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                      if (detail != null)
                        Text(
                          detail,
                          style: const TextStyle(color: Vc.faint, fontSize: 11),
                        ),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
