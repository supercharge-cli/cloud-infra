import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

class BrowserHandoffScreen extends StatefulWidget {
  const BrowserHandoffScreen({super.key, required this.wsUrl});
  final String wsUrl;

  @override
  State<BrowserHandoffScreen> createState() => _BrowserHandoffScreenState();
}

class _BrowserHandoffScreenState extends State<BrowserHandoffScreen> {
  late final WebViewController _web;

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0B0B0D));
    _loadPackagedViewer();
  }

  Future<void> _loadPackagedViewer() async {
    // This single-file ESM bundle is built from @novnc/novnc 1.5.0 and is
    // packaged with the app. The handoff view therefore consumes only the
    // short-lived gateway WebSocket ticket, never a third-party CDN at runtime.
    final viewerModule = await rootBundle.loadString('assets/novnc/rfb.mjs');
    if (!mounted) return;
    final escapedUrl = widget.wsUrl
        .replaceAll('\\', '\\\\')
        .replaceAll("'", "\\'")
        .replaceAll('\n', '')
        .replaceAll('\r', '');
    final viewerGlobal = viewerModule.replaceFirst(
      'export{ne as default};',
      'window.SuperchargeNoVNC={RFB:ne};',
    );
    await _web.loadHtmlString('''<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body,#screen{margin:0;width:100%;height:100%;background:#0b0b0d;color:#d8dde8;font-family:system-ui}#status{padding:14px;font-size:14px}canvas{width:100%!important;height:100%!important}</style></head>
<body><div id="status">Connecting secure browser handoff…</div><div id="screen"></div>
<script type="module">
$viewerGlobal
const RFB=window.SuperchargeNoVNC.RFB;
const status=document.getElementById('status');
const rfb=new RFB(document.getElementById('screen'),'$escapedUrl',{shared:true,credentials:{}});
rfb.scaleViewport=true; rfb.resizeSession=true;
rfb.addEventListener('connect',()=>status.remove());
rfb.addEventListener('disconnect',()=>status.textContent='Browser handoff ended. Return to the app.');
</script></body></html>''');
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFF0B0B0D),
        appBar: AppBar(
          title: const Text('Browser handoff'),
          backgroundColor: const Color(0xFF141518),
          foregroundColor: Colors.white,
        ),
        body: WebViewWidget(controller: _web),
      );
}
