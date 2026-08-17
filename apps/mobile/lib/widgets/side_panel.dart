import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../main.dart';
import '../state/session.dart';
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
  });

  final Widget body;
  final PreferredSizeWidget? appBar;
  final Widget? floatingActionButton;
  final bool isRoot;
  final String? currentInstanceId;
  final bool extendBodyBehindAppBar;

  @override
  Widget build(BuildContext context) {
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
  const VectraSidePanel({super.key, this.currentInstanceId});
  final String? currentInstanceId;

  @override
  State<VectraSidePanel> createState() => _VectraSidePanelState();
}

class _VectraSidePanelState extends State<VectraSidePanel> {
  List<CloudInstance> items = [];
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await context.read<SessionController>().client.dashboard();
      if (!mounted) return;
      setState(() {
        items = data.instances;
        loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  void _go(String path, {Object? extra}) {
    final router = GoRouter.of(context);
    final loc = GoRouterState.of(context).uri.path;
    Navigator.of(context).pop();
    if (loc == path) return;
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
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (!mounted) return;
    Navigator.of(context).pop();
    if (ok == true) await session.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final email = session.user?.email ?? '';
    final initial = email.isNotEmpty ? email[0].toUpperCase() : '?';
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
                      border: Border.all(color: Vc.green.withValues(alpha: 0.35)),
                    ),
                    child: Center(
                      child: Text(initial, style: const TextStyle(color: Vc.green, fontWeight: FontWeight.w800, fontSize: 18)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('VECTRA', style: TextStyle(color: Vc.green, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.6)),
                        const SizedBox(height: 2),
                        Text(
                          email.isEmpty ? 'Signed in' : email,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(session.user?.role ?? 'user', style: const TextStyle(color: Vc.faint, fontSize: 12)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 6),
              child: Text('MENU', style: TextStyle(color: Vc.faint, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
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
              selected: GoRouterState.of(context).uri.path.startsWith('/pollinations'),
              onTap: () => _go('/pollinations'),
            ),
            _item(
              icon: Icons.language,
              label: 'Website',
              onTap: () {
                final nav = Navigator.of(context);
                nav.pop();
                launchUrl(Uri.parse('$apiBase/dashboard'), mode: LaunchMode.externalApplication);
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
                  const Text('WORKSPACES', style: TextStyle(color: Vc.faint, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
                  const Spacer(),
                  if (loading)
                    const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, color: Vc.green)),
                ],
              ),
            ),
            Expanded(
              child: items.isEmpty && !loading
                  ? const Padding(
                      padding: EdgeInsets.fromLTRB(18, 8, 18, 0),
                      child: Text('No workspaces yet.', style: TextStyle(color: Vc.muted, fontSize: 13)),
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
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
            child: Row(
              children: [
                Icon(icon, size: 20, color: c),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: c, fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
                      if (detail != null)
                        Text(detail, style: const TextStyle(color: Vc.faint, fontSize: 11)),
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
