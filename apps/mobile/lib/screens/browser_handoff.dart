import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

class BrowserHandoffScreen extends StatefulWidget {
  const BrowserHandoffScreen({
    super.key,
    required this.wsUrl,
    this.viewOnly = true,
    this.onTakeOver,
  });
  final String wsUrl;
  final bool viewOnly;
  final Future<void> Function()? onTakeOver;

  @override
  State<BrowserHandoffScreen> createState() => _BrowserHandoffScreenState();
}

class _BrowserHandoffScreenState extends State<BrowserHandoffScreen> {
  late final WebViewController _web;
  late bool viewOnly;
  bool taking = false;

  @override
  void initState() {
    super.initState();
    viewOnly = widget.viewOnly;
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0B0B0D));
    _loadPackagedViewer();
  }

  Future<void> _loadPackagedViewer() async {
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
    final only = viewOnly ? 'true' : 'false';
    await _web.loadHtmlString('''<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body,#screen{margin:0;width:100%;height:100%;background:#0b0b0d;color:#d8dde8;font-family:system-ui}#status{padding:14px;font-size:14px}canvas{width:100%!important;height:100%!important}</style></head>
<body><div id="status">Connecting to the AI browser (Playwright display)…</div><div id="screen"></div>
<script type="module">
$viewerGlobal
const RFB=window.SuperchargeNoVNC.RFB;
const status=document.getElementById('status');
const rfb=new RFB(document.getElementById('screen'),'$escapedUrl',{shared:true,credentials:{}});
window.__rfb=rfb;
rfb.scaleViewport=true;
rfb.resizeSession=true;
rfb.viewOnly=$only;
rfb.addEventListener('connect',()=>status.remove());
rfb.addEventListener('disconnect',()=>status.textContent='AI browser view ended.');
</script></body></html>''');
  }

  Future<void> _takeOver() async {
    if (taking || !viewOnly) return;
    setState(() => taking = true);
    try {
      await widget.onTakeOver?.call();
      await _web.runJavaScript('if(window.__rfb)window.__rfb.viewOnly=false;');
      if (mounted) setState(() => viewOnly = false);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => taking = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFF0B0B0D),
        appBar: AppBar(
          title: Text(viewOnly ? 'AI browser · view only' : 'AI browser · you have control'),
          backgroundColor: const Color(0xFF141518),
          foregroundColor: Colors.white,
          actions: [
            if (viewOnly && widget.onTakeOver != null)
              TextButton(
                onPressed: taking ? null : _takeOver,
                child: Text(taking ? 'Starting…' : 'Take over', style: const TextStyle(color: Colors.white)),
              ),
          ],
        ),
        body: WebViewWidget(controller: _web),
      );
}
