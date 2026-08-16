import 'dart:io';

import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

typedef OpenChatCallback = void Function(String instanceId);

class TaskNotifications {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static OpenChatCallback? onOpenChat;
  static bool _ready = false;
  static bool _fgReady = false;
  static String? _activeId;
  static int _turnGen = 0;
  static bool _backgrounded = false;
  static String _name = 'Chat';
  static Duration _elapsed = Duration.zero;
  static int _tools = 0;
  static int _pct = 8;

  static const _progressId = 7101;
  static const _doneId = 7102;
  static const _progressChannel = 'vectra_task_silent';
  static const _doneChannel = 'vectra_task_done';

  static String get _label =>
      'Working · ${_fmt(_elapsed)} · $_tools tool${_tools == 1 ? '' : 's'}';

  static Future<void> init() async {
    if (_ready) return;
    try {
      const android = AndroidInitializationSettings('@drawable/ic_stat_vectra');
      const ios = DarwinInitializationSettings();
      await _plugin.initialize(
        const InitializationSettings(android: android, iOS: ios),
        onDidReceiveNotificationResponse: (res) {
          final id = res.payload;
          if (id != null && id.isNotEmpty) onOpenChat?.call(id);
        },
      );
      final androidPlugin = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.requestNotificationsPermission();
      _ready = true;
    } catch (_) {}
  }

  static Future<void> initForeground() async {
    if (_fgReady) return;
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: _progressChannel,
        channelName: 'Task progress',
        channelDescription: 'Silent live progress for the current sandbox turn',
        channelImportance: NotificationChannelImportance.LOW,
        priority: NotificationPriority.LOW,
        playSound: false,
        enableVibration: false,
        showWhen: false,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.repeat(15000),
        autoRunOnBoot: false,
        autoRunOnMyPackageReplaced: false,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
    _fgReady = true;
  }

  static int softPercent({required int tools, required Duration elapsed}) {
    final n = 8 + (tools * 12) + (elapsed.inSeconds ~/ 8);
    if (n < 8) return 8;
    if (n > 95) return 95;
    return n;
  }

  static Future<void> requestPermissions() async {
    try {
      await init();
      if (Platform.isAndroid) {
        await FlutterForegroundTask.checkNotificationPermission();
        await FlutterForegroundTask.requestNotificationPermission();
      }
    } catch (_) {}
  }

  static Future<void> startTurn({
    required String instanceId,
    required String name,
  }) async {
    try {
      _turnGen += 1;
      _activeId = instanceId;
      _name = name;
      _elapsed = Duration.zero;
      _tools = 0;
      _pct = 8;
      _backgrounded = false;
      await init();
      await requestPermissions();
      // One live notification only: the progress bar. The Android
      // foreground service is started later if the app is backgrounded.
      await _plugin.cancel(_progressId);
      if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
      await _showProgressBar();
    } catch (_) {}
  }

  static Future<void> updateProgress({
    required String instanceId,
    required String name,
    required Duration elapsed,
    required int tools,
    required int pct,
  }) async {
    if (_activeId != instanceId) return;
    _name = name;
    _elapsed = elapsed;
    _tools = tools;
    _pct = pct;
    final gen = _turnGen;
    try {
      if (_backgrounded && Platform.isAndroid) {
        await _ensureForegroundService();
        if (_activeId != instanceId || _turnGen != gen) return;
        return;
      }
      await _showProgressBar();
    } catch (_) {}
  }

  /// Keep the process alive in the background with a single notification.
  /// Replaces the progress-bar tile so Android does not show two.
  static Future<void> enterBackground() async {
    if (_activeId == null) return;
    _backgrounded = true;
    if (!Platform.isAndroid) return;
    try {
      await _plugin.cancel(_progressId);
      await _ensureForegroundService();
    } catch (_) {}
  }

  static Future<void> leaveBackground() async {
    _backgrounded = false;
    try {
      if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
      if (_activeId != null) await _showProgressBar();
    } catch (_) {}
  }

  static Future<void> _ensureForegroundService() async {
    await initForeground();
    final title = '$_name · $_pct%';
    final running = await FlutterForegroundTask.isRunningService;
    if (!running) {
      await FlutterForegroundTask.startService(
        serviceId: _progressId,
        serviceTypes: [ForegroundServiceTypes.dataSync],
        notificationTitle: title,
        notificationText: _label,
        callback: vectraFgCallback,
      );
    } else {
      await FlutterForegroundTask.updateService(
        notificationTitle: title,
        notificationText: _label,
      );
    }
  }

  static Future<void> _showProgressBar() async {
    if (_activeId == null) return;
    final gen = _turnGen;
    await init();
    if (_activeId == null || _turnGen != gen) return;
    await _plugin.show(
      _progressId,
      '$_name · $_pct%',
      _label,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _progressChannel,
          'Task progress',
          channelDescription: 'Silent live progress for the current sandbox turn',
          importance: Importance.low,
          priority: Priority.low,
          playSound: false,
          enableVibration: false,
          ongoing: true,
          silent: true,
          showProgress: true,
          maxProgress: 100,
          progress: _pct,
          onlyAlertOnce: true,
          icon: '@drawable/ic_stat_vectra',
        ),
      ),
      payload: _activeId,
    );
  }

  static Future<void> finishTurn({
    required String instanceId,
    required String name,
    String? body,
    bool error = false,
  }) async {
    try {
      _activeId = null;
      _turnGen += 1;
      _backgrounded = false;
      await _plugin.cancel(_progressId);
      if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
      await _plugin.show(
        _doneId,
        error ? '$name failed' : '$name finished',
        (body == null || body.trim().isEmpty)
            ? (error ? 'The turn ended with an error.' : 'Task finished.')
            : body.trim(),
        NotificationDetails(
          android: AndroidNotificationDetails(
            _doneChannel,
            'Task complete',
            channelDescription: 'Fires once when a sandbox turn finishes',
            importance: Importance.defaultImportance,
            priority: Priority.defaultPriority,
            icon: '@drawable/ic_stat_vectra',
          ),
          iOS: const DarwinNotificationDetails(),
        ),
        payload: instanceId,
      );
    } catch (_) {}
  }

  static Future<void> cancelSilent() async {
    try {
      _activeId = null;
      _turnGen += 1;
      _backgrounded = false;
      await _plugin.cancel(_progressId);
      if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
    } catch (_) {
      _activeId = null;
    }
  }

  static String _fmt(Duration d) {
    final m = d.inMinutes;
    final s = d.inSeconds % 60;
    if (m <= 0) return '${s}s';
    return '${m}m ${s.toString().padLeft(2, '0')}s';
  }
}

@pragma('vm:entry-point')
void vectraFgCallback() {
  FlutterForegroundTask.setTaskHandler(_VectraTaskHandler());
}

class _VectraTaskHandler extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}
}
