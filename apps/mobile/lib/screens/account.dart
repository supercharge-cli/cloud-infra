import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/session.dart';

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        children: [
          ListTile(
            title: const Text('Email'),
            subtitle: Text(session.user?.email ?? ''),
          ),
          ListTile(
            title: const Text('Role'),
            subtitle: Text(session.user?.role ?? 'user'),
          ),
          const Divider(),
          ListTile(
            title: const Text('Sign out'),
            onTap: () => session.signOut(),
          ),
        ],
      ),
    );
  }
}
