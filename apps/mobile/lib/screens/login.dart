import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/session.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  bool signup = false;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => busy = true);
    final session = context.read<SessionController>();
    await session.signIn(email.text.trim(), password.text, register: signup);
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final err = context.watch<SessionController>().error;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 48),
            Text('Vectra Cloud', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 8),
            const Text('Chat with your cloud sandbox — no Telegram required.'),
            const SizedBox(height: 32),
            TextField(
              controller: email,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              decoration: const InputDecoration(labelText: 'Email'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: password,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Password'),
            ),
            if (err != null) ...[
              const SizedBox(height: 12),
              Text(err, style: const TextStyle(color: Colors.redAccent)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: busy ? null : _submit,
              child: Text(busy ? 'Please wait…' : (signup ? 'Create account' : 'Sign in')),
            ),
            TextButton(
              onPressed: busy ? null : () => setState(() => signup = !signup),
              child: Text(signup ? 'Have an account? Sign in' : 'New here? Create an account'),
            ),
          ],
        ),
      ),
    );
  }
}
