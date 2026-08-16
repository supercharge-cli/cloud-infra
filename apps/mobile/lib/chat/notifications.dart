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

  static const _progressId = 7101;
  static const _doneId = 7102;
  static const _progressChannel = 'vectra_task_silent';
  static const _doneChannel = 'vectra_task_done';

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
        channelId: 'vectra_fg_task',
        channelName: 'Live task',
        channelDescription: 'Keeps a sandbox turn alive in the background',
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
      _activeId = instanceId;
      await init();
      await initForeground();
      await requestPermissions();
      if (Platform.isAndroid) {
        final running = await FlutterForegroundTask.isRunningService;
        if (!running) {
          await FlutterForegroundTask.startService(
            serviceId: 7100,
            serviceTypes: [ForegroundServiceTypes.dataSync],
            notificationTitle: '$name · working',
            notificationText: 'Starting…',
            callback: vectraFgCallback,
          );
        }
      }
      await updateProgress(
        instanceId: instanceId,
        name: name,
        elapsed: Duration.zero,
        tools: 0,
        pct: 8,
      );
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
    try {
    final label = 'Working · ${_fmt(elapsed)} · $tools tool${tools == 1 ? '' : 's'}';
    if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.updateService(
        notificationTitle: '$name · $pct%',
        notificationText: label,
      );
    }
    const android = AndroidNotificationDetails(
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
      onlyAlertOnce: true,
      icon: '@drawable/ic_stat_vectra',
    );
    await _plugin.show(
      _progressId,
      '$name · $pct%',
      label,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _progressChannel,
          'Task progress',
          channelDescription: android.channelDescription,
          importance: Importance.low,
          priority: Priority.low,
          playSound: false,
          enableVibration: false,
          ongoing: true,
          silent: true,
          showProgress: true,
          maxProgress: 100,
          progress: pct,
          onlyAlertOnce: true,
          icon: '@drawable/ic_stat_vectra',
        ),
      ),
      payload: instanceId,
    );
    } catch (_) {}
  }

  static Future<void> finishTurn({
    required String instanceId,
    required String name,
    String? body,
    bool error = false,
  }) async {
    try {
    await _plugin.cancel(_progressId);
    if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.stopService();
    }
    _activeId = null;
    await _plugin.show(
      _doneId,
      error ? '$name failed' : '$name finished',
      (body == null || body.trim().isEmpty) ? (error ? 'The turn ended with an error.' : 'Task finished.') : body.trim(),
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
    await _plugin.cancel(_progressId);
    if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
      await FlutterForegroundTask.stopService();
    }
    _activeId = null;
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