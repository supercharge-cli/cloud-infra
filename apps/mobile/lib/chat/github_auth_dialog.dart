import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../theme.dart';
import 'github_auth.dart';

class GitHubAuthConnection extends StatefulWidget {
  const GitHubAuthConnection({
    super.key,
    required this.api,
    required this.instanceId,
  });

  final VectraClient api;
  final String instanceId;

  @override
  State<GitHubAuthConnection> createState() => _GitHubAuthConnectionState();
}

class _GitHubAuthConnectionState extends State<GitHubAuthConnection>
    with WidgetsBindingObserver {
  Timer? _timer;
  Map<String, dynamic>? _auth;
  bool _busy = false;
  bool _failed = false;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _refresh());
  }

  @override
  void didUpdateWidget(GitHubAuthConnection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.instanceId != widget.instanceId ||
        oldWidget.api != widget.api) {
      _generation++;
      _auth = null;
      _failed = false;
      _busy = false;
      unawaited(_refresh());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_busy) return;
    _busy = true;
    final generation = ++_generation;
    final instanceId = widget.instanceId;
    final api = widget.api;
    try {
      final auth = await api.githubAuthStatus(instanceId);
      if (mounted && generation == _generation) {
        setState(() {
          _auth = auth;
          _failed = false;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _failed = true);
      }
    } finally {
      if (generation == _generation) _busy = false;
    }
  }

  @override
  void dispose() {
    _generation++;
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final connected = _auth?['status'] == 'delivered' && !_failed;
    final username = _auth?['username'] is String
        ? _auth!['username'] as String
        : '';
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      child: connected
          ? Semantics(
              label:
                  'GitHub CLI connected${username.isEmpty ? '' : ' as $username'}',
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: Vc.greenSoft),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'GitHub CLI connected',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          username.isEmpty
                              ? 'Ready on this VM'
                              : 'Connected as $username',
                          style: const TextStyle(fontSize: 12, color: Vc.muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            )
          : _failed || _auth == null
          ? TextButton.icon(
              onPressed: _busy ? null : _refresh,
              icon: const Icon(Icons.refresh),
              label: Text(
                _failed
                    ? 'Check GitHub CLI connection'
                    : 'Checking GitHub CLI…',
              ),
            )
          : OutlinedButton.icon(
              key: const ValueKey('workspace-github-login'),
              onPressed: () async {
                await showDialog<void>(
                  context: context,
                  builder: (_) => GitHubAuthDialog(
                    api: widget.api,
                    instanceId: widget.instanceId,
                  ),
                );
                if (mounted) await _refresh();
              },
              icon: const Icon(Icons.login, color: Vc.greenSoft),
              label: const Align(
                alignment: Alignment.centerLeft,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Connect GitHub CLI',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      'Sign in on this VM',
                      style: TextStyle(fontSize: 12, color: Vc.muted),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

class GitHubAuthDialog extends StatefulWidget {
  const GitHubAuthDialog({
    super.key,
    required this.api,
    required this.instanceId,
  });
  final VectraClient api;
  final String instanceId;

  @override
  State<GitHubAuthDialog> createState() => _GitHubAuthDialogState();
}

class _GitHubAuthDialogState extends State<GitHubAuthDialog> {
  static final _deviceUrl = Uri.parse('https://github.com/login/device');
  Map<String, dynamic> _auth = {'status': 'idle'};
  Timer? _timer;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_refresh(startIfIdle: true));
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh({bool startIfIdle = false}) async {
    if (_busy) return;
    try {
      final result = await widget.api.githubAuthStatus(widget.instanceId);
      if (!mounted) return;
      setState(() => _auth = result);
      if (startIfIdle &&
          [
            'idle',
            'cancelled',
            'expired',
            'failed',
          ].contains(result['status'])) {
        await _act('start');
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _act(String action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = switch (action) {
        'start' => await widget.api.githubAuthStartStandalone(
          widget.instanceId,
          githubRequestId(),
        ),
        'verify' => await widget.api.githubAuthDone(widget.instanceId),
        _ => await widget.api.githubAuthCancel(widget.instanceId),
      };
      if (mounted) setState(() => _auth = result);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = '${_auth['status'] ?? 'idle'}';
    final code = _auth['code'] is String ? _auth['code'] as String : '';
    final username = '${_auth['username'] ?? ''}';
    return AlertDialog(
      title: const Text('Connect GitHub CLI'),
      content: SizedBox(
        width: 360,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Sign in on this workspace’s VM. GitHub MCP needs a separate connection.',
              ),
              const SizedBox(height: 16),
              if (_busy || status == 'starting')
                const LinearProgressIndicator(),
              if (status == 'starting')
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text('Waiting for a device code from the VM…'),
                ),
              if (status == 'pending') ...[
                const Text('Enter this code on GitHub:'),
                const SizedBox(height: 8),
                SelectableText(
                  code,
                  style: const TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 2,
                  ),
                ),
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () => unawaited(
                    launchUrl(_deviceUrl, mode: LaunchMode.externalApplication),
                  ),
                  icon: const Icon(Icons.open_in_new),
                  label: const Text('github.com/login/device'),
                ),
                OutlinedButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(
                      ClipboardData(text: _deviceUrl.toString()),
                    );
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Verification link copied'),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy link'),
                ),
                const SizedBox(height: 8),
                const Text(
                  'After authorizing on GitHub, return here and verify the connection in the VM.',
                ),
              ],
              if (status == 'delivered')
                Text(
                  'Done! GitHub connected as $username. CLI is ready in this VM.',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              if (status == 'verified')
                const Text(
                  'GitHub authorization was verified. Complete the connection below.',
                ),
              if (status == 'uncertain' || status == 'delivering')
                const Text(
                  'The VM verified GitHub, but completion could not be confirmed. Check the VM status before retrying.',
                ),
              if (status == 'cancelled') const Text('Login cancelled.'),
              if (status == 'expired' || status == 'failed')
                const Text(
                  'The code expired or login failed. Start a new login.',
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(status == 'delivered' ? 'Done' : 'Close'),
        ),
        if (status == 'starting' || status == 'pending')
          TextButton(
            onPressed: _busy ? null : () => _act('cancel'),
            child: const Text('Cancel login'),
          ),
        if (status == 'idle' ||
            status == 'cancelled' ||
            status == 'expired' ||
            status == 'failed' ||
            status == 'delivered')
          TextButton(
            onPressed: _busy ? null : () => _act('start'),
            child: Text(
              status == 'delivered' ? 'Start a new login' : 'Try again',
            ),
          ),
        if (status == 'pending' || status == 'verified')
          FilledButton(
            onPressed: _busy ? null : () => _act('verify'),
            child: const Text('Verify connection'),
          ),
      ],
    );
  }
}
