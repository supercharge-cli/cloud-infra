import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../main.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/ui.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final email = session.user?.email ?? '';
    final initial = email.isNotEmpty ? email[0].toUpperCase() : '?';
    return AppPopScope(
      child: Scaffold(
        appBar: AppBar(title: const Text('Account')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            VcPanel(
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: Vc.green.withValues(alpha: 0.18),
                    child: Text(initial, style: const TextStyle(color: Vc.green, fontWeight: FontWeight.w800, fontSize: 20)),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Signed in', style: TextStyle(color: Vc.muted, fontSize: 12)),
                        const SizedBox(height: 4),
                        Text(email, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text(session.user?.role ?? 'user', style: const TextStyle(color: Vc.faint)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            VcPanel(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                children: [
                  ListTile(
                    title: const Text('API'),
                    subtitle: Text(apiBase, style: const TextStyle(color: Vc.muted, fontSize: 12)),
                    trailing: IconButton(
                      icon: const Icon(Icons.copy, size: 18),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: apiBase));
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied API base')));
                      },
                    ),
                  ),
                  const Divider(height: 1),
                  ListTile(
                    title: const Text('Open dashboard'),
                    subtitle: const Text('Website control plane', style: TextStyle(color: Vc.muted, fontSize: 12)),
                    trailing: const Icon(Icons.open_in_new, size: 18, color: Vc.muted),
                    onTap: () => launchUrl(Uri.parse('$apiBase/dashboard'), mode: LaunchMode.externalApplication),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            OutlinedButton(
              onPressed: () async {
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
                if (ok == true) await session.signOut();
              },
              child: const Text('Sign out'),
            ),
          ],
        ),
      ),
    );
  }
}
