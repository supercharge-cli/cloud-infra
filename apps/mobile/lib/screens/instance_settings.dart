import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/session.dart';

class InstanceSettingsScreen extends StatefulWidget {
  const InstanceSettingsScreen({super.key, required this.instanceId, this.instance});
  final String instanceId;
  final CloudInstance? instance;

  @override
  State<InstanceSettingsScreen> createState() => _InstanceSettingsScreenState();
}

class _InstanceSettingsScreenState extends State<InstanceSettingsScreen> {
  final provider = TextEditingController(text: 'openai');
  final model = TextEditingController();
  final baseUrl = TextEditingController();
  final apiKey = TextEditingController();
  bool busy = false;
  String? msg;

  @override
  void dispose() {
    provider.dispose();
    model.dispose();
    baseUrl.dispose();
    apiKey.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      busy = true;
      msg = null;
    });
    try {
      await context.read<SessionController>().client.saveConfig(widget.instanceId, {
        'provider': provider.text.trim(),
        'model': model.text.trim(),
        'baseUrl': baseUrl.text.trim(),
        if (apiKey.text.trim().isNotEmpty) 'apiKey': apiKey.text.trim(),
        'restart': true,
      });
      setState(() => msg = 'Saved. Daemon will restart.');
    } catch (e) {
      setState(() => msg = e.toString());
    }
    if (mounted) setState(() => busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<SessionController>().client;
    return Scaffold(
      appBar: AppBar(title: Text(widget.instance?.name ?? 'Instance')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(controller: provider, decoration: const InputDecoration(labelText: 'Provider')),
          TextField(controller: model, decoration: const InputDecoration(labelText: 'Model')),
          TextField(controller: baseUrl, decoration: const InputDecoration(labelText: 'Base URL (optional)')),
          TextField(
            controller: apiKey,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'API key'),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: busy ? null : _save, child: const Text('Save AI config')),
          if (msg != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(msg!)),
          const Divider(height: 32),
          ListTile(
            title: const Text('Wake'),
            onTap: () => api.wake(widget.instanceId),
          ),
          ListTile(
            title: const Text('Billing'),
            onTap: () => context.push('/billing', extra: widget.instanceId),
          ),
          ListTile(
            title: const Text('Destroy instance'),
            textColor: Colors.redAccent,
            onTap: () async {
              await api.destroy(widget.instanceId);
              if (context.mounted) context.go('/');
            },
          ),
        ],
      ),
    );
  }
}
