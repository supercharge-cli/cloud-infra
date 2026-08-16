import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/session.dart';
import '../theme.dart';
import '../widgets/ui.dart';

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
  bool showPass = false;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  String? _validate() {
    final e = email.text.trim();
    if (e.isEmpty || !e.contains('@')) return 'Enter a valid email.';
    if (password.text.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  Future<void> _submit() async {
    final problem = _validate();
    final session = context.read<SessionController>();
    if (problem != null) {
      session.setError(problem);
      return;
    }
    setState(() => busy = true);
    await session.signIn(email.text.trim(), password.text, register: signup);
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final err = context.watch<SessionController>().error;
    return Scaffold(
      body: Stack(
        children: [
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(24, 56, 24, 24),
              children: [
                const Text(
                  'Vectra',
                  style: TextStyle(
                    color: Vc.green,
                    fontWeight: FontWeight.w700,
                    fontSize: 18,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  signup ? 'Create account' : 'Sign in',
                  style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Chat with your cloud sandbox and manage instances from the phone.',
                  style: TextStyle(color: Vc.muted, height: 1.4),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  decoration: const InputDecoration(labelText: 'Email'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: password,
                  obscureText: !showPass,
                  autofillHints: signup ? const [AutofillHints.newPassword] : const [AutofillHints.password],
                  decoration: InputDecoration(
                    labelText: 'Password',
                    suffixIcon: IconButton(
                      onPressed: () => setState(() => showPass = !showPass),
                      icon: Icon(showPass ? Icons.visibility_off : Icons.visibility, color: Vc.muted),
                    ),
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                if (err != null) ...[
                  const SizedBox(height: 12),
                  Text(err, style: const TextStyle(color: Vc.red)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: busy ? null : _submit,
                  child: Text(signup ? 'Create account' : 'Sign in'),
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () {
                          context.read<SessionController>().setError(null);
                          setState(() => signup = !signup);
                        },
                  child: Text(
                    signup ? 'Have an account? Sign in' : 'New here? Create an account',
                    style: const TextStyle(color: Vc.muted),
                  ),
                ),
              ],
            ),
          ),
          if (busy) BusyOverlay(message: signup ? 'Creating account…' : 'Signing in…'),
        ],
      ),
    );
  }
}
