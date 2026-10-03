import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';

String githubRequestId() {
  final random = Random.secure();
  return List.generate(
    16,
    (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ).join();
}

class GitHubAuthPanel extends StatefulWidget {
  const GitHubAuthPanel({
    super.key,
    required this.api,
    required this.instanceId,
    required this.chatId,
  });

  final VectraClient api;
  final String instanceId;
  final String chatId;

  @override
  State<GitHubAuthPanel> createState() => _GitHubAuthPanelState();
}

class _GitHubAuthPanelState extends State<GitHubAuthPanel> {
  static final _deviceUrl = Uri.parse('https://github.com/login/device');
  Map<String, dynamic> _auth = {'status': 'idle'};
  Timer? _timer;
  bool _busy = false;
  String? _error;
  String? _token;
  String? _tokenSource;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  @override
  void didUpdateWidget(covariant GitHubAuthPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.chatId != widget.chatId ||
        oldWidget.instanceId != widget.instanceId) {
      _token = null;
      _tokenSource = null;
      _auth = {'status': 'idle'};
      _error = null;
      _refresh();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_busy) return;
    final instance = widget.instanceId;
    try {
      final auth = await widget.api.githubAuthStatus(instance);
      if (mounted && instance == widget.instanceId && !_busy) {
        setState(() => _auth = auth);
      }
    } catch (_) {
      // Keep the last known state until the next status request.
    }
  }

  Future<void> _act(String action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = switch (action) {
        'start' => await widget.api.githubAuthStart(
          widget.instanceId,
          widget.chatId,
          githubRequestId(),
        ),
        'done' => await widget.api.githubAuthDone(widget.instanceId),
        _ => await widget.api.githubAuthCancel(widget.instanceId),
      };
      if (mounted) setState(() => _auth = auth);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reveal(String source) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          'Send GitHub ${source == 'cli' ? 'CLI' : 'MCP'} token to this chat?',
        ),
        content: Text(
          'This token grants account access. Sending it saves an encrypted copy in this direct GitHub chat history, visible to anyone with access to your account and potentially in exports. Revoke it on GitHub if exposed. It is never posted to group chat.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Send token to this chat'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
      _token = null;
      _tokenSource = null;
    });
    try {
      final token = await widget.api.githubToken(
        widget.instanceId,
        widget.chatId,
        source,
        githubRequestId(),
      );
      if (mounted) {
        setState(() {
          _token = token;
          _tokenSource = source;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = '${_auth['status'] ?? 'idle'}';
    final expires = _auth['expiresAt'];
    final expiry = expires is num
        ? DateTime.fromMillisecondsSinceEpoch(expires.toInt()).toLocal()
        : null;
    final username = '${_auth['username'] ?? ''}';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'GitHub CLI · this VM',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          const Text(
            'GitHub CLI login is separate from GitHub MCP, which needs its own credential.',
          ),
          if ([
            'idle',
            'cancelled',
            'expired',
            'failed',
            'delivered',
          ].contains(status))
            TextButton(
              onPressed: _busy ? null : () => _act('start'),
              child: Text(
                status == 'delivered'
                    ? 'Start a new login'
                    : 'Connect GitHub CLI',
              ),
            ),
          if (status == 'starting')
            const Text('Waiting for a device code from the VM…'),
          if (status == 'pending') ...[
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('Open '),
                TextButton(
                  onPressed: () => launchUrl(
                    _deviceUrl,
                    mode: LaunchMode.externalApplication,
                  ),
                  child: const Text('https://github.com/login/device'),
                ),
                const Text(' in your browser and enter this code:'),
              ],
            ),
            SelectableText(
              '${_auth['code'] ?? ''}',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            Text(
              'Only click Done after authorizing on GitHub. Expires ${expiry == null ? 'soon' : TimeOfDay.fromDateTime(expiry).format(context)}.',
            ),
          ],
          if (status == 'starting' || status == 'pending')
            Wrap(
              children: [
                TextButton(
                  onPressed: _busy ? null : () => _act('done'),
                  child: const Text('Done — verify in VM'),
                ),
                TextButton(
                  onPressed: _busy ? null : () => _act('cancel'),
                  child: const Text('Cancel'),
                ),
              ],
            ),
          if (status == 'verified')
            TextButton(
              onPressed: _busy ? null : () => _act('done'),
              child: const Text('Continue verified login'),
            ),
          if (status == 'delivered')
            Text(
              'GitHub CLI verified as $username. The GitHub bot was asked to continue this conversation. GitHub MCP is not connected by this login.',
            ),
          if (status == 'uncertain' || status == 'delivering')
            Text(
              'GitHub CLI verified as $username, but delivery could not be confirmed. Check the conversation before retrying; the handoff will not be sent again automatically.',
            ),
          const Divider(),
          Wrap(
            children: [
              TextButton(
                onPressed: _busy ? null : () => _reveal('cli'),
                child: const Text('Show my GitHub CLI token in chat'),
              ),
              TextButton(
                onPressed: _busy ? null : () => _reveal('mcp'),
                child: const Text('Show my GitHub MCP token in chat'),
              ),
            ],
          ),
          if (_token != null) ...[
            Text(
              'Sensitive credential · saved in this private GitHub chat · ${_tokenSource == 'cli' ? 'CLI' : 'MCP'}',
            ),
            SelectableText(_token!),
            TextButton(
              onPressed: () => setState(() {
                _token = null;
                _tokenSource = null;
              }),
              child: const Text('Hide token on this device'),
            ),
          ],
          if (_error != null)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      ),
    );
  }
}
