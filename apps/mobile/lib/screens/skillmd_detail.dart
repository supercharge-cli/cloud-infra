import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/marketplace.dart';
import '../state/marketplace.dart';
import '../theme.dart';
import '../widgets/marketplace.dart';

class SkillMdDetail extends StatefulWidget {
  const SkillMdDetail({
    super.key,
    required this.controller,
    required this.item,
  });
  final MarketplaceController controller;
  final SkillMdItem item;

  @override
  State<SkillMdDetail> createState() => _SkillMdDetailState();
}

class _SkillMdDetailState extends State<SkillMdDetail> {
  SkillMdItem? _detail;
  String? _error;
  String? _consentFingerprint;
  bool _confirmRemove = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _detail = null;
      _error = null;
    });
    try {
      final data = await widget.controller.api.skillMdItem(
        widget.item.owner,
        widget.item.name,
      );
      final item = SkillMdItem.parse(data);
      if (item == null ||
          item.id != widget.item.id ||
          item.pluginId != widget.item.pluginId) {
        throw const FormatException(
          'SkillMD detail does not match the selected skill',
        );
      }
      if (mounted) setState(() => _detail = item);
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _error = 'SkillMD details unavailable. Retry before installing.',
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final c = widget.controller;
      final item = _detail;
      final installed = item == null ? null : c.installedSkill(item);
      final fingerprint = item == null ? null : c.skillReviewFingerprint(item);
      final approved =
          fingerprint != null && _consentFingerprint == fingerprint;
      final ready = c.canAct && c.actionError == null;
      return Scaffold(
        appBar: AppBar(title: const Text('SkillMD skill')),
        body: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 40),
              children: [
                Text(
                  widget.item.name,
                  style: const TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  '${widget.item.owner} · SkillMD',
                  style: const TextStyle(color: Vc.greenSoft),
                ),
                const SizedBox(height: 16),
                if (_error != null)
                  MarketplaceMessage(
                    _error!,
                    error: true,
                    action: 'Retry details',
                    onAction: _load,
                  ),
                if (item == null && _error == null)
                  const LinearProgressIndicator(
                    semanticsLabel: 'Loading SkillMD details',
                  ),
                if (item != null) ...[
                  Text(
                    item.description.isEmpty
                        ? 'No description provided by SkillMD.'
                        : item.description,
                    style: const TextStyle(height: 1.5),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${item.bundle ? 'Bundle with supporting files' : 'Single skill'}${item.verified ? ' · SkillMD verified' : ''}',
                    style: const TextStyle(color: Vc.muted),
                  ),
                  if (item.files.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    const Text(
                      'Included files',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 7),
                    if (!item.files.any(
                      (file) => '${file['path']}'.toLowerCase() == 'skill.md',
                    ))
                      const Text('SKILL.md'),
                    for (final file in item.files)
                      Text(
                        '• ${file['path']}${file['isScript'] == true ? ' · script (not run on install)' : ''}',
                        style: const TextStyle(color: Vc.muted, height: 1.5),
                      ),
                  ],
                  const SizedBox(height: 14),
                  TextButton.icon(
                    onPressed: () {
                      final uri = Uri.tryParse(item.sourceUrl);
                      if (uri != null &&
                          uri.scheme == 'https' &&
                          uri.host == 'skillmd.com') {
                        unawaited(
                          launchUrl(uri, mode: LaunchMode.externalApplication),
                        );
                      }
                    },
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Read on SkillMD'),
                  ),
                  const Divider(height: 36),
                  MarketplaceTarget(controller: c),
                  const SizedBox(height: 18),
                  if (c.actionError != null)
                    MarketplaceMessage(
                      c.actionError!,
                      error: true,
                      action: 'Refresh VM status',
                      onAction: c.loadingInventory ? null : c.refreshInventory,
                    ),
                  if (c.notice != null) MarketplaceMessage(c.notice!),
                  const SizedBox(height: 16),
                  const Text(
                    'Install to this bot',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'The complete bundle is downloaded and validated inside the VM. It starts disabled and untrusted; installation does not run scripts.',
                    style: TextStyle(color: Vc.muted, height: 1.45),
                  ),
                  const SizedBox(height: 12),
                  if (!item.installable)
                    const MarketplaceMessage(
                      'This SkillMD item has no supported complete bundle. A partial SKILL.md cannot be installed.',
                    ),
                  FilledButton(
                    onPressed: ready && item.installable && installed == null
                        ? () => c.installSkill(item)
                        : null,
                    child: Text(
                      installed == null
                          ? c.busy
                                ? 'Working…'
                                : 'Install skill bundle'
                          : 'Installed in this VM',
                    ),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Review and enable',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Read the source and included files before approving. Approval does not execute scripts or connect an MCP server.',
                    style: TextStyle(color: Vc.muted, height: 1.45),
                  ),
                  if (installed != null &&
                      (installed.permissions.isNotEmpty ||
                          installed.servers.isNotEmpty))
                    const MarketplaceMessage(
                      'This installed bundle requests unexpected permissions or MCP servers. Manage it in VM settings; approval here is blocked.',
                      error: true,
                    ),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'I reviewed this community bundle and approve its instructions.',
                    ),
                    value: approved,
                    onChanged: ready && fingerprint != null
                        ? (value) => setState(
                            () => _consentFingerprint = value == true
                                ? fingerprint
                                : null,
                          )
                        : null,
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton(
                        onPressed: ready && approved && item.installable
                            ? () async {
                                final success = await c.approveSkill(
                                  item,
                                  fingerprint,
                                );
                                if (mounted && success) {
                                  setState(() => _consentFingerprint = null);
                                }
                              }
                            : null,
                        child: Text(
                          installed?.trusted == true ? 'Approved' : 'Approve',
                        ),
                      ),
                      FilledButton(
                        onPressed:
                            ready &&
                                installed?.trusted == true &&
                                installed?.enabled != true &&
                                item.installable
                            ? () => c.setSkillEnabled(item, true)
                            : null,
                        child: Text(
                          installed?.enabled == true ? 'Enabled' : 'Enable',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Only approved and enabled skills are available to this bot. Disabling removes them from discovery.',
                    style: TextStyle(color: Vc.muted, height: 1.4),
                  ),
                  if (installed != null) ...[
                    const Divider(height: 40),
                    const Text(
                      'Manage installation',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Wrap(
                      spacing: 8,
                      children: [
                        OutlinedButton(
                          onPressed: ready && installed.enabled
                              ? () => c.setSkillEnabled(item, false)
                              : null,
                          child: const Text('Disable'),
                        ),
                        if (_confirmRemove) ...[
                          OutlinedButton(
                            onPressed: ready && !installed.enabled
                                ? () async {
                                    final success = await c.uninstallSkill(
                                      item,
                                    );
                                    if (mounted && success) {
                                      setState(() => _confirmRemove = false);
                                    }
                                  }
                                : null,
                            child: const Text('Confirm uninstall'),
                          ),
                          TextButton(
                            onPressed: () =>
                                setState(() => _confirmRemove = false),
                            child: const Text('Cancel'),
                          ),
                        ] else
                          OutlinedButton(
                            onPressed: ready && !installed.enabled
                                ? () => setState(() => _confirmRemove = true)
                                : null,
                            child: const Text('Uninstall…'),
                          ),
                      ],
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
      );
    },
  );
}
