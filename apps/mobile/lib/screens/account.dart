import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/session.dart';
import '../theme.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Vc.card,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Vc.cardBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Signed in', style: TextStyle(color: Vc.muted, fontSize: 12)),
                const SizedBox(height: 6),
                Text(session.user?.email ?? '', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(session.user?.role ?? 'user', style: const TextStyle(color: Vc.faint)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: () => session.signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}
