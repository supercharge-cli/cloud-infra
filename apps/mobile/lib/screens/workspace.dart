import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../desktop.dart';
import '../desktop/native.dart';
import '../desktop/shortcuts.dart';
import '../state/session.dart';
import '../theme.dart';
import '../widgets/side_panel.dart';
import '../widgets/ui.dart';

class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({super.key, required this.instanceId, this.instance});
  final String instanceId;
  final CloudInstance? instance;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  static const root = '/home/user/workspace';
  String path = root;
  List<WorkspaceEntry> entries = [];
  bool loading = true;
  String? msg;
  String? overlay;
  WorkspaceEntry? selected;
  String? preview;
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  int _previewGeneration = 0;

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  String get parent {
    if (path == root) return root;
    final trimmed = path.replaceAll(RegExp(r'/+$'), '');
    final i = trimmed.lastIndexOf('/');
    return i <= 0 ? root : trimmed.substring(0, i);
  }

  Future<void> _load([String? next]) async {
    _previewGeneration++;
    setState(() {
      loading = true;
      msg = null;
      selected = null;
      preview = null;
      if (next != null) {
        path = next;
        _search.clear();
      }
    });
    try {
      final list = await api.listWorkspace(id, path: path);
      list.sort((a, b) {
        if (a.isDir != b.isDir) return a.isDir ? -1 : 1;
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
      if (mounted) setState(() => entries = list);
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted) setState(() => loading = false);
  }

  String _join(String name) =>
      path.endsWith('/') ? '$path$name' : '$path/$name';

  Future<void> _open(WorkspaceEntry entry) async {
    if (overlay != null) return;
    final full = _join(entry.name);
    if (entry.isDir) {
      await _load(full);
      return;
    }
    final generation = ++_previewGeneration;
    setState(() {
      selected = entry;
      preview = null;
      overlay = 'Opening ${entry.name}…';
      msg = null;
    });
    try {
      final content = await api.readWorkspaceFile(id, full);
      if (!mounted || generation != _previewGeneration) return;
      if (isDesktop && MediaQuery.sizeOf(context).width >= 1050) {
        setState(() => preview = content);
      } else {
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              appBar: AppBar(
                title: Text(entry.name),
                actions: [
                  IconButton(
                    tooltip: 'Save file',
                    onPressed: () => _download(entry, content),
                    icon: const Icon(Icons.save_alt),
                  ),
                  IconButton(
                    tooltip: 'Copy share link',
                    onPressed: () => _shareLink(full),
                    icon: const Icon(Icons.link),
                  ),
                ],
              ),
              body: _textPreview(content),
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted && generation == _previewGeneration) {
      setState(() => overlay = null);
    }
  }

  Future<void> _download(WorkspaceEntry entry, [String? content]) async {
    setState(() => overlay = 'Saving ${entry.name}…');
    try {
      final text =
          content ?? await api.readWorkspaceFile(id, _join(entry.name));
      final bytes = Uint8List.fromList(utf8.encode(text));
      if (isDesktop) {
        final saved = await DesktopNative.saveBytes(bytes, entry.name);
        if (mounted && saved != null) {
          setState(() => msg = 'Saved ${saved.toFilePath()}');
        }
      } else {
        final dir = await getTemporaryDirectory();
        final file = File('${dir.path}/${DesktopNative.fileName(entry.name)}');
        await file.writeAsBytes(bytes);
        await SharePlus.instance.share(
          ShareParams(files: [XFile(file.path)], text: entry.name),
        );
      }
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted) setState(() => overlay = null);
  }

  Future<void> _shareLink(String full) async {
    setState(() => overlay = 'Creating share link…');
    try {
      final url = await api.shareWorkspaceFile(id, full);
      if (!mounted) return;
      if (url == null || url.isEmpty) {
        setState(() => msg = 'Could not create a share link.');
      } else {
        await Clipboard.setData(ClipboardData(text: url));
        if (mounted) setState(() => msg = 'Share link copied.');
      }
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted) setState(() => overlay = null);
  }

  Future<void> _exportAll() async {
    if (overlay != null) return;
    setState(() => overlay = 'Preparing workspace archive…');
    try {
      final archive = await api.exportWorkspace(id);
      if (isDesktop) {
        final saved = await DesktopNative.saveBytes(
          Uint8List.fromList(archive.bytes),
          archive.name,
          mime: archive.mime,
        );
        if (mounted && saved != null) {
          setState(() => msg = 'Saved ${saved.toFilePath()}');
        }
      } else {
        final dir = await getTemporaryDirectory();
        final file = File(
          '${dir.path}/${DesktopNative.fileName(archive.name)}',
        );
        await file.writeAsBytes(archive.bytes);
        await SharePlus.instance.share(
          ShareParams(files: [XFile(file.path)], text: 'Workspace archive'),
        );
      }
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted) setState(() => overlay = null);
  }

  String _bytes(int n) {
    if (n < 1024) return '$n B';
    if (n < 1024 * 1024) return '${(n / 1024).toStringAsFixed(1)} KB';
    return '${(n / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Widget _textPreview(String text) => Scrollbar(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: SizedBox(
        width: double.infinity,
        child: SelectableText(
          text.isEmpty ? '(empty file)' : text,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 13,
            height: 1.5,
          ),
        ),
      ),
    ),
  );

  Future<void> _contextMenu(
    WorkspaceEntry entry,
    TapDownDetails details,
  ) async {
    final choice = await showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(
        details.globalPosition.dx,
        details.globalPosition.dy,
        details.globalPosition.dx,
        details.globalPosition.dy,
      ),
      items: [
        const PopupMenuItem(value: 'open', child: Text('Open')),
        if (!entry.isDir)
          const PopupMenuItem(value: 'save', child: Text('Save as…')),
        const PopupMenuItem(value: 'copy', child: Text('Copy path')),
        if (!entry.isDir)
          const PopupMenuItem(value: 'share', child: Text('Create share link')),
      ],
    );
    if (!mounted) return;
    switch (choice) {
      case 'open':
        await _open(entry);
      case 'save':
        await _download(entry);
      case 'copy':
        await Clipboard.setData(ClipboardData(text: _join(entry.name)));
      case 'share':
        await _shareLink(_join(entry.name));
    }
  }

  Widget _fileList() {
    final query = _search.text.toLowerCase();
    final visible = entries
        .where((entry) => entry.name.toLowerCase().contains(query))
        .toList();
    if (loading) return const Center(child: CircularProgressIndicator());
    if (visible.isEmpty) {
      return Center(
        child: Text(
          query.isEmpty ? 'Workspace is empty.' : 'No matching files.',
          style: const TextStyle(color: Vc.muted),
        ),
      );
    }
    return ListView.builder(
      itemCount: visible.length,
      itemBuilder: (context, index) {
        final entry = visible[index];
        return GestureDetector(
          onSecondaryTapDown: isDesktop
              ? (details) => _contextMenu(entry, details)
              : null,
          child: ListTile(
            selected: entry.name == selected?.name,
            selectedTileColor: Vc.green.withValues(alpha: .09),
            leading: Icon(
              entry.isDir
                  ? Icons.folder_outlined
                  : Icons.insert_drive_file_outlined,
              size: 21,
              color: entry.isDir ? Vc.amber : Vc.muted,
            ),
            title: Text(
              entry.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: isDesktop ? 13 : 14),
            ),
            subtitle: isDesktop || entry.isDir
                ? null
                : Text(_bytes(entry.size)),
            trailing: entry.isDir
                ? const Icon(Icons.chevron_right, size: 18)
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (isDesktop)
                        Text(
                          _bytes(entry.size),
                          style: const TextStyle(color: Vc.muted, fontSize: 11),
                        ),
                      IconButton(
                        tooltip: 'Save as…',
                        onPressed: overlay == null
                            ? () => _download(entry)
                            : null,
                        icon: const Icon(Icons.download, size: 18),
                      ),
                    ],
                  ),
            onTap: overlay == null ? () => _open(entry) : null,
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) => AppScaffold(
    currentInstanceId: id,
    fullWidth: true,
    commands: {
      DesktopCommand.refresh: overlay == null ? () => _load() : null,
      DesktopCommand.search: _searchFocus.requestFocus,
      DesktopCommand.save: selected == null || overlay != null
          ? null
          : () => _download(selected!, preview),
      DesktopCommand.export: overlay == null ? _exportAll : null,
    },
    appBar: AppBar(
      title: const Text('Files'),
      actions: [
        IconButton(
          tooltip: 'Refresh (Ctrl+R)',
          onPressed: loading ? null : () => _load(),
          icon: const Icon(Icons.refresh),
        ),
        IconButton(
          tooltip: 'Export workspace (Ctrl+Shift+S)',
          onPressed: overlay == null ? _exportAll : null,
          icon: const Icon(Icons.archive_outlined),
        ),
      ],
    ),
    body: Stack(
      children: [
        Column(
          children: [
            if (msg != null)
              ErrorBanner(
                message: msg!,
                onDismiss: () => setState(() => msg = null),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Parent folder',
                    onPressed: path == root || loading
                        ? null
                        : () => _load(parent),
                    icon: const Icon(Icons.arrow_upward, size: 19),
                  ),
                  Expanded(
                    child: SelectableText(
                      path,
                      maxLines: 1,
                      style: const TextStyle(
                        color: Vc.muted,
                        fontFamily: 'monospace',
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (isDesktop)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: TextField(
                  controller: _search,
                  focusNode: _searchFocus,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Filter files…',
                    prefixIcon: Icon(Icons.search, size: 18),
                  ),
                ),
              ),
            const Divider(height: 1),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  if (!isDesktop || constraints.maxWidth < 800) {
                    return _fileList();
                  }
                  return Row(
                    children: [
                      SizedBox(width: 340, child: _fileList()),
                      const VerticalDivider(width: 1),
                      Expanded(
                        child: selected == null
                            ? const Center(
                                child: Text(
                                  'Select a file to preview',
                                  style: TextStyle(color: Vc.muted),
                                ),
                              )
                            : Column(
                                children: [
                                  ListTile(
                                    title: Text(
                                      selected!.name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    trailing: IconButton(
                                      tooltip: 'Copy share link',
                                      onPressed: () =>
                                          _shareLink(_join(selected!.name)),
                                      icon: const Icon(Icons.link, size: 18),
                                    ),
                                  ),
                                  const Divider(height: 1),
                                  Expanded(
                                    child: preview == null
                                        ? const Center(
                                            child: CircularProgressIndicator(),
                                          )
                                        : _textPreview(preview!),
                                  ),
                                ],
                              ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
        if (overlay != null) BusyOverlay(message: overlay!),
      ],
    ),
  );
}
