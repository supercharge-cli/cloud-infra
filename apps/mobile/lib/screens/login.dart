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
  final host = TextEditingController();
  bool busy = false;
  bool signup = false;
  bool showPass = false;
  bool daemon = false;

  @override
  void dispose() {
    email.dispose();
    password.dispose();
    host.dispose();
    super.dispose();
  }

  String? _validate() {
    if (daemon) {
      if (host.text.trim().isEmpty) return 'Enter the Supercharge server host.';
      if (password.text.isEmpty) return 'Enter the server password.';
      return null;
    }
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
    if (daemon) {
      await session.connectDaemon(host.text.trim(), password.text);
    } else {
      await session.signIn(email.text.trim(), password.text, register: signup);
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final err = context.watch<SessionController>().error;
    return AppPopScope(
      isRoot: true,
      child: Scaffold(
        body: Stack(
          children: [
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0xFF0B1A12), Vc.bg, Vc.bg],
                ),
              ),
              child: SizedBox.expand(),
            ),
            SafeArea(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(22, 40, 22, 24),
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: Vc.green.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: Vc.green.withValues(alpha: 0.4)),
                      ),
                      child: const Icon(Icons.cloud_outlined, color: Vc.green),
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'VECTRA',
                    style: TextStyle(
                      color: Vc.green,
                      fontWeight: FontWeight.w800,
                      fontSize: 13,
                      letterSpacing: 2.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    signup ? 'Create account' : 'Welcome back',
                    style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -0.8),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    daemon
                        ? 'Talk to a Supercharge daemon on your VPS or LAN. Same password as SUPERCHARGE_PASSWORD.'
                        : 'Chat with your cloud sandbox and run the full dashboard from your phone.',
                    style: const TextStyle(color: Vc.muted, height: 1.45, fontSize: 15),
                  ),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilterChip(
                      label: const Text('Supercharge server'),
                      selected: daemon,
                      onSelected: busy
                          ? null
                          : (v) {
                              context.read<SessionController>().setError(null);
                              setState(() => daemon = v);
                            },
                    ),
                  ),
                  const SizedBox(height: 16),
                  VcPanel(
                    child: Column(
                      children: [
                        if (daemon)
                          TextField(
                            controller: host,
                            keyboardType: TextInputType.url,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Host',
                              hintText: 'http://192.168.1.10:6767',
                            ),
                          )
                        else
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
                          Align(
                            alignment: Alignment.centerLeft,
                            child: Text(err, style: const TextStyle(color: Vc.red)),
                          ),
                        ],
                        const SizedBox(height: 18),
                        FilledButton(
                          onPressed: busy ? null : _submit,
                          child: SizedBox(
                            width: double.infinity,
                            child: Text(
                              daemon ? 'Connect' : (signup ? 'Create account' : 'Sign in'),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (!daemon)
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
      ),
    );
  }
}
