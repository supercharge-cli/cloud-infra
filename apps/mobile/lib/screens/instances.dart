import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/ui.dart';

class InstancesScreen extends StatefulWidget {
  const InstancesScreen({super.key});
  @override
  State<InstancesScreen> createState() => _InstancesScreenState();
}

class _InstancesScreenState extends State<InstancesScreen> {
  List<CloudInstance> items = [];
  FreeQuota quota = FreeQuota();
  PlanInfo? plan;
  bool loading = true;
  String? error;
  String? overlay;

  VectraClient get api => context.read<SessionController>().client;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      loading = items.isEmpty;
      error = null;
    });
    try {
      final data = await api.dashboard();
      items = data.instances;
      quota = data.quota;
      plan = data.plan;
    } catch (e) {
      error = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _create() async {
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController(text: 'workspace');
        return AlertDialog(
          backgroundColor: Vc.card,
          title: const Text('New instance'),
          content: TextField(controller: c, decoration: const InputDecoration(labelText: 'Name')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('Create')),
          ],
        );
      },
    );
    if (name == null || name.isEmpty) return;
    setState(() => overlay = 'Provisioning sandbox…');
    try {
      await api.createInstance(name);
      await _reload();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
    if (mounted) setState(() => overlay = null);
  }

  Future<void> _wake(CloudInstance inst) async {
    setState(() => overlay = 'Waking ${inst.name}…');
    try {
      await api.wake(inst.id);
      await _reload();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
    if (mounted) setState(() => overlay = null);
  }

  @override
  Widget build(BuildContext context) {
    final email = context.watch<SessionController>().user?.email ?? '';
    return Scaffold(
      appBar: AppBar(
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Vectra Cloud', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text('Instances', style: TextStyle(fontSize: 12, color: Vc.muted)),
          ],
        ),
        actions: [
          IconButton(onPressed: () => context.push('/billing'), icon: const Icon(Icons.payments_outlined)),
          IconButton(onPressed: () => context.push('/account'), icon: const Icon(Icons.person_outline)),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: overlay == null ? _create : null,
        backgroundColor: Vc.green,
        foregroundColor: Colors.black,
        icon: const Icon(Icons.add),
        label: const Text('Create'),
      ),
      body: Stack(
        children: [
          RefreshIndicator(
            color: Vc.green,
            onRefresh: _reload,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
              children: [
                if (email.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(email, style: const TextStyle(color: Vc.faint, fontSize: 12)),
                  ),
                _quotaCard(),
                const SizedBox(height: 16),
                if (loading)
                  const Padding(
                    padding: EdgeInsets.only(top: 80),
                    child: Center(child: CircularProgressIndicator(color: Vc.green)),
                  )
                else if (error != null)
                  Text(error!, style: const TextStyle(color: Vc.red))
                else if (items.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 40),
                    child: Text(
                      'No instances yet. Create a free sandbox, then open Chat.',
                      style: TextStyle(color: Vc.muted),
                    ),
                  )
                else
                  for (final inst in items) _card(inst),
              ],
            ),
          ),
          if (overlay != null) BusyOverlay(message: overlay!, detail: 'This can take up to a minute'),
        ],
      ),
    );
  }

  Widget _quotaCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Vc.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Vc.cardBorder),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Free quota', style: TextStyle(color: Vc.muted, fontSize: 12)),
                const SizedBox(height: 4),
                Text(
                  '${quota.used} / ${quota.limit} used',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          if (plan?.priceInr != null)
            Text(
              '₹${plan!.priceInr} / \$${plan!.priceUsd}',
              style: const TextStyle(color: Vc.muted, fontSize: 12),
            ),
        ],
      ),
    );
  }

  Widget _card(CloudInstance inst) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Vc.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Vc.cardBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => context.push('/chat/${inst.id}', extra: inst),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(inst.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    ),
                    StateChip(inst.displayState),
                    if (inst.isFree)
                      const Padding(
                        padding: EdgeInsets.only(left: 6),
                        child: StateChip('free'),
                      ),
                  ],
                ),
                if (inst.lastError != null && inst.lastError!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(inst.lastError!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Vc.red, fontSize: 12)),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    _mini('Chat', Icons.chat_bubble_outline, () => context.push('/chat/${inst.id}', extra: inst)),
                    const SizedBox(width: 8),
                    _mini(inst.isPaused ? 'Wake' : 'Wake', Icons.bolt, () => _wake(inst)),
                    const SizedBox(width: 8),
                    _mini('Control', Icons.tune, () => context.push('/instance/${inst.id}', extra: inst)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _mini(String label, IconData icon, VoidCallback onTap) {
    return Expanded(
      child: OutlinedButton.icon(
        onPressed: overlay == null ? onTap : null,
        icon: Icon(icon, size: 16),
        label: Text(label, style: const TextStyle(fontSize: 12)),
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.white,
          side: const BorderSide(color: Vc.cardBorder),
          padding: const EdgeInsets.symmetric(vertical: 10),
        ),
      ),
    );
  }
}
