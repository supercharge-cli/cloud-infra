import 'dart:async';

import 'package:flutter/material.dart';

import '../theme.dart';
import 'native.dart';

class InlineBrowserView extends StatefulWidget {
  const InlineBrowserView({
    super.key,
    required this.surface,
    required this.url,
    this.active = true,
  });

  final String surface;
  final String url;
  final bool active;

  @override
  State<InlineBrowserView> createState() => _InlineBrowserViewState();
}

class _InlineBrowserViewState extends State<InlineBrowserView>
    with WidgetsBindingObserver {
  Rect? _lastBounds;
  double? _lastRatio;
  String? _loadedUrl;
  bool _visible = false;
  bool _disposed = false;
  bool _positionScheduled = false;
  bool _obscured = false;
  bool _updatePending = false;
  Rect? _shownBounds;
  double? _shownRatio;
  Future<void> _pending = Future<void>.value();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _schedulePosition();
  }

  @override
  void didUpdateWidget(covariant InlineBrowserView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.surface != widget.surface ||
        oldWidget.url != widget.url ||
        oldWidget.active != widget.active) {
      if (oldWidget.surface != widget.surface) {
        unawaited(DesktopNative.inlineDispose(oldWidget.surface));
        _loadedUrl = null;
      }
      _lastBounds = null;
      _schedulePosition();
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _lastBounds = null;
    _schedulePosition();
  }

  @override
  void didChangeMetrics() {
    _lastBounds = null;
    _schedulePosition();
  }

  void _schedulePosition() {
    if (_positionScheduled) return;
    _positionScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _positionScheduled = false;
      if (!mounted || _disposed) return;
      final object = context.findRenderObject();
      if (object is! RenderBox || !object.hasSize) return;
      final origin = object.localToGlobal(Offset.zero);
      final size = object.size;
      final screen = MediaQuery.sizeOf(context);
      final left = origin.dx.clamp(0.0, screen.width);
      final top = origin.dy.clamp(0.0, screen.height);
      final bounds = Rect.fromLTRB(
        left,
        top,
        (origin.dx + size.width).clamp(left, screen.width),
        (origin.dy + size.height).clamp(top, screen.height),
      );
      final ratio = View.of(context).devicePixelRatio;
      final route = ModalRoute.of(context);
      final obscured = route != null && !route.isCurrent;
      final active =
          widget.active && !obscured && bounds.width > 1 && bounds.height > 1;
      if (_obscured != obscured) {
        _obscured = obscured;
        if (!obscured) _lastBounds = null;
      }
      final surface = widget.surface;
      final url = widget.url;
      if (!active) {
        if (_visible) {
          _visible = false;
          _shownBounds = null;
          _shownRatio = null;
          _pending = _pending
              .then((_) => DesktopNative.inlineHide(surface))
              .catchError((Object _) {});
        }
        return;
      }
      if (_visible &&
          bounds == _shownBounds &&
          ratio == _shownRatio &&
          url == _loadedUrl) {
        return;
      }
      _lastBounds = bounds;
      _lastRatio = ratio;
      _visible = true;
      if (_updatePending) return;
      _updatePending = true;
      _pending = _pending
          .then((_) async {
            if (_disposed || !mounted || !widget.active) return;
            if (_loadedUrl != url) {
              await DesktopNative.inlineLoad(surface, url);
              _loadedUrl = url;
            }
            if (!_disposed && mounted && widget.active && _visible) {
              final nextBounds = _lastBounds ?? bounds;
              final nextRatio = _lastRatio ?? ratio;
              await DesktopNative.inlineShow(surface, nextBounds, nextRatio);
              _shownBounds = nextBounds;
              _shownRatio = nextRatio;
            }
          })
          .catchError((Object error) {
            debugPrint('Inline browser unavailable: $error');
            _loadedUrl = null;
          })
          .whenComplete(() {
            _updatePending = false;
            if (mounted && !_disposed && widget.active) _schedulePosition();
          });
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _disposed = true;
    final surface = widget.surface;
    unawaited(
      _pending
          .then((_) => DesktopNative.inlineDispose(surface))
          .catchError((Object _) {}),
    );
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _schedulePosition();
    return ColoredBox(
      color: Vc.bg,
      child: Center(
        child: Text(
          'Loading browser in Vectra…',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}
