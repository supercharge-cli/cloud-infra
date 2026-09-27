import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/client.dart';
import '../chat/browser_handoff.dart';
import '../chat/browser_viewer_document.dart';
import '../chat/desktop_browser_viewer.dart';
import '../desktop.dart';
import '../desktop/native.dart';
import '../desktop/inline_browser.dart';

class BrowserHandoffScreen extends StatefulWidget {
  const BrowserHandoffScreen({
    super.key,
    required this.api,
    required this.instanceId,
    required this.onContinue,
  });

  final VectraClient api;
  final String instanceId;
  final Future<void> Function(String prompt) onContinue;

  @override
  State<BrowserHandoffScreen> createState() => _BrowserHandoffScreenState();
}

class _BrowserHandoffScreenState extends State<BrowserHandoffScreen> {
  late final BrowserHandoffController _control;
  final _notes = TextEditingController();
  final _viewerKey = GlobalKey();
  WebViewController? _web;
  DesktopBrowserViewer? _desktop;
  String? _module;
  String? _viewerError;
  bool _ready = false;
  bool _connected = false;
  bool _loading = false;
  bool _closing = false;
  bool _allowPop = false;
  bool _tearingDown = false;
  int _generation = 0;
  int _loadedGeneration = -1;
  int? _suspendingGeneration;
  Completer<void>? _suspended;

  @override
  void initState() {
    super.initState();
    _control = BrowserHandoffController(
      api: widget.api,
      instanceId: widget.instanceId,
      suspendViewer: _suspendViewer,
      continueChat: widget.onContinue,
    )..addListener(_controlChanged);
    if (!isDesktop) {
      _web = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(const Color(0xFF0B0B0D))
        ..addJavaScriptChannel(
          'BrowserViewer',
          onMessageReceived: _viewerMessage,
        );
    }
    unawaited(_initialize());
  }

  Map<String, Object?> _viewerState() => {
    'phase': _control.phase.name,
    'hasControl': _control.hasControl,
    'canContinue': _control.canContinue,
    'busy': _control.busy || _closing,
    'error': _control.error,
    'expiresAt': _control.expiresAt?.millisecondsSinceEpoch,
  };

  bool get _manual =>
      _control.phase == BrowserHandoffPhase.controlling &&
      _control.hasControl &&
      (_control.expiresAt?.isAfter(DateTime.now()) ?? false);

  Future<void> _initialize() async {
    try {
      final module = await rootBundle.loadString('assets/novnc/rfb.mjs');
      if (!mounted || _tearingDown || _closing) return;
      _module = module;
      if (isDesktop) {
        final viewer = await DesktopBrowserViewer.start(
          html: browserViewerDocument(desktop: true),
          viewerModule: module,
          requestVncUrl: () => widget.api.openAiBrowserVnc(widget.instanceId),
          readState: _viewerState,
          onAction: (action, notes) async {
            if (_closing || _tearingDown) return;
            switch (action) {
              case 'takeControl':
                await _control.takeControl();
              case 'returnControl':
                await _control.returnControl(notes: notes);
              case 'reconnect':
                await _reconnect();
            }
          },
          onConnectionChanged: (connected) {
            if (mounted && !_tearingDown) {
              setState(() => _connected = connected);
            }
          },
        );
        if (!mounted || _tearingDown || _closing) {
          await viewer.close();
          return;
        }
        _desktop = viewer;
        if (mounted) setState(() => _ready = true);
      } else {
        setState(() => _ready = true);
        await _loadNativeViewer();
      }
    } catch (error) {
      if (mounted && !_tearingDown) {
        setState(
          () => _viewerError = 'Could not open the browser viewer: $error',
        );
      }
    }
  }

  Future<void> _loadNativeViewer() async {
    if (_loading || _closing || _tearingDown || _control.busy) return;
    final generation = _generation;
    setState(() {
      _loading = true;
      _connected = false;
      _viewerError = null;
    });
    try {
      final wsUrl = await widget.api.openAiBrowserVnc(widget.instanceId);
      if (!mounted || _tearingDown || _closing || generation != _generation) {
        return;
      }
      _loadedGeneration = generation;
      await _web!.loadHtmlString(
        browserViewerDocument(
          desktop: false,
          viewerModule: _module!,
          wsUrl: wsUrl,
          controlling: _manual,
          expiresAt: _control.expiresAt?.millisecondsSinceEpoch,
          generation: generation,
        ),
        baseUrl: 'https://viewer.vectra.invalid/',
      );
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() => _viewerError = '$error');
      }
    } finally {
      if (mounted && !_tearingDown) setState(() => _loading = false);
    }
  }

  void _viewerMessage(JavaScriptMessage message) {
    try {
      final event = jsonDecode(message.message);
      if (event is! Map) return;
      if (event['kind'] == 'suspended' &&
          event['generation'] == _suspendingGeneration) {
        if (!(_suspended?.isCompleted ?? true)) _suspended!.complete();
        return;
      }
      if (!mounted || _tearingDown || event['generation'] != _generation) {
        return;
      }
      setState(() {
        switch (event['kind']) {
          case 'connected':
            _connected = true;
            _viewerError = null;
          case 'disconnected':
          case 'error':
            _connected = false;
            // The embedded viewer keeps its transport error visible in context.
            _viewerError = null;
        }
      });
    } catch (_) {}
  }

  void _controlChanged() {
    if (!mounted || _tearingDown) return;
    setState(() {});
    if (!isDesktop &&
        _ready &&
        !_control.busy &&
        !_closing &&
        _loadedGeneration != _generation) {
      unawaited(_loadNativeViewer());
    }
  }

  Future<void> _suspendViewer() async {
    _suspendingGeneration = _generation;
    _generation += 1;
    if (mounted && !_tearingDown) setState(() => _connected = false);
    if (isDesktop) {
      await _desktop?.suspend();
      return;
    }
    if (_loadedGeneration < 0 || _web == null) return;
    _suspended = Completer<void>();
    try {
      final started = await _web!
          .runJavaScriptReturningResult(
            'Boolean(window.SuperchargeBrowser && window.SuperchargeBrowser.suspend())',
          )
          .timeout(const Duration(seconds: 3));
      if (started == true || started == 'true') {
        await _suspended!.future.timeout(const Duration(seconds: 5));
      }
      await _web!.loadRequest(Uri.parse('about:blank'));
      _loadedGeneration = -1;
    } catch (_) {
      throw StateError(
        'Could not confirm that browser input stopped. The AI has not been resumed. Retry returning control.',
      );
    } finally {
      _suspended = null;
    }
  }

  Future<void> _reconnect() async {
    if (_control.busy || _closing || _tearingDown) return;
    try {
      await _suspendViewer();
      if (!isDesktop && mounted) await _loadNativeViewer();
    } catch (error) {
      if (mounted) setState(() => _viewerError = '$error');
    }
  }

  Future<void> _takeControl() async {
    await _control.takeControl();
  }

  Future<void> _returnControl() async {
    await _control.returnControl(notes: _notes.text.trim());
    if (!_control.hasControl && _control.error == null) _notes.clear();
  }

  Rect? _viewerBounds() {
    final object = _viewerKey.currentContext?.findRenderObject();
    if (object is! RenderBox || !object.hasSize) return null;
    return object.localToGlobal(Offset.zero) & object.size;
  }

  Future<void> _requestClose() async {
    if (_closing || _control.busy) return;
    var continueAi = false;
    if (_control.hasControl && _control.canContinue) {
      if (isDesktop) {
        await DesktopNative.inlineHide(DesktopNative.viewerSurface);
      }
      if (!mounted) return;
      final choice = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Finish using the browser?'),
          content: const Text(
            'Your browser input will be disconnected before control is returned. Continue in the same conversation, or leave the AI stopped.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Keep control'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, 'stop'),
              child: const Text('Leave AI stopped'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'continue'),
              child: const Text('Done & continue'),
            ),
          ],
        ),
      );
      if (choice == null || !mounted) {
        if (isDesktop && mounted && _desktop != null) {
          setState(() => _ready = true);
          await DesktopNative.inlineCommand(
            DesktopNative.viewerSurface,
            'reload',
          );
          final bounds = _viewerBounds();
          if (bounds != null && mounted) {
            final ratio = View.of(context).devicePixelRatio;
            await DesktopNative.inlineShow(
              DesktopNative.viewerSurface,
              bounds,
              ratio,
            );
          }
        }
        return;
      }
      continueAi = choice == 'continue';
    }
    setState(() => _closing = true);
    if (continueAi) await _control.returnControl(notes: _notes.text.trim());
    if (!_control.hasControl) await _control.close();
    if (_control.hasControl && !continueAi) await _control.close();
    if (!mounted) return;
    if (_control.hasControl || (continueAi && _control.error != null)) {
      setState(() => _closing = false);
      return;
    }
    await _desktop?.close();
    if (isDesktop) {
      await DesktopNative.inlineDispose(DesktopNative.viewerSurface);
    }
    if (!mounted) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  Future<void> _disposeViewer() async {
    await _control.close();
    await _desktop?.close();
    if (isDesktop) {
      await DesktopNative.inlineDispose(DesktopNative.viewerSurface);
    }
    _control.dispose();
  }

  @override
  void dispose() {
    _tearingDown = true;
    _control.removeListener(_controlChanged);
    _notes.dispose();
    unawaited(_disposeViewer());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final busy = _control.busy || _closing;
    final error = _control.error ?? _viewerError;
    return PopScope(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_requestClose());
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0B0B0D),
        appBar: AppBar(
          title: Text(
            _manual ? 'AI browser · your control' : 'AI browser · view only',
          ),
          backgroundColor: const Color(0xFF141518),
          foregroundColor: Colors.white,
          leading: IconButton(
            tooltip: 'Close browser viewer',
            onPressed: busy ? null : _requestClose,
            icon: const Icon(Icons.close),
          ),
          actions: [
            IconButton(
              tooltip: 'Reconnect browser viewer',
              onPressed: busy || !_ready ? null : _reconnect,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              if (busy) const LinearProgressIndicator(),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    error,
                    style: const TextStyle(color: Color(0xFFFFB1AE)),
                  ),
                ),
              Expanded(
                child: isDesktop
                    ? _desktop == null
                          ? const Center(child: CircularProgressIndicator())
                          : InlineBrowserView(
                              key: _viewerKey,
                              surface: DesktopNative.viewerSurface,
                              url: _desktop!.url.toString(),
                            )
                    : Stack(
                        children: [
                          WebViewWidget(controller: _web!),
                          if (!_ready || _loading)
                            const Center(child: CircularProgressIndicator()),
                        ],
                      ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _control.hasControl
                          ? 'Stay in this browser view. The AI will inspect its current state before continuing. Avoid running tasks from another client during control.'
                          : !_connected
                          ? 'Reconnect the browser viewer before taking control. The Computer preview may remain live if the VNC tunnel is unavailable.'
                          : 'Watching does not interrupt the AI. Take control stops its current task before enabling your input.',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.white70,
                      ),
                    ),
                    if (_control.hasControl) ...[
                      const SizedBox(height: 10),
                      TextField(
                        controller: _notes,
                        enabled: !busy,
                        maxLength: 4000,
                        minLines: 1,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          labelText: 'What did you change? (optional)',
                          hintText:
                              'Do not include passwords or other secrets.',
                          border: OutlineInputBorder(),
                          counterText: '',
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: busy || (!_control.hasControl && !_connected)
                          ? null
                          : _control.hasControl
                          ? _returnControl
                          : _takeControl,
                      icon: Icon(
                        _control.hasControl
                            ? Icons.play_arrow
                            : _connected
                            ? Icons.ads_click
                            : Icons.link_off,
                      ),
                      label: Text(
                        busy
                            ? _control.phase ==
                                      BrowserHandoffPhase.takingControl
                                  ? 'Stopping AI…'
                                  : 'Returning control…'
                            : _control.hasControl
                            ? _control.canContinue
                                  ? 'Done & continue'
                                  : 'Return control'
                            : _connected
                            ? 'Take control'
                            : 'Reconnect browser first',
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
