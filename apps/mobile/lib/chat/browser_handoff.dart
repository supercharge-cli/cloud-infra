import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/client.dart';

enum BrowserHandoffPhase {
  watching,
  takingControl,
  controlling,
  returningControl,
}

/// Owns this viewer's handoff, not a sandbox-wide or cross-client lock.
/// Only [BrowserHandoffPhase.controlling] with an unexpired lease permits input.
/// Call and await [close] before disposing the viewer/controller.
class BrowserHandoffController extends ChangeNotifier {
  BrowserHandoffController({
    required VectraClient api,
    required String instanceId,
    required Future<void> Function() suspendViewer,
    required Future<void> Function(String prompt) continueChat,
    Duration pollInterval = const Duration(milliseconds: 250),
    Duration pollTimeout = const Duration(seconds: 12),
    DateTime Function()? now,
  }) : _api = api,
       _instanceId = instanceId,
       _suspendViewer = suspendViewer,
       _continueChat = continueChat,
       _pollInterval = pollInterval,
       _pollTimeout = pollTimeout > const Duration(seconds: 15)
           ? const Duration(seconds: 15)
           : pollTimeout,
       _now = now ?? DateTime.now {
    if (pollInterval < Duration.zero || pollTimeout <= Duration.zero) {
      throw ArgumentError(
        'Polling interval must be nonnegative and timeout positive.',
      );
    }
  }

  final VectraClient _api;
  final String _instanceId;
  final Future<void> Function() _suspendViewer;
  final Future<void> Function(String prompt) _continueChat;
  final Duration _pollInterval;
  final Duration _pollTimeout;
  final DateTime Function() _now;

  BrowserHandoffPhase _phase = BrowserHandoffPhase.watching;
  bool _hasControl = false;
  bool _wasBusy = false;
  bool _mayContinue = false;
  bool _expired = false;
  bool _closeRequested = false;
  bool _disposed = false;
  String? _error;
  DateTime? _expiresAt;
  Timer? _expiryTimer;
  Future<void> _pending = Future<void>.value();

  static const _expiredMessage =
      'Browser control expired. Input is disabled; the AI was not automatically resumed.';

  BrowserHandoffPhase get phase => _phase;
  bool get busy =>
      _phase == BrowserHandoffPhase.takingControl ||
      _phase == BrowserHandoffPhase.returningControl;

  /// Remote ownership can outlive a failed verification or release. This alone
  /// must never be used to enable input.
  bool get hasControl => _hasControl;
  bool get canContinue =>
      _hasControl && _mayContinue && !_expired && !_closeRequested;
  String? get error => _error;
  DateTime? get expiresAt => _expiresAt;

  Future<void> takeControl() => _enqueue(_takeControl);

  Future<void> returnControl({String notes = ''}) =>
      _enqueue(() => _release(continueTask: canContinue, notes: notes));

  /// Prevents any queued takeover/continuation, but permits release retries.
  /// Closing a watcher never stops the AI or releases another viewer's handoff.
  Future<void> close() {
    _closeRequested = true;
    _mayContinue = false;
    if (_phase == BrowserHandoffPhase.controlling) {
      _phase = BrowserHandoffPhase.returningControl;
      _notify();
    }
    return _enqueue(() => _release(continueTask: false, suspendUnowned: true));
  }

  Future<void> _enqueue(Future<void> Function() operation) {
    final next = _pending.then((_) async {
      if (_disposed) return;
      try {
        await operation();
      } catch (failure) {
        // Keep the queue usable even if a viewer callback unexpectedly fails.
        _error = failure.toString();
        _phase = BrowserHandoffPhase.watching;
        _notify();
      }
    });
    _pending = next;
    return next;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> _takeControl() async {
    if (_closeRequested || _hasControl) return;
    _error = null;
    _expired = false;
    _mayContinue = false;
    _phase = BrowserHandoffPhase.takingControl;
    _notify();
    var foregroundStopped = false;
    try {
      // Revoke old watch connections before checking or changing remote state.
      await _suspendViewer();
      if (_closeRequested) return;
      final computer = await _api.computerStatus(_instanceId);
      if (computer['handoff'] != false) {
        throw StateError(
          computer['handoff'] == true
              ? 'Another viewer already has browser control.'
              : 'Could not confirm that browser control is available.',
        );
      }
      _wasBusy = await _readBusy(timeout: _pollTimeout);
      if (_closeRequested) return;
      // Always drain matching foreground work, even if the status looked idle.
      await _api.stopChat(_instanceId);
      foregroundStopped = true;
      if (_closeRequested) return;
      await _waitUntilIdle();
      if (_closeRequested) return;
      final expiry = await _api.startBrowserHandoff(_instanceId);
      // Record ownership immediately: later checks must not hide a live lease.
      _hasControl = true;
      _expiresAt = expiry;
      _scheduleExpiry();
      if (_closeRequested) return;
      if (await _readBusy(timeout: _pollTimeout)) {
        throw StateError(
          'The AI is still working. Browser input remains disabled.',
        );
      }
      if (_closeRequested) return;
      if (_expired || !expiry.isAfter(_now())) {
        _expired = true;
        throw StateError(_expiredMessage);
      }
      _mayContinue = true;
      _phase = BrowserHandoffPhase.controlling;
    } catch (failure) {
      final stoppedWithoutControl = foregroundStopped && !_hasControl;
      _error = _expired
          ? _expiredMessage
          : '${failure.toString()}${stoppedWithoutControl ? ' The AI remains stopped; send a message to continue.' : ''}';
    } finally {
      if (_phase == BrowserHandoffPhase.takingControl) {
        _phase = BrowserHandoffPhase.watching;
      }
      _notify();
    }
  }

  Future<bool> _readBusy({required Duration timeout}) async {
    final status = await _api.chatStatus(_instanceId).timeout(timeout);
    final turn = status['turn'];
    if (turn is! Map || turn['busy'] is! bool) {
      throw StateError(
        'Could not read the AI turn state. Browser input remains disabled.',
      );
    }
    final tasks = status['backgroundTasks'];
    if (tasks != null && tasks is! List) {
      throw StateError(
        'Could not read background tasks. Browser input remains disabled.',
      );
    }
    if (tasks is List && tasks.isNotEmpty) {
      throw StateError(
        'Background tasks are active. Stop them before taking browser control.',
      );
    }
    return turn['busy'] as bool;
  }

  Future<void> _waitUntilIdle() async {
    final deadline = _now().add(_pollTimeout);
    while (!_closeRequested) {
      final remaining = deadline.difference(_now());
      if (remaining <= Duration.zero) {
        throw TimeoutException('The AI did not become idle in time.');
      }
      if (!await _readBusy(timeout: remaining)) return;
      final afterRead = deadline.difference(_now());
      if (afterRead <= Duration.zero) {
        throw TimeoutException('The AI did not become idle in time.');
      }
      await Future<void>.delayed(
        _pollInterval < afterRead ? _pollInterval : afterRead,
      );
    }
  }

  void _scheduleExpiry() {
    _expiryTimer?.cancel();
    final expiry = _expiresAt!;
    final remaining = expiry.difference(_now());
    _expiryTimer = Timer(
      remaining > Duration.zero ? remaining : Duration.zero,
      () {
        if (_disposed || !_hasControl || _expiresAt != expiry) return;
        _expired = true;
        _mayContinue = false;
        _error = _expiredMessage;
        // Revoke the UI permission immediately, even if another operation awaits IO.
        _phase = BrowserHandoffPhase.returningControl;
        _notify();
        unawaited(_enqueue(() => _release(continueTask: false)));
      },
    );
  }

  Future<void> _release({
    required bool continueTask,
    String notes = '',
    bool suspendUnowned = false,
  }) async {
    if (!_hasControl && !suspendUnowned) return;
    _phase = BrowserHandoffPhase.returningControl;
    _error = _expired ? _expiredMessage : null;
    _notify();
    try {
      // Never let the agent resume while an old interactive socket survives.
      await _suspendViewer();
      if (!_hasControl) return;
      if (_expiresAt?.isAfter(_now()) != true) {
        _expired = true;
        _mayContinue = false;
      }
      await _api.stopBrowserHandoff(_instanceId);
      final shouldContinue =
          continueTask && _mayContinue && !_expired && !_closeRequested;
      _hasControl = false;
      _expiresAt = null;
      _expiryTimer?.cancel();
      _expiryTimer = null;
      // Clear eligibility before sending: a failing continuation is never replayed.
      _mayContinue = false;
      _error = _expired ? _expiredMessage : null;
      _notify();
      if (shouldContinue) {
        try {
          await _continueChat(_continuationPrompt(notes));
        } catch (failure) {
          _error =
              'Browser control was returned, but continuing failed: $failure. '
              'It will not be retried automatically.';
        }
      }
    } catch (failure) {
      _error =
          '${_expired ? '$_expiredMessage ' : ''}'
          'Could not safely return browser control: $failure. Retry returning control.';
      // Preserve the lease so Return/Close can retry; input stays disabled.
    } finally {
      _phase = BrowserHandoffPhase.watching;
      _notify();
    }
  }

  String _continuationPrompt(String notes) {
    final userNotes = notes.trim();
    return 'Manual browser work is complete and control has been returned. '
        '${_wasBusy ? 'The running task was interrupted for this manual step. ' : ''}'
        'Continue the original task in the SAME browser session and SAME active browser tab. '
        'First take a fresh screenshot and inspect the current page and browser state to '
        'understand the user\'s manual changes. Do not assume the page is unchanged or '
        'automatically replay the manual actions. Preserve login and session changes; '
        'do not request, repeat, or expose passwords, one-time codes, or other secrets.'
        '${userNotes.isEmpty ? '' : '\n\nUser notes about the manual changes:\n$userNotes'}';
  }

  @override
  void dispose() {
    _disposed = true;
    _closeRequested = true;
    _mayContinue = false;
    _expiryTimer?.cancel();
    super.dispose();
  }
}
