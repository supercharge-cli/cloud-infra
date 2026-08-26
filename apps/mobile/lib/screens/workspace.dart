import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../api/client.dart';
import '../api/models.dart';
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

  VectraClient get api => context.read<SessionController>().client;
  String get id => widget.instanceId;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  String get parent {
    if (path == root) return root;
    final trimmed = path.replaceAll(RegExp(r'/+$'), '');
    final i = trimmed.lastIndexOf('/');
    return i <= 0 ? root : trimmed.substring(0, i);
  }

  Future<void> _load([String? next]) async {
    setState(() {
      loading = true;
      msg = null;
      if (next != null) path = next;
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

  String _join(String name) {
    if (path.endsWith('/')) return '$path$name';
    return '$path/$name';
  }

  Future<void> _open(WorkspaceEntry entry) async {
    final full = _join(entry.name);
    if (entry.isDir) {
      await _load(full);
      return;
    }
    setState(() => overlay = 'Opening ${entry.name}…');
    try {
      final content = await api.readWorkspaceFile(id, full);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => _FilePreview(
            name: entry.name,
            path: full,
            content: content,
            onDownload: () => _download(entry, content),
            onShareLink: () => _shareLink(full),
          ),
        ),
      );
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted) setState(() => overlay = null);
  }

  Future<File> _writeTemp(String name, String content) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$name');
    await file.writeAsString(content);
    return file;
  }

  Future<void> _download(WorkspaceEntry entry, [String? content]) async {
    setState(() => overlay = 'Saving ${entry.name}…');
    try {
      final text = content ?? await api.readWorkspaceFile(id, _join(entry.name));
      final file = await _writeTemp(entry.name, text);
      if (!mounted) return;
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], text: entry.name));
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
        setState(() => msg = 'Share link copied.');
      }
    } catch (e) {
      if (mounted) setState(() => msg = e.toString());
    }
    if (mounted) setState(() => overlay = null);
  }

  Future<void> _exportAll() async {
    final url = '${api.baseUrl}/api/instances/$id/workspace/export';
    setState(() => overlay = 'Opening workspace archive…');
    try {
      await SharePlus.instance.share(ShareParams(uri: Uri.parse(url), text: 'Workspace export'));
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      currentInstanceId: id,
      appBar: AppBar(
        title: const Text('Files'),
        actions: [
          IconButton(onPressed: loading ? null : () => _load(), icon: const Icon(Icons.refresh)),
          IconButton(onPressed: overlay != null ? null : _exportAll, icon: const Icon(Icons.archive_outlined)),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              if (msg != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Text(msg!, style: const TextStyle(color: Vc.green, fontSize: 13)),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Row(
                  children: [
                    if (path != root)
                      IconButton(
                        onPressed: () => _load(parent),
                        icon: const Icon(Icons.arrow_upward),
                      ),
                    Expanded(
                      child: Text(
                        path,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Vc.muted, fontSize: 12, fontFamily: 'monospace'),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: loading
                    ? const Center(child: CircularProgressIndicator(color: Vc.green))
                    : entries.isEmpty
                        ? const Center(child: Text('Workspace is empty.', style: TextStyle(color: Vc.muted)))
                        : ListView.builder(
                            itemCount: entries.length,
                            itemBuilder: (ctx, i) {
                              final e = entries[i];
                              return ListTile(
                                leading: Icon(e.isDir ? Icons.folder : Icons.insert_drive_file_outlined, color: e.isDir ? Vc.amber : Vc.muted),
                                title: Text(e.name),
                                subtitle: e.isDir ? null : Text(_bytes(e.size), style: const TextStyle(color: Vc.muted, fontSize: 12)),
                                trailing: e.isDir
                                    ? const Icon(Icons.chevron_right, color: Vc.muted)
                                    : IconButton(
                                        tooltip: 'Download',
                                        onPressed: () => _download(e),
                                        icon: const Icon(Icons.download),
                                      ),
                                onTap: () => unawaited(_open(e)),
                              );
                            },
                          ),
              ),
            ],
          ),
          if (overlay != null) BusyOverlay(message: overlay!, detail: 'Workspace files'),
        ],
      ),
    );
  }
}

class _FilePreview extends StatelessWidget {
  const _FilePreview({
    required this.name,
    required this.path,
    required this.content,
    required this.onDownload,
    required this.onShareLink,
  });
  final String name;
  final String path;
  final String content;
  final Future<void> Function() onDownload;
  final Future<void> Function() onShareLink;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(name),
        actions: [
          IconButton(onPressed: () => unawaited(onShareLink()), icon: const Icon(Icons.link)),
          IconButton(onPressed: () => unawaited(onDownload()), icon: const Icon(Icons.download)),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: Text(path, style: const TextStyle(color: Vc.muted, fontSize: 12, fontFamily: 'monospace')),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: SelectableText(
                content.isEmpty ? '(empty file)' : content,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12, height: 1.4),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
