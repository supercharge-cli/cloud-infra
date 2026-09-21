import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../desktop.dart';
import 'event_stream.dart';

typedef OpenChatCallback = void Function(String instanceId);

class TaskNotifications {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static OpenChatCallback? onOpenChat;
  static bool _ready = false;
  static bool _fgReady = false;
  static String? _activeId;
  static String _name = 'Chat';
  static Duration _elapsed = Duration.zero;
  static int _tools = 0;
  static int _pct = 8;

  static const progressId = 7101;
  static const doneId = 7102;
  static const cliUpdateId = 7103;
  static const permissionId = 7104;
  static const progressChannel = 'vectra_task_progress';
  static const doneChannel = 'vectra_task_done';
  static const cliUpdateChannel = 'vectra_cli_update';
  static const permissionChannel = 'vectra_permission';

  static String get _label =>
      'Working · ${_fmt(_elapsed)} · $_tools tool${_tools == 1 ? '' : 's'}';

  static Future<void> init() async {
    if (_ready || isDesktop) return;
    try {
      const android = AndroidInitializationSettings('@drawable/ic_stat_vectra');
      const ios = DarwinInitializationSettings();
      await _plugin.initialize(
        settings: const InitializationSettings(android: android, iOS: ios),
        onDidReceiveNotificationResponse: (res) {
          final id = res.payload;
          if (id != null && id.isNotEmpty) onOpenChat?.call(id);
        },
      );
      final androidPlugin = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      await androidPlugin?.requestNotificationsPermission();
      _ready = true;
    } catch (_) {}
  }

  static Future<void> initForeground() async {
    if (_fgReady || isDesktop) return;
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: progressChannel,
        channelName: 'Task progress',
        channelDescription: 'Live sandbox turn progress with percent bar',
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
        eventAction: ForegroundTaskEventAction.repeat(5000),
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
    required String apiBase,
    String? token,
    String? since,
  }) async {
    try {
      _activeId = instanceId;
      _name = name;
      _elapsed = Duration.zero;
      _tools = 0;
      _pct = 8;
      await init();
      await requestPermissions();
      await FlutterForegroundTask.saveData(key: 'apiBase', value: apiBase);
      await FlutterForegroundTask.saveData(key: 'token', value: token ?? '');
      await FlutterForegroundTask.saveData(
        key: 'instanceId',
        value: instanceId,
      );
      await FlutterForegroundTask.saveData(key: 'name', value: name);
      await FlutterForegroundTask.saveData(key: 'since', value: since ?? '');
      await FlutterForegroundTask.saveData(
        key: 'startedMs',
        value: DateTime.now().millisecondsSinceEpoch,
      );
      await FlutterForegroundTask.saveData(key: 'tools', value: 0);
      if (Platform.isAndroid) {
        await initForeground();
        final running = await FlutterForegroundTask.isRunningService;
        if (!running) {
          await FlutterForegroundTask.startService(
            serviceId: progressId,
            serviceTypes: [ForegroundServiceTypes.dataSync],
            notificationTitle: '$name · 8%',
            notificationText: _label,
            callback: vectraFgCallback,
          );
        }
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
    try {
      await FlutterForegroundTask.saveData(key: 'tools', value: tools);
      await _showProgressBar();
    } catch (_) {}
  }

  static Future<void> enterBackground() async {
    if (_activeId == null || !Platform.isAndroid) return;
    try {
      await initForeground();
      if (!await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.startService(
          serviceId: progressId,
          serviceTypes: [ForegroundServiceTypes.dataSync],
          notificationTitle: '$_name · $_pct%',
          notificationText: _label,
          callback: vectraFgCallback,
        );
      }
      await _showProgressBar();
    } catch (_) {}
  }

  static Future<void> leaveBackground() async {}

  static Future<void> _showProgressBar() async {
    if (_activeId == null) return;
    await init();
    if (_activeId == null) return;
    await showProgressNotification(
      plugin: _plugin,
      instanceId: _activeId!,
      name: _name,
      pct: _pct,
      label: _label,
    );
  }

  static Future<void> showProgressNotification({
    required FlutterLocalNotificationsPlugin plugin,
    required String instanceId,
    required String name,
    required int pct,
    required String label,
  }) async {
    await plugin.show(
      id: progressId,
      title: '$name · $pct%',
      body: label,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          progressChannel,
          'Task progress',
          channelDescription: 'Live sandbox turn progress with percent bar',
          importance: Importance.low,
          priority: Priority.low,
          playSound: false,
          enableVibration: false,
          ongoing: true,
          silent: true,
          showProgress: true,
          maxProgress: 100,
          progress: pct.clamp(0, 100),
          indeterminate: false,
          onlyAlertOnce: true,
          icon: '@drawable/ic_stat_vectra',
          category: AndroidNotificationCategory.progress,
        ),
      ),
      payload: instanceId,
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
      await _plugin.cancel(id: progressId);
      if (Platform.isAndroid && await FlutterForegroundTask.isRunningService) {
        await FlutterForegroundTask.stopService();
      }
      await showDone(
        instanceId: instanceId,
        name: name,
        body: body,
        error: error,
      );
    } catch (_) {}
  }

  static Future<void> showDone({
    required String instanceId,
    required String name,
    String? body,
    bool error = false,
  }) async {
    await init();
    final snippet = (body == null || body.trim().isEmpty)
        ? (error ? 'The turn ended with an error.' : 'Task finished.')
        : body.trim();
    await _plugin.show(
      id: doneId,
      title: error ? '$name failed' : '$name finished',
      body: snippet,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          doneChannel,
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
  }

  static Future<void> showPermissionNeed({
    required String instanceId,
    required String name,
    required String body,
    String kind = 'approve',
  }) async {
    await init();
    final snippet = body.trim().isEmpty
        ? (kind == 'ask'
              ? 'The agent needs an answer.'
              : 'The agent needs approval.')
        : body.trim();
    await _plugin.show(
      id: permissionId,
      title: kind == 'ask' ? '$name needs an answer' : '$name needs approval',
      body: snippet.length > 180 ? '${snippet.substring(0, 177)}…' : snippet,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          permissionChannel,
          'Approvals',
          channelDescription:
              'Heads-up when the agent asks for permission or a choice',
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
          enableVibration: true,
          silent: false,
          icon: '@drawable/ic_stat_vectra',
          category: AndroidNotificationCategory.alarm,
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentSound: true,
          presentBadge: true,
        ),
      ),
      payload: instanceId,
    );
  }

  static Future<void> showCliUpdate({
    required String instanceId,
    required String name,
    required String current,
    required String latest,
    String product = 'CLI',
  }) async {
    await init();
    await _plugin.show(
      id: cliUpdateId,
      title: '$product $latest is out',
      body:
          '$name is on ${current.isEmpty ? 'an older CLI' : current}. Tap to open chat and update.',
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          cliUpdateChannel,
          'CLI updates',
          channelDescription: 'When a new XibeCode CLI is published',
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
          icon: '@drawable/ic_stat_vectra',
        ),
        iOS: DarwinNotificationDetails(),
      ),
      payload: instanceId,
    );
  }

  static Future<void> cancelSilent() async {
    try {
      _activeId = null;
      await _plugin.cancel(id: progressId);
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
  bool _stopped = false;
  HttpClient? _http;
  DateTime _started = DateTime.now();
  int _tools = 0;
  String _since = '';
  String _name = 'Chat';
  String? _lastText;
  String _instanceId = '';
  final _plugin = FlutterLocalNotificationsPlugin();
  bool _notifReady = false;

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    _stopped = false;
    _started = DateTime.fromMillisecondsSinceEpoch(
      await FlutterForegroundTask.getData<int>(key: 'startedMs') ??
          DateTime.now().millisecondsSinceEpoch,
    );
    _since = await FlutterForegroundTask.getData<String>(key: 'since') ?? '';
    _name = await FlutterForegroundTask.getData<String>(key: 'name') ?? 'Chat';
    _tools = await FlutterForegroundTask.getData<int>(key: 'tools') ?? 0;
    _instanceId =
        await FlutterForegroundTask.getData<String>(key: 'instanceId') ?? '';
    await _initNotif();
    unawaited(_loop());
  }

  @override
  void onRepeatEvent(DateTime timestamp) {
    if (_stopped) return;
    unawaited(_pushLive());
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    _stopped = true;
    _http?.close(force: true);
    _http = null;
  }

  Future<void> _initNotif() async {
    if (_notifReady) return;
    try {
      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@drawable/ic_stat_vectra'),
          iOS: DarwinInitializationSettings(),
        ),
      );
      _notifReady = true;
    } catch (_) {}
  }

  Future<void> _loop() async {
    while (!_stopped) {
      try {
        await _connectOnce();
      } catch (_) {}
      if (_stopped) return;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  Future<void> _connectOnce() async {
    final base = await FlutterForegroundTask.getData<String>(key: 'apiBase');
    final token = await FlutterForegroundTask.getData<String>(key: 'token');
    final id = await FlutterForegroundTask.getData<String>(key: 'instanceId');
    _name = await FlutterForegroundTask.getData<String>(key: 'name') ?? _name;
    if (base == null || base.isEmpty || id == null || id.isEmpty) return;
    _instanceId = id;

    final uri = Uri.parse(
      '$base/api/instances/$id/chat/events',
    ).replace(queryParameters: {if (_since.isNotEmpty) 'since': _since});
    final client = HttpClient();
    _http = client;
    try {
      final req = await client.getUrl(uri);
      req.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
      if (token != null && token.isNotEmpty) {
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
      }
      final res = await req.close().timeout(const Duration(seconds: 50));
      if (res.statusCode >= 400) return;
      var buf = '';
      await for (final chunk in res.transform(utf8.decoder)) {
        if (_stopped) return;
        buf += chunk;
        while (true) {
          final i = buf.indexOf('\n\n');
          if (i < 0) break;
          final block = buf.substring(0, i);
          buf = buf.substring(i + 2);
          for (final line in block.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              final map = jsonDecode(line.substring(6));
              if (map is Map<String, dynamic>) _onEvent(map, id);
            } catch (_) {}
          }
        }
      }
    } finally {
      client.close(force: true);
      if (identical(_http, client)) _http = null;
    }
  }

  void _onEvent(Map<String, dynamic> ev, String instanceId) {
    final id = '${ev['id'] ?? ''}';
    _since = nextEventCursor(_since, id) ?? _since;
    final type = '${ev['type'] ?? ''}';
    if (type == 'tool' && ev['state'] != 'done') {
      _tools += 1;
    }
    if (type == 'progress' && ev['tools'] is num) {
      final n = (ev['tools'] as num).toInt();
      if (n > _tools) _tools = n;
    }
    if (type == 'text' && '${ev['text'] ?? ''}'.isNotEmpty) {
      _lastText = '${ev['text']}';
    }
    if (type == 'error' && '${ev['text'] ?? ''}'.isNotEmpty) {
      _lastText = '${ev['text']}';
    }
    if (type == 'done' || type == 'error') {
      unawaited(_complete(instanceId, error: type == 'error'));
      return;
    }
    unawaited(_pushLive());
  }

  Future<void> _pushLive() async {
    if (_stopped) return;
    final elapsed = DateTime.now().difference(_started);
    final pct = TaskNotifications.softPercent(tools: _tools, elapsed: elapsed);
    final m = elapsed.inMinutes;
    final s = elapsed.inSeconds % 60;
    final clock = m <= 0 ? '${s}s' : '${m}m ${s.toString().padLeft(2, '0')}s';
    final label = 'Working · $clock · $_tools tool${_tools == 1 ? '' : 's'}';
    await _initNotif();
    try {
      await TaskNotifications.showProgressNotification(
        plugin: _plugin,
        instanceId: _instanceId,
        name: _name,
        pct: pct,
        label: label,
      );
    } catch (_) {
      await FlutterForegroundTask.updateService(
        notificationTitle: '$_name · $pct%',
        notificationText: label,
      );
    }
  }

  Future<void> _complete(String instanceId, {required bool error}) async {
    if (_stopped) return;
    _stopped = true;
    _http?.close(force: true);
    try {
      await _plugin.cancel(id: TaskNotifications.progressId);
      await TaskNotifications.showDone(
        instanceId: instanceId,
        name: _name,
        body: _lastText,
        error: error,
      );
    } catch (_) {}
    await FlutterForegroundTask.stopService();
  }
}
