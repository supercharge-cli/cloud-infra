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

  Future<void> _afterPush(Future<dynamic> nav) async {
    await nav;
    if (mounted) _reload();
  }

  Future<void> _create() async {
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController(text: 'workspace');
        return AlertDialog(
          title: const Text('New instance'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(controller: c, decoration: const InputDecoration(labelText: 'Name')),
              const SizedBox(height: 12),
              Text(
                quota.canCreateFree
                    ? 'Free slot available (${quota.used}/${quota.limit} used).'
                    : 'Free quota used. Extra instances are paid.',
                style: const TextStyle(color: Vc.muted, fontSize: 12),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            if (!quota.canCreateFree)
              FilledButton(
                onPressed: () => Navigator.pop(ctx, 'pay:${c.text.trim()}'),
                child: const Text('Pay & create'),
              )
            else ...[
              OutlinedButton(
                onPressed: () => Navigator.pop(ctx, 'pay:${c.text.trim()}'),
                child: const Text('Pay extra'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, c.text.trim()),
                child: const Text('Create free'),
              ),
            ],
          ],
        );
      },
    );
    if (name == null || name.isEmpty) return;
    if (name.startsWith('pay:')) {
      final paidName = name.substring(4);
      if (paidName.isEmpty) return;
      if (!mounted) return;
      await _afterPush(context.push('/billing', extra: BillingArgs(name: paidName)));
      return;
    }
    setState(() => overlay = 'Provisioning sandbox…');
    try {
      final created = await api.createInstance(name);
      await _reload();
      if (!mounted) return;
      context.push('/chat/${created.id}', extra: created);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.paymentRequired) {
        if (!mounted) return;
        await _afterPush(context.push('/billing', extra: BillingArgs(name: name)));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
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
    return AppPopScope(
      isRoot: true,
      child: Scaffold(
        appBar: AppBar(
          title: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Vectra Cloud', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
              Text('Your sandboxes', style: TextStyle(fontSize: 12, color: Vc.muted, fontWeight: FontWeight.w400)),
            ],
          ),
          actions: [
            IconButton(onPressed: () => _afterPush(context.push('/billing')), icon: const Icon(Icons.payments_outlined)),
            IconButton(onPressed: () => _afterPush(context.push('/account')), icon: const Icon(Icons.person_outline)),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: overlay == null ? _create : null,
          backgroundColor: Vc.green,
          foregroundColor: Colors.black,
          icon: const Icon(Icons.add),
          label: Text(quota.canCreateFree ? 'Create' : 'Pay & create', style: const TextStyle(fontWeight: FontWeight.w800)),
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
                    Column(
                      children: [
                        Text(error!, style: const TextStyle(color: Vc.red)),
                        const SizedBox(height: 12),
                        OutlinedButton(onPressed: _reload, child: const Text('Retry')),
                      ],
                    )
                  else if (items.isEmpty)
                    const EmptyState(
                      icon: Icons.cloud_outlined,
                      title: 'No instances yet',
                      detail: 'Create a free sandbox, then open Chat. Wake, billing, and AI config live in Control.',
                    )
                  else
                    for (final inst in items) _card(inst),
                ],
              ),
            ),
            if (overlay != null) BusyOverlay(message: overlay!, detail: 'This can take up to a minute'),
          ],
        ),
      ),
    );
  }

  Widget _quotaCard() {
    final used = quota.used;
    final limit = quota.limit <= 0 ? 1 : quota.limit;
    return VcPanel(
      child: Row(
        children: [
          SizedBox(
            width: 46,
            height: 46,
            child: Stack(
              alignment: Alignment.center,
              children: [
                CircularProgressIndicator(
                  value: (used / limit).clamp(0, 1),
                  color: Vc.green,
                  backgroundColor: Vc.elevated,
                  strokeWidth: 4,
                ),
                Text('$used', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Free quota', style: TextStyle(color: Vc.muted, fontSize: 12)),
                const SizedBox(height: 3),
                Text(
                  '$used / ${quota.limit} used',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                ),
              ],
            ),
          ),
          if (plan != null)
            Text(
              '${plan!.inrLabel}\n${plan!.usdLabel}',
              textAlign: TextAlign.right,
              style: const TextStyle(color: Vc.muted, fontSize: 11, height: 1.35),
            ),
        ],
      ),
    );
  }

  Widget _card(CloudInstance inst) {
    final letter = inst.name.isNotEmpty ? inst.name[0].toUpperCase() : 'W';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Vc.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: inst.pastDue ? Vc.red.withValues(alpha: 0.5) : Vc.cardBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _afterPush(context.push('/chat/${inst.id}', extra: inst)),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Stack(
                      children: [
                        CircleAvatar(
                          radius: 20,
                          backgroundColor: Vc.green.withValues(alpha: 0.14),
                          child: Text(letter, style: const TextStyle(color: Vc.green, fontWeight: FontWeight.w800)),
                        ),
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: StatusDot(inst.displayState, size: 10),
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(inst.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: -0.2)),
                          if (inst.paidUntil != null && inst.paidUntil!.isNotEmpty)
                            Text('Paid until ${inst.paidUntil}', style: const TextStyle(color: Vc.faint, fontSize: 11)),
                        ],
                      ),
                    ),
                    StateChip(inst.displayState),
                    if (inst.isFree)
                      const Padding(
                        padding: EdgeInsets.only(left: 6),
                        child: StateChip('free'),
                      ),
                    if (inst.pastDue)
                      const Padding(
                        padding: EdgeInsets.only(left: 6),
                        child: StateChip('past_due'),
                      ),
                  ],
                ),
                if (inst.liveMessage != null && inst.liveMessage!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(inst.liveMessage!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Vc.muted, fontSize: 12)),
                ],
                if (inst.lastError != null && inst.lastError!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(inst.lastError!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Vc.red, fontSize: 12)),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    _mini('Chat', Icons.chat_bubble_outline, () => _afterPush(context.push('/chat/${inst.id}', extra: inst))),
                    const SizedBox(width: 8),
                    _mini('Wake', Icons.bolt, () => _wake(inst)),
                    const SizedBox(width: 8),
                    _mini('Control', Icons.tune, () => _afterPush(context.push('/instance/${inst.id}', extra: inst))),
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
      child: Material(
        color: Vc.elevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: Vc.cardBorder),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: overlay == null ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 15, color: Vc.greenSoft),
                const SizedBox(width: 6),
                Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
