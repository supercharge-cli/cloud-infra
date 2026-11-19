import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../chat/preview_urls.dart';
import '../desktop.dart';
import '../desktop/native.dart';
import '../desktop/inline_browser.dart';
import '../theme.dart';

const _ports = [3000, 5173, 8080, 4173, 5000, 8000];

class PreviewBrowserScreen extends StatefulWidget {
  const PreviewBrowserScreen({
    super.key,
    required this.instanceName,
    this.initialUrl,
    this.sandboxId,
    this.resolvePort,
    this.embedded = false,
  });

  final String instanceName;
  final String? initialUrl;
  final String? sandboxId;
  final Future<String?> Function(int port)? resolvePort;
  final bool embedded;

  @override
  State<PreviewBrowserScreen> createState() => _PreviewBrowserScreenState();
}

class _PreviewBrowserScreenState extends State<PreviewBrowserScreen> {
  WebViewController? _web;
  late final TextEditingController _url;
  bool loading = true;
  String? error;
  int? progress;

  @override
  void initState() {
    super.initState();
    final seed = widget.initialUrl?.trim();
    _url = TextEditingController(
      text: seed?.isNotEmpty == true
          ? seed
          : (widget.sandboxId != null && widget.sandboxId!.isNotEmpty
                ? buildPreviewUrl(sandboxId: widget.sandboxId!, port: 3000)
                : ''),
    );
    if (isDesktop) {
      loading = false;
      return;
    }
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Vc.bg)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (p) {
            if (mounted) setState(() => progress = p);
          },
          onPageStarted: (u) {
            if (!mounted) return;
            setState(() {
              loading = true;
              error = null;
              if (u.isNotEmpty && u != 'about:blank') _url.text = u;
            });
          },
          onPageFinished: (_) {
            if (mounted) setState(() => loading = false);
          },
          onWebResourceError: (e) {
            if (mounted) {
              setState(() {
                loading = false;
                error = e.description;
              });
            }
          },
        ),
      );
    if (_url.text.isNotEmpty) {
      _go(_url.text);
    }
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _go(String raw) async {
    var next = raw.trim();
    if (next.isEmpty) return;
    if (!next.contains('://')) next = 'https://$next';
    final uri = Uri.tryParse(next);
    if (uri == null ||
        !{'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty) {
      setState(() => error = 'Invalid URL');
      return;
    }
    setState(() {
      loading = true;
      error = null;
      _url.text = next;
    });
    if (isDesktop) {
      if (mounted) setState(() => loading = false);
      return;
    }
    await _web?.loadRequest(uri);
  }

  Future<void> _openPort(int port) async {
    String? url;
    if (widget.resolvePort != null) {
      url = await widget.resolvePort!(port);
    }
    url ??= widget.sandboxId != null && widget.sandboxId!.isNotEmpty
        ? buildPreviewUrl(sandboxId: widget.sandboxId!, port: port)
        : null;
    if (url == null) {
      setState(() => error = 'No sandbox id — cannot build preview URL');
      return;
    }
    await _go(url);
  }

  Widget _toolbar() {
    return Row(
      children: [
          IconButton(
            tooltip: 'Back',
            onPressed: isDesktop
                ? () => DesktopNative.inlineCommand(
                    DesktopNative.previewSurface,
                    'back',
                  )
                : () => _web?.goBack(),
            icon: const Icon(Icons.arrow_back_ios_new, size: 18),
          ),
          IconButton(
            tooltip: 'Forward',
            onPressed: isDesktop
                ? () => DesktopNative.inlineCommand(
                    DesktopNative.previewSurface,
                    'forward',
                  )
                : () => _web?.goForward(),
            icon: const Icon(Icons.arrow_forward_ios, size: 18),
          ),
          IconButton(
            tooltip: 'Reload',
            onPressed: isDesktop
                ? () => DesktopNative.inlineCommand(
                    DesktopNative.previewSurface,
                    'reload',
                  )
                : () => _web?.reload(),
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Open in browser',
            onPressed: () {
              final u = Uri.tryParse(_url.text.trim());
              if (u != null) {
                launchUrl(u, mode: LaunchMode.externalApplication);
              }
            },
            icon: const Icon(Icons.open_in_new),
          ),
        ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final column = Column(
      children: [
        if (widget.embedded) _toolbar(),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: TextField(
              controller: _url,
              style: const TextStyle(fontSize: 13),
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.go,
              decoration: InputDecoration(
                hintText: 'https://3000-{sandbox}.e2b.app',
                prefixIcon: const Icon(
                  Icons.language,
                  size: 18,
                  color: Vc.muted,
                ),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.arrow_forward, size: 18),
                  onPressed: () => _go(_url.text),
                ),
              ),
              onSubmitted: _go,
            ),
          ),
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              children: [
                for (final p in _ports)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ActionChip(
                      label: Text(':$p', style: const TextStyle(fontSize: 12)),
                      onPressed: () {
                        _openPort(p);
                      },
                    ),
                  ),
              ],
            ),
          ),
          if (loading && (progress ?? 0) < 100)
            LinearProgressIndicator(
              value: progress == null ? null : progress! / 100,
              minHeight: 2,
              color: Vc.green,
              backgroundColor: Vc.card,
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
              child: Text(
                error!,
                style: const TextStyle(color: Vc.amber, fontSize: 12),
              ),
            ),
          Expanded(
            child: _url.text.isEmpty
                ? const Center(
                    child: Text(
                      'Pick a port or paste a preview URL.',
                      style: TextStyle(color: Vc.muted),
                    ),
                  )
                : isDesktop
                ? InlineBrowserView(
                    surface: DesktopNative.previewSurface,
                    url: _url.text,
                  )
                : WebViewWidget(controller: _web!),
          ),
        ],
    );
    if (widget.embedded) {
      return ColoredBox(color: Vc.bg, child: column);
    }
    return Scaffold(
      backgroundColor: Vc.bg,
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Preview',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            Text(
              widget.instanceName,
              style: const TextStyle(
                color: Vc.muted,
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        actions: [_toolbar()],
      ),
      body: column,
    );
  }
}
