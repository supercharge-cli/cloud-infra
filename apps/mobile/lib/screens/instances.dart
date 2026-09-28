import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../api/client.dart';
import '../desktop.dart';
import '../desktop/shortcuts.dart';
import '../api/models.dart';
import '../chat/cli_update.dart';
import '../state/session.dart';
import '../state/workspaces.dart';
import '../theme.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

class InstancesScreen extends StatefulWidget {
  const InstancesScreen({super.key});
  @override
  State<InstancesScreen> createState() => _InstancesScreenState();
}

class _InstancesScreenState extends State<InstancesScreen> {
  WorkspaceCatalog? _catalog;
  WorkspaceCatalog get catalog => _catalog ?? context.read<SessionController>().workspaces;
  List<CloudInstance> get items => catalog.items;
  FreeQuota get quota => catalog.quota;
  PlanInfo? get plan => catalog.plan;
  bool get loading => catalog.loading;
  String? get error => catalog.error;
  String? overlay;
  final cliById = <String, CliVersion>{};
  final _search = TextEditingController();
  final _searchFocus = FocusNode();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = context.read<SessionController>().workspaces;
    if (_catalog == next) return;
    _catalog?.removeListener(_catalogChanged);
    _catalog = next;
    next.addListener(_catalogChanged);
  }

  void _catalogChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _catalog?.removeListener(_catalogChanged);
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  VectraClient get api => context.read<SessionController>().client;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_reload());
    });
  }

  Future<void> _reload() async {
    await catalog.refresh();
    if (mounted && catalog.error == null) unawaited(_checkCliUpdates());
  }

  Future<void> _checkCliUpdates() async {
    final targets = items
        .where((i) => !i.pastDue && i.status != 'destroyed')
        .take(8)
        .toList();
    for (final inst in targets) {
      try {
        final raw = await api.cliVersion(inst.id);
        final info = CliVersion.fromJson(raw, runtime: inst.runtime.apiValue);
        if (!mounted) return;
        setState(() => cliById[inst.id] = info);
        if (info.updateAvailable) {
          await CliUpdateOffer.notifyOnce(
            instanceId: inst.id,
            name: inst.name,
            info: info,
          );
        }
      } catch (_) {}
    }
  }

  Future<void> _afterPush(Future<dynamic> nav) async {
    await nav;
    if (mounted) _reload();
  }

  Future<void> _create() async {
    final request = await showDialog<CreateInstanceRequest>(
      context: context,
      builder: (ctx) =>
          _CreateInstanceDialog(canCreateFree: quota.canCreateFree),
    );
    if (request == null || request.name.isEmpty) return;
    final name = request.name;
    final runtime = request.runtime;
    if (request.paid) {
      if (!mounted) return;
      await _afterPush(
        context.push(
          '/billing',
          extra: BillingArgs(name: name, runtime: runtime),
        ),
      );
      return;
    }
    setState(() => overlay = 'Provisioning sandbox…');
    try {
      final created = await api.createInstance(name, runtime: runtime);
      catalog.upsert(created);
      unawaited(_reload());
      if (!mounted) return;
      context.push('/chat/${created.id}', extra: created);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.paymentRequired) {
        if (!mounted) return;
        await _afterPush(
          context.push(
            '/billing',
            extra: BillingArgs(name: name, runtime: runtime),
          ),
        );
      } else {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
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
    return AppScaffold(
      isRoot: true,
      commands: {
        DesktopCommand.newWorkspace: overlay == null ? _create : null,
        DesktopCommand.refresh: overlay == null ? _reload : null,
        DesktopCommand.search: _searchFocus.requestFocus,
      },
      appBar: AppBar(
        actions: isDesktop
            ? [
                IconButton(
                  tooltip: 'Refresh (Ctrl+R)',
                  onPressed: overlay == null ? _reload : null,
                  icon: const Icon(Icons.refresh, size: 20),
                ),
                const SizedBox(width: 8),
                Center(
                  child: FilledButton.icon(
                    onPressed: overlay == null ? _create : null,
                    icon: const Icon(Icons.add, size: 17),
                    label: const Text('New workspace'),
                  ),
                ),
                const SizedBox(width: 8),
              ]
            : null,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Vectra Cloud',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.4,
              ),
            ),
            Text(
              'Your sandboxes',
              style: TextStyle(
                fontSize: 12,
                color: Vc.muted,
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: isDesktop
          ? null
          : FloatingActionButton.extended(
              onPressed: overlay == null ? _create : null,
              backgroundColor: Vc.green,
              foregroundColor: Colors.black,
              icon: const Icon(Icons.add),
              label: Text(
                quota.canCreateFree ? 'Create' : 'Pay & create',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
      body: Stack(
        children: [
          RefreshIndicator(
            color: Vc.green,
            onRefresh: _reload,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
              children: [
                _quotaCard(),
                if (cliById.values.any((c) => c.updateAvailable)) ...[
                  const SizedBox(height: 12),
                  VcPanel(
                    child: Row(
                      children: [
                        const Icon(
                          Icons.system_update_alt,
                          color: Vc.amber,
                          size: 20,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(() {
                            final sc = items.any(
                              (i) =>
                                  i.runtime == AgentRuntime.supercharge &&
                                  cliById[i.id]?.updateAvailable == true,
                            );
                            final xc = items.any(
                              (i) =>
                                  i.runtime != AgentRuntime.supercharge &&
                                  cliById[i.id]?.updateAvailable == true,
                            );
                            if (sc && xc) {
                              return 'A Supercharge or XibeCode CLI update is out. Open that workspace and tap Update.';
                            }
                            if (sc) {
                              return 'A new Supercharge CLI is out. Open a Supercharge workspace and tap Update — same as /update.';
                            }
                            return 'A new XibeCode CLI is out. Open a XibeCode workspace and tap Update — same as /update.';
                          }(), style: const TextStyle(fontSize: 13, height: 1.35)),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                if (isDesktop) ...[
                  TextField(
                    controller: _search,
                    focusNode: _searchFocus,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      hintText: 'Find a workspace…',
                      prefixIcon: Icon(Icons.search, size: 19),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (loading)
                  const Padding(
                    padding: EdgeInsets.only(top: 80),
                    child: Center(
                      child: CircularProgressIndicator(color: Vc.green),
                    ),
                  )
                else if (error != null)
                  Column(
                    children: [
                      Text(error!, style: const TextStyle(color: Vc.red)),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: _reload,
                        child: const Text('Retry'),
                      ),
                    ],
                  )
                else if (items.isEmpty)
                  const EmptyState(
                    icon: Icons.cloud_outlined,
                    title: 'No instances yet',
                    detail:
                        'Create a free sandbox, then open Chat. Wake, billing, and AI config live in Control.',
                  )
                else if (isDesktop)
                  _desktopList()
                else
                  for (final inst in items) _card(inst),
              ],
            ),
          ),
          if (overlay != null)
            BusyOverlay(
              message: overlay!,
              detail: 'This can take up to a minute',
            ),
        ],
      ),
    );
  }

  Widget _desktopList() {
    final query = _search.text.trim().toLowerCase();
    final visible = items
        .where(
          (item) => '${item.name} ${item.runtimeLabel} ${item.displayState}'
              .toLowerCase()
              .contains(query),
        )
        .toList();
    if (visible.isEmpty) {
      return const EmptyState(
        icon: Icons.search_off,
        title: 'No matching workspaces',
        detail: 'Try a different name, runtime, or status.',
      );
    }
    return Material(
      color: Vc.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: Vc.cardBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: Text(
                    'Workspace',
                    style: TextStyle(color: Vc.muted, fontSize: 12),
                  ),
                ),
                Expanded(
                  child: Text(
                    'Runtime',
                    style: TextStyle(color: Vc.muted, fontSize: 12),
                  ),
                ),
                SizedBox(
                  width: 120,
                  child: Text(
                    'Status',
                    style: TextStyle(color: Vc.muted, fontSize: 12),
                  ),
                ),
                SizedBox(width: 100),
              ],
            ),
          ),
          const Divider(height: 1),
          for (final item in visible) ...[
            InkWell(
              onTap: () =>
                  _afterPush(context.push('/chat/${item.id}', extra: item)),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 12,
                ),
                child: Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: Row(
                        children: [
                          const Icon(
                            Icons.cloud_outlined,
                            size: 20,
                            color: Vc.muted,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  item.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                if (item.lastError?.isNotEmpty == true)
                                  Text(
                                    item.lastError!,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Vc.red,
                                      fontSize: 12,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: Text(
                        item.runtimeLabel,
                        style: const TextStyle(color: Vc.muted, fontSize: 12),
                      ),
                    ),
                    SizedBox(
                      width: 120,
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: StateChip(item.displayState),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Wake workspace',
                      onPressed: overlay == null ? () => _wake(item) : null,
                      icon: const Icon(Icons.bolt, size: 19),
                    ),
                    PopupMenuButton<String>(
                      tooltip: 'Workspace actions',
                      onSelected: (value) {
                        if (value == 'chat') {
                          context.push('/chat/${item.id}', extra: item);
                        }
                        if (value == 'files') {
                          context.push(
                            '/instance/${item.id}/files',
                            extra: item,
                          );
                        }
                        if (value == 'settings') {
                          context.push('/instance/${item.id}', extra: item);
                        }
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'chat', child: Text('Open chat')),
                        PopupMenuItem(
                          value: 'files',
                          child: Text('Browse files'),
                        ),
                        PopupMenuItem(
                          value: 'settings',
                          child: Text('Workspace settings'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            if (item != visible.last) const Divider(height: 1),
          ],
        ],
      ),
    );
  }

  Widget _quotaCard() {
    if (isDesktop) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 2),
        child: Row(
          children: [
            const Expanded(
              child: Text(
                'Workspaces',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
              ),
            ),
            Text(
              '${quota.used} / ${quota.limit} free slots used',
              style: const TextStyle(color: Vc.muted, fontSize: 12),
            ),
          ],
        ),
      );
    }
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
                Text(
                  '$used',
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Free quota',
                  style: TextStyle(color: Vc.muted, fontSize: 12),
                ),
                const SizedBox(height: 3),
                Text(
                  '$used / ${quota.limit} used',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),
          if (plan != null)
            Text(
              '${plan!.inrLabel}\n${plan!.usdLabel}',
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: Vc.muted,
                fontSize: 11,
                height: 1.35,
              ),
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
          side: BorderSide(
            color: inst.pastDue ? Vc.red.withValues(alpha: 0.5) : Vc.cardBorder,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () =>
              _afterPush(context.push('/chat/${inst.id}', extra: inst)),
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
                          child: Text(
                            letter,
                            style: const TextStyle(
                              color: Vc.green,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
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
                          Text(
                            inst.name,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.2,
                            ),
                          ),
                          Text(
                            inst.runtimeLabel,
                            style: TextStyle(
                              color: inst.runtime == AgentRuntime.supercharge
                                  ? Vc.green
                                  : Vc.muted,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (inst.paidUntil != null &&
                              inst.paidUntil!.isNotEmpty)
                            Text(
                              'Paid until ${inst.paidUntil}',
                              style: const TextStyle(
                                color: Vc.faint,
                                fontSize: 11,
                              ),
                            ),
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
                    if (cliById[inst.id]?.updateAvailable == true)
                      const Padding(
                        padding: EdgeInsets.only(left: 6),
                        child: StateChip('cli update'),
                      ),
                  ],
                ),
                if (inst.liveMessage != null &&
                    inst.liveMessage!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    inst.liveMessage!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Vc.muted, fontSize: 12),
                  ),
                ],
                if (inst.lastError != null && inst.lastError!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    inst.lastError!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Vc.red, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    _mini(
                      'Chat',
                      Icons.chat_bubble_outline,
                      () => _afterPush(
                        context.push('/chat/${inst.id}', extra: inst),
                      ),
                    ),
                    const SizedBox(width: 8),
                    _mini('Wake', Icons.bolt, () => _wake(inst)),
                    const SizedBox(width: 8),
                    _mini(
                      'Control',
                      Icons.tune,
                      () => _afterPush(
                        context.push('/instance/${inst.id}', extra: inst),
                      ),
                    ),
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
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CreateInstanceDialog extends StatefulWidget {
  const _CreateInstanceDialog({required this.canCreateFree});
  final bool canCreateFree;

  @override
  State<_CreateInstanceDialog> createState() => _CreateInstanceDialogState();
}

class _CreateInstanceDialogState extends State<_CreateInstanceDialog> {
  final _name = TextEditingController(text: 'workspace');
  AgentRuntime _runtime = AgentRuntime.xibecode;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _submit({required bool paid}) {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    Navigator.pop(
      context,
      CreateInstanceRequest(name: name, runtime: _runtime, paid: paid),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New instance'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Agent image',
            style: TextStyle(
              color: Vc.muted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          SegmentedButton<AgentRuntime>(
            segments: const [
              ButtonSegment(
                value: AgentRuntime.xibecode,
                label: Text('XibeCode'),
              ),
              ButtonSegment(
                value: AgentRuntime.supercharge,
                label: Text('Supercharge'),
              ),
            ],
            selected: {_runtime},
            onSelectionChanged: (value) {
              if (value.isEmpty) return;
              setState(() => _runtime = value.first);
            },
          ),
          const SizedBox(height: 6),
          const Text(
            'Supercharge uses the published Supercharge E2B template. XibeCode keeps the existing image.',
            style: TextStyle(color: Vc.faint, fontSize: 11, height: 1.35),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Name'),
          ),
          const SizedBox(height: 12),
          Text(
            widget.canCreateFree
                ? 'Free slot available.'
                : 'Free quota used. Extra instances are paid.',
            style: const TextStyle(color: Vc.muted, fontSize: 12),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        if (!widget.canCreateFree)
          FilledButton(
            onPressed: () => _submit(paid: true),
            child: const Text('Pay & create'),
          )
        else ...[
          if (!isDesktop)
            OutlinedButton(
              onPressed: () => _submit(paid: true),
              child: const Text('Pay extra'),
            ),
          FilledButton(
            onPressed: () => _submit(paid: false),
            child: const Text('Create free'),
          ),
        ],
      ],
    );
  }
}
