import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/client.dart';
import '../chat/browser_handoff.dart';
import '../chat/browser_viewer_document.dart';
import '../chat/desktop_browser_viewer.dart';
import '../chat/novnc_url.dart';
import '../desktop.dart';
import '../desktop/native.dart';
import '../desktop/inline_browser.dart';
import '../theme.dart';

class BrowserHandoffScreen extends StatefulWidget {
  const BrowserHandoffScreen({
    super.key,
    required this.api,
    required this.instanceId,
    required this.onContinue,
    this.botId,
    this.chatId,
  });

  final VectraClient api;
  final String instanceId;
  final Future<void> Function(String prompt) onContinue;
  final String? botId;
  final String? chatId;

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
  bool _loading = false;
  bool _closing = false;
  bool _allowPop = false;
  bool _tearingDown = false;
  bool _finishing = false;
  bool _inputPaused = false;
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
      botId: widget.botId,
      chatId: widget.chatId,
    )..addListener(_controlChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_initialize());
    });
  }

  Map<String, Object?> _viewerState() => {
    'phase': _control.phase.name,
    'hasControl': _control.hasControl,
    'canContinue': _control.canContinue,
    'busy': _control.busy || _closing,
    'inputPaused': _inputPaused,
    'error': _control.error ?? _viewerError,
    'expiresAt': _control.expiresAt?.millisecondsSinceEpoch,
  };

  bool get _manual =>
      _control.phase == BrowserHandoffPhase.controlling &&
      _control.hasControl &&
      (_control.expiresAt?.isAfter(DateTime.now()) ?? false);

  Future<void> _initialize() async {
    try {
      _module = await rootBundle.loadString('assets/novnc/rfb.mjs');
      if (!mounted || _tearingDown || _closing) return;
      await _control.takeControl();
      if (!mounted || !_manual || _tearingDown || _closing) return;
      if (isDesktop) {
        final viewer = await DesktopBrowserViewer.start(
          html: browserViewerDocument(desktop: true),
          viewerModule: _module!,
          requestVncUrl: () => widget.api.openAiBrowserVnc(
            widget.instanceId,
            handoffId: _control.handoffId!,
            botId: widget.botId,
          ),
          readState: _viewerState,
          onAction: (action, _) async {
            if (_closing || _tearingDown || _finishing) return;
            switch (action) {
              case 'returnControl':
                unawaited(_requestClose());
              case 'reconnect':
                await _reconnect();
            }
          },
        );
        if (!mounted || _tearingDown || _closing || !_manual) {
          await viewer.close();
          return;
        }
        setState(() {
          _desktop = viewer;
          _ready = true;
        });
      } else {
        _web = WebViewController()
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(Vc.bg)
          ..addJavaScriptChannel(
            'BrowserViewer',
            onMessageReceived: _viewerMessage,
          );
        setState(() => _ready = true);
        await _loadNativeViewer();
      }
    } catch (error) {
      if (mounted && !_tearingDown) {
        setState(() => _viewerError = 'Could not open desktop control: $error');
      }
    }
  }

  Future<void> _loadNativeViewer() async {
    if (_loading ||
        _closing ||
        _tearingDown ||
        _control.busy ||
        _inputPaused ||
        !_manual) {
      return;
    }
    final generation = _generation;
    setState(() {
      _loading = true;
      _viewerError = null;
    });
    try {
      final wsUrl = await widget.api.openAiBrowserVnc(
        widget.instanceId,
        handoffId: _control.handoffId!,
        botId: widget.botId,
      );
      if (!mounted ||
          _tearingDown ||
          _closing ||
          generation != _generation ||
          !_manual) {
        return;
      }
      _loadedGeneration = generation;
      await _web!.loadHtmlString(
        browserViewerDocument(
          desktop: false,
          viewerModule: _module!,
          wsUrl: wsUrl,
          controlling: true,
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
      switch (event['kind']) {
        case 'returnControl':
          unawaited(_requestClose());
        case 'reconnect':
          unawaited(_reconnect());
        case 'connected':
          setState(() => _viewerError = null);
      }
    } catch (_) {}
  }

  void _controlChanged() {
    if (!mounted || _tearingDown) return;
    setState(() {});
    if (!_control.hasControl &&
        _ready &&
        !_finishing &&
        !_closing &&
        !_control.busy) {
      unawaited(_exit());
    }
  }

  Future<void> _suspendViewer() async {
    _suspendingGeneration = _generation;
    _generation += 1;
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
        'Could not confirm that desktop input stopped. Control has not been returned. Retry.',
      );
    } finally {
      _suspended = null;
    }
  }

  Future<void> _reconnect() async {
    if (_control.busy || _closing || _tearingDown || _inputPaused || !_manual) {
      return;
    }
    try {
      await _suspendViewer();
      if (!isDesktop && mounted) await _loadNativeViewer();
    } catch (error) {
      if (mounted) setState(() => _viewerError = '$error');
    }
  }

  Rect? _viewerBounds() {
    final object = _viewerKey.currentContext?.findRenderObject();
    return object is RenderBox && object.hasSize
        ? object.localToGlobal(Offset.zero) & object.size
        : null;
  }

  Future<void> _resumeViewer() async {
    if (!mounted || !_manual || _closing) return;
    setState(() => _inputPaused = false);
    if (!isDesktop) {
      await _loadNativeViewer();
      return;
    }
    final bounds = _viewerBounds();
    if (bounds != null) {
      await DesktopNative.inlineShow(
        DesktopNative.viewerSurface,
        bounds,
        View.of(context).devicePixelRatio,
      );
    }
  }

  Future<void> _requestClose() async {
    if (_closing || _control.busy || _finishing || _tearingDown) return;
    if (!_control.hasControl) {
      await _exit();
      return;
    }
    _finishing = true;
    setState(() => _inputPaused = true);
    try {
      await _suspendViewer();
      if (isDesktop && _desktop != null) {
        await DesktopNative.inlineHide(DesktopNative.viewerSurface);
      }
      if (!mounted) return;
      final choice = await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Return control?'),
          content: SizedBox(
            width: 400,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'What did you change? (optional)',
                  style: TextStyle(fontSize: 14),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const ValueKey('handoff-notes'),
                  controller: _notes,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 4000,
                  decoration: const InputDecoration(
                    hintText: 'For example: signed in and opened the project.',
                    helperText: 'Do not include passwords or codes.',
                    counterText: '',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Keep control'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, 'stop'),
              child: const Text('Exit without resuming'),
            ),
            if (_control.canContinue)
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, 'continue'),
                child: const Text('Return & continue'),
              ),
          ],
        ),
      );
      if (!mounted) return;
      if (choice == null) {
        if (_control.hasControl) {
          await _resumeViewer();
        } else {
          await _exit();
        }
        return;
      }
      await _control.returnControl(
        notes: _notes.text.trim(),
        continueTask: choice == 'continue',
      );
      if (!mounted) return;
      if (_control.hasControl) {
        if (isDesktop && _desktop != null) {
          final bounds = _viewerBounds();
          if (bounds != null) {
            await DesktopNative.inlineShow(
              DesktopNative.viewerSurface,
              bounds,
              View.of(context).devicePixelRatio,
            );
          }
        }
        setState(() => _inputPaused = true);
        return;
      }
      await _exit();
    } catch (error) {
      if (mounted) setState(() => _viewerError = '$error');
    } finally {
      _finishing = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _exit() async {
    if (_closing || _tearingDown) return;
    final priorError = _control.error;
    setState(() => _closing = true);
    await _control.close();
    if (_control.hasControl) {
      if (mounted) setState(() => _closing = false);
      return;
    }
    final error = _control.error ?? priorError;
    await _desktop?.close();
    if (isDesktop && _desktop != null) {
      await DesktopNative.inlineDispose(DesktopNative.viewerSurface);
    }
    if (!mounted) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop(error);
    });
  }

  Future<void> _disposeViewer() async {
    await _control.close();
    await _desktop?.close();
    if (isDesktop && _desktop != null) {
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
    final hasViewer = _ready && (isDesktop ? _desktop != null : _web != null);
    return PopScope(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_requestClose());
      },
      child: Scaffold(
        backgroundColor: Vc.bg,
        body: SafeArea(
          child: Stack(
            children: [
              if (hasViewer)
                Positioned.fill(
                  child: isDesktop
                      ? InlineBrowserView(
                          key: _viewerKey,
                          surface: DesktopNative.viewerSurface,
                          active: !_finishing && _manual && error == null,
                          url: embeddedNoVncUrl(
                            _desktop!.url,
                            websocketUrl: 'vnc',
                            controlling: true,
                          ).toString(),
                        )
                      : WebViewWidget(controller: _web!),
                ),
              if (!hasViewer || (error != null && !_finishing) || _loading)
                Positioned.fill(
                  child: ColoredBox(
                    color: Vc.bg,
                    child: Column(
                      children: [
                        Expanded(
                          child: Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (busy ||
                                      _loading ||
                                      (error == null && !_ready))
                                    const SizedBox(
                                      width: 26,
                                      height: 26,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    ),
                                  const SizedBox(height: 16),
                                  Text(
                                    error ?? 'Taking over desktop…',
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Vc.muted),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        SizedBox(
                          height: 46,
                          child: Row(
                            children: [
                              const SizedBox(width: 12),
                              const Expanded(
                                child: Text(
                                  'Desktop control',
                                  style: TextStyle(
                                    color: Vc.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                              TextButton(
                                onPressed: busy ? null : _requestClose,
                                child: Text(
                                  _control.hasControl
                                      ? 'Return control'
                                      : 'Back to viewing',
                                ),
                              ),
                              const SizedBox(width: 6),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
