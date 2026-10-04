import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:vectra_cloud/chat/event_stream.dart';
import 'package:vectra_cloud/screens/chat.dart';
import 'package:vectra_cloud/screens/browser_handoff.dart';
import 'package:vectra_cloud/screens/instance_settings.dart';
import 'package:vectra_cloud/widgets/computer_pane.dart';
import 'package:vectra_cloud/widgets/ui.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/api/models.dart';
import 'package:vectra_cloud/chat/computer.dart';
import 'package:vectra_cloud/desktop/chat_workspace.dart';
import 'package:vectra_cloud/desktop/inline_browser.dart';
import 'package:vectra_cloud/desktop/native.dart';
import 'package:vectra_cloud/screens/preview.dart';
import 'package:vectra_cloud/widgets/markdown.dart';
import 'package:vectra_cloud/desktop/shell.dart';
import 'package:vectra_cloud/desktop/shortcuts.dart';
import 'package:vectra_cloud/screens/instances.dart';
import 'package:vectra_cloud/screens/login.dart';
import 'package:vectra_cloud/screens/workspace.dart';
import 'package:vectra_cloud/state/session.dart';
import 'package:vectra_cloud/theme.dart';

class _Client extends VectraClient {
  _Client() : super(baseUrl: 'https://example.invalid');
  int refreshes = 0;
  @override
  Future<CloudInstance> getInstance(String id) async => CloudInstance(
    id: id,
    name: 'Design workspace',
    status: 'running',
    runtime: AgentRuntime.supercharge,
    isFree: true,
  );
  @override
  Future<Map<String, dynamic>> getConfig(String id) async => {
    'stored': {'provider': 'custom', 'model': 'example-model'},
  };
  @override
  Future<Map<String, dynamic>> pairing(String id) async => {};
  @override
  Future<Map<String, dynamic>> pollinationsStatus() async => {
    'configured': false,
  };
  @override
  Future<List<BotCommand>> commands(String id) async => [];
  @override
  Future<Map<String, dynamic>> chatStatus(
    String id, {
    String? sessionId,
  }) async => {};
  @override
  Future<Map<String, dynamic>> listConversations(
    String id, {
    String? botId,
  }) async => {};
  @override
  Stream<AppChatEvent> events(
    String id, {
    String? since,
    String? botId,
    String? chatId,
    EventStreamCancellation? cancellation,
  }) {
    late StreamController<AppChatEvent> controller;
    controller = StreamController<AppChatEvent>(
      onListen: () {
        controller.add(AppChatEvent({'type': 'ready'}));
      },
    );
    return controller.stream;
  }

  @override
  Stream<ComputerFrame> browserFrames(
    String id, {
    String? botId,
    EventStreamCancellation? cancellation,
  }) => StreamController<ComputerFrame>().stream;

  @override
  Future<DashboardData> dashboard() async {
    refreshes++;
    return DashboardData(
      instances: [
        CloudInstance(
          id: 'design',
          name: 'Design workspace',
          status: 'running',
          runtime: AgentRuntime.supercharge,
          isFree: true,
        ),
        CloudInstance(
          id: 'api',
          name: 'API service',
          status: 'paused',
          runtime: AgentRuntime.supercharge,
        ),
        CloudInstance(id: 'docs', name: 'Documentation', status: 'running'),
      ],
      quota: FreeQuota(limit: 2, used: 1, available: 1),
    );
  }

  @override
  Future<Map<String, dynamic>> cliVersion(String id) async => {
    'updateAvailable': false,
    'current': '1.3.20',
    'latest': '1.3.20',
  };

  @override
  Future<List<WorkspaceEntry>> listWorkspace(
    String id, {
    String path = '/home/user/workspace',
  }) async => [
    WorkspaceEntry(name: 'src', type: 'directory', size: 0),
    WorkspaceEntry(name: 'README.md', type: 'file', size: 2400),
    WorkspaceEntry(name: 'package.json', type: 'file', size: 450),
  ];

  @override
  Future<String> readWorkspaceFile(String id, String path) async =>
      '# Workspace\n\nThis is a local desktop layout fixture.\n\nNo live account data is used.';
}

class _PreviewClient extends _Client {
  int frameSubscriptions = 0;
  int frameCancellations = 0;
  final frameTargets = <String?>[];
  int ticketRequests = 0;
  int takeoverRequests = 0;

  @override
  Future<CloudInstance> getInstance(String id) async => CloudInstance(
    id: id,
    name: 'Design workspace',
    status: 'running',
    sandboxId: 'fixture-sandbox',
    runtime: AgentRuntime.supercharge,
    isFree: true,
  );

  @override
  Stream<ComputerFrame> browserFrames(
    String id, {
    String? botId,
    EventStreamCancellation? cancellation,
  }) {
    frameSubscriptions++;
    frameTargets.add(botId);
    final controller = StreamController<ComputerFrame>();
    cancellation?.onCancel(() {
      frameCancellations++;
      unawaited(controller.close());
    });
    return controller.stream;
  }

  @override
  Future<Map<String, dynamic>> computerStatus(
    String id, {
    String? botId,
  }) async => {'handoff': true};

  @override
  Future<DateTime> startBrowserHandoff(
    String id, {
    required String handoffId,
    String? botId,
    String? sessionId,
    int minutes = 10,
  }) async {
    takeoverRequests++;
    return DateTime.now().add(const Duration(minutes: 1));
  }

  @override
  Future<String> openAiBrowserVnc(
    String id, {
    required String handoffId,
    String? botId,
  }) async {
    ticketRequests++;
    return 'wss://example.invalid/vnc';
  }
}

class _BotClient extends _Client {
  final subscriptions = <(String?, String?)>[];
  final frameTargets = <String?>[];
  final frameStreams = <StreamController<ComputerFrame>>[];
  int frameCancellations = 0;

  @override
  Stream<ComputerFrame> browserFrames(
    String id, {
    String? botId,
    EventStreamCancellation? cancellation,
  }) {
    frameTargets.add(botId);
    final controller = StreamController<ComputerFrame>();
    frameStreams.add(controller);
    cancellation?.onCancel(() {
      frameCancellations++;
      unawaited(controller.close());
    });
    return controller.stream;
  }

  final calls = <String>[];
  final sent = <(String?, String?, String)>[];
  final steered = <(String, String, String)>[];
  final stopped = <(String?, String?)>[];
  @override
  Future<void> steerChat(
    String id,
    String text, {
    required String botId,
    required String chatId,
  }) async {
    steered.add((botId, chatId, text));
  }

  @override
  Future<void> stopChat(String id, {String? botId, String? chatId}) async {
    stopped.add((botId, chatId));
  }

  final savedBots = <Map<String, dynamic>>[
    {
      'id': 'main',
      'name': 'Main',
      'icon': '🤖',
      'instructions': 'main',
      'defaultFolder': '/home/user/workspace',
      'revision': 1,
    },
    {
      'id': 'research',
      'name': 'Research',
      'icon': '🔎',
      'instructions': 'Research',
      'defaultFolder': '/home/user/workspace/bots/research',
      'revision': 1,
    },
  ];
  @override
  Future<Map<String, dynamic>> listBots(String id) async => {'bots': savedBots};
  @override
  Future<Map<String, dynamic>> groupChat(String id) async => {
    'messages': [
      {
        'id': 'group-question',
        'text': '@Research check the sources for this plan.',
        'createdAt': 1,
        'senderBotId': null,
      },
      {
        'id': 'group-main',
        'text':
            'Research is checking the sources. I will combine the findings with the implementation plan.',
        'createdAt': 2,
        'senderBotId': 'main',
        'sessionId': 'group-main',
      },
    ],
    'activity': [
      {'botId': 'research', 'sessionId': 'group-research', 'state': 'working'},
    ],
  };
  @override
  Future<Map<String, dynamic>> listConversations(
    String id, {
    String? botId,
  }) async {
    calls.add('conversations:$botId');
    final bot = botId ?? 'main';
    return {
      'active': 'chat-$bot',
      'conversations': [
        {
          'sessionId': 'chat-$bot',
          'botId': bot,
          'title': '$bot conversation',
          'createdAt': 1,
          'updatedAt': 1,
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> getConversation(
    String id,
    String sessionId, {
    String? botId,
  }) async {
    calls.add('get:$sessionId:$botId');
    return {
      'messages': [
        {
          'id': '$sessionId:first',
          'role': 'assistant',
          'content': sessionId == 'chat-main'
              ? 'Main only reply'
              : 'Research only reply',
        },
      ],
    };
  }

  @override
  Future<Map<String, dynamic>> chatStatus(
    String id, {
    String? sessionId,
  }) async => {
    'turn': {'busy': sessionId == 'chat-main', 'startedAt': 1},
    'backgroundTasks': [],
    'activeBotChats': ['chat-main'],
    'queuedBotChats': [],
  };
  @override
  Stream<AppChatEvent> events(
    String id, {
    String? since,
    String? botId,
    String? chatId,
    EventStreamCancellation? cancellation,
  }) {
    subscriptions.add((botId, chatId));
    final controller = StreamController<AppChatEvent>();
    controller.add(AppChatEvent({'type': 'ready'}));
    cancellation?.onCancel(() {
      unawaited(controller.close());
    });
    return controller.stream;
  }

  @override
  Future<void> sendChat(
    String id,
    String text, {
    String? botId,
    String? chatId,
  }) async {
    sent.add((botId, chatId, text));
  }

  @override
  Future<Map<String, dynamic>> createBot(
    String id,
    Map<String, dynamic> input,
  ) async {
    final bot = {
      ...input,
      'id': 'new-bot',
      'revision': 1,
      'defaultFolder': '/home/user/workspace/bots/new-bot',
    };
    savedBots.add(bot);
    return {'bot': bot};
  }
}

class _DelayedBotClient extends _BotClient {
  final research = Completer<Map<String, dynamic>>();

  @override
  Future<Map<String, dynamic>> listConversations(String id, {String? botId}) =>
      botId == 'research'
      ? research.future
      : super.listConversations(id, botId: botId);
}

class _RapidBotClient extends _BotClient {
  final research = Completer<Map<String, dynamic>>();
  final planning = Completer<Map<String, dynamic>>();

  _RapidBotClient() {
    savedBots.add({
      'id': 'planning',
      'name': 'Planning',
      'icon': '📝',
      'instructions': 'Plan',
      'defaultFolder': '/home/user/workspace/bots/planning',
      'revision': 1,
    });
  }

  @override
  Future<Map<String, dynamic>> listConversations(String id, {String? botId}) {
    if (botId == 'research') return research.future;
    if (botId == 'planning') return planning.future;
    return super.listConversations(id, botId: botId);
  }

  @override
  Future<Map<String, dynamic>> getConversation(
    String id,
    String sessionId, {
    String? botId,
  }) async => {
    'messages': [
      {
        'id': '$sessionId:first',
        'role': 'assistant',
        'content': sessionId == 'chat-main'
            ? 'Main only reply'
            : sessionId == 'chat-planning'
            ? 'Planning only reply'
            : 'Research only reply',
      },
    ],
  };
}

class _ActivityBotClient extends _BotClient {
  final statusRequests = <String?>[];

  @override
  Future<Map<String, dynamic>> chatStatus(
    String id, {
    String? sessionId,
  }) async {
    statusRequests.add(sessionId);
    return {
      'turn': {'busy': sessionId == 'chat-main', 'startedAt': 1},
      'backgroundTasks': [],
      'activeBotChats': ['chat-research'],
      'queuedBotChats': [],
      'conversations': [
        {
          'sessionId': 'chat-main',
          'botId': 'main',
          'updatedAt': 1,
          'lastMessageId': 'main-1',
          'lastMessage': 'Main only reply',
        },
        {
          'sessionId': 'chat-research',
          'botId': 'research',
          'updatedAt': 2,
          'lastMessageId': 'research-1',
          'lastMessage': 'Research only reply',
        },
      ],
    };
  }
}

class _Paths extends PathProviderPlatform {
  final root = Directory.systemTemp.createTempSync('vectra-widget-tests-');
  @override
  Future<String?> getApplicationDocumentsPath() async => root.path;
}

Future<void> _size(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _capture(WidgetTester tester, String name) async {
  if (!const bool.fromEnvironment('DESKTOP_CAPTURE')) return;
  final render = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('capture')),
  );
  await tester.runAsync(() async {
    final image = await render.toImage();
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final directory = Directory('/tmp/vectra-desktop-review');
    await directory.create(recursive: true);
    await File(
      '${directory.path}/$name.png',
    ).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> _app(
  WidgetTester tester,
  _Client client, {
  String path = '/',
}) async {
  final session = SessionController(apiBase: client.baseUrl)
    ..client = client
    ..ready = true
    ..user = AuthUser(id: 'fixture', email: 'desktop@example.invalid');
  final router = GoRouter(
    initialLocation: path,
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      ShellRoute(
        builder: (_, _, child) =>
            defaultTargetPlatform == TargetPlatform.android
            ? child
            : DesktopShell(child: child),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const InstancesScreen()),
          GoRoute(
            path: '/chat/design',
            builder: (_, state) => ChatScreen(
              instanceId: 'design',
              initialBotId: state.uri.queryParameters['bot'],
              initialSessionId: state.uri.queryParameters['thread'],
              showGroup: state.uri.queryParameters['group'] == '1',
            ),
          ),
          GoRoute(
            path: '/instance/design',
            builder: (_, _) =>
                const InstanceSettingsScreen(instanceId: 'design'),
          ),
          GoRoute(
            path: '/instance/design/files',
            builder: (_, _) => const WorkspaceScreen(instanceId: 'design'),
          ),
          GoRoute(
            path: '/account',
            builder: (_, _) => const Scaffold(body: Text('Account fixture')),
          ),
        ],
      ),
    ],
  );
  addTearDown(router.dispose);
  addTearDown(session.dispose);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: session,
      child: RepaintBoundary(
        key: const ValueKey('capture'),
        child: MaterialApp.router(
          debugShowCheckedModeBanner: false,
          theme: Vc.dark(
            desktop: defaultTargetPlatform == TargetPlatform.linux,
          ),
          routerConfig: router,
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 100)),
  );
  if (path.startsWith('/chat/')) {
    await tester.pump(const Duration(milliseconds: 200));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump(const Duration(milliseconds: 200));
  } else {
    await tester.pumpAndSettle();
  }
  await tester.pump(const Duration(milliseconds: 200));
}

Future<void> _shortcut(
  WidgetTester tester,
  LogicalKeyboardKey key, {
  bool shift = false,
}) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
  if (shift) await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(key);
  if (shift) await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
  await tester.pump(const Duration(milliseconds: 200));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    PathProviderPlatform.instance = _Paths();
    FlutterSecureStorage.setMockInitialValues({});
    if (!const bool.fromEnvironment('DESKTOP_CAPTURE')) return;
    for (final font in <String, String>{
      'Adwaita Sans':
          '/usr/share/fonts/adwaita-sans-fonts/AdwaitaSans-Regular.ttf',
      'Roboto': '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
      'Roboto Medium': '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
      'Roboto Light': '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf',
      'Ahem': '/usr/share/fonts/adwaita-sans-fonts/AdwaitaSans-Regular.ttf',
      'monospace': '/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf',
      'MaterialIcons':
          '/home/r3ap3reditz/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    }.entries) {
      final file = File(font.value);
      if (!file.existsSync()) continue;
      final loader = FontLoader(font.key)
        ..addFont(Future.value(ByteData.sublistView(await file.readAsBytes())));
      await loader.load();
    }
  });

  test('desktop shortcuts are unique and every command is documented', () {
    expect(
      desktopBindings.map((b) => b.shortcut).toSet().length,
      desktopBindings.length,
    );
    expect(
      desktopBindings.map((b) => b.command).toSet(),
      DesktopCommand.values.toSet(),
    );
  });

  testWidgets('desktop workspace list, search, menus, and shortcuts', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1440, 900));
    final client = _Client();
    await _app(tester, client);
    expect(find.byKey(const ValueKey('desktop-sidebar')), findsOneWidget);
    expect(find.byType(MenuBar), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Image &&
            widget.image is AssetImage &&
            (widget.image as AssetImage).assetName == 'assets/brand/logo.png',
      ),
      findsWidgets,
    );
    expect(tester.takeException(), isNull);
    await _capture(tester, 'workspaces-desktop');
    await _shortcut(tester, LogicalKeyboardKey.keyF);
    final searchFinder = find.widgetWithText(TextField, 'Find a workspace…');
    final search = tester.widget<TextField>(searchFinder);
    expect(search.focusNode!.hasFocus, isTrue);
    await tester.enterText(searchFinder, 'API service');
    await tester.pumpAndSettle();
    expect(find.text('API service'), findsNWidgets(2));
    expect(find.text('Documentation'), findsNothing);
    final before = client.refreshes;
    await _shortcut(tester, LogicalKeyboardKey.keyR);
    expect(client.refreshes, greaterThan(before));
    await tester.sendKeyEvent(LogicalKeyboardKey.f1);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    await _capture(tester, 'shortcuts-desktop');
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    await _shortcut(tester, LogicalKeyboardKey.keyN, shift: true);
    expect(find.text('Create your workspace'), findsNothing);
    expect(find.byType(AlertDialog), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('group chat opens on desktop and agents remain in the menu', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    PathProviderPlatform.instance = _Paths();
    await _size(tester, const Size(1440, 900));
    final client = _BotClient();
    await _app(tester, client, path: '/chat/design?group=1');
    for (var i = 0; i < 8; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 60)),
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byKey(const ValueKey('sidebar-group')), findsOneWidget);
    expect(find.byKey(const ValueKey('group-composer')), findsOneWidget);
    expect(find.text('Research · working'), findsOneWidget);
    for (var i = 0; i < 100 && client.frameTargets.isEmpty; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(client.frameTargets, contains('main'));
    expect(tester.takeException(), isNull);
    await _capture(tester, 'group-desktop');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('Android computer subscribes to the selected bot desktop', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    PathProviderPlatform.instance = _Paths();
    await _size(tester, const Size(390, 844));
    final client = _BotClient();
    await _app(tester, client, path: '/chat/design?bot=research');
    for (
      var i = 0;
      i < 100 &&
          find
              .textContaining('Research only reply', findRichText: true)
              .evaluate()
              .isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(
      find.textContaining('Research only reply', findRichText: true),
      findsWidgets,
    );
    await tester.ensureVisible(find.byType(ComputerBar));
    await tester.tap(find.byType(ComputerBar));
    await tester.pump();
    for (var i = 0; i < 100 && client.frameTargets.isEmpty; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(client.frameTargets, contains('research'));
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.byType(ComputerPage), findsOneWidget);
    expect(
      tester.widget<ComputerPage>(find.byType(ComputerPage)).state,
      isA<ComputerState>(),
    );
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('phone direct chat can steer and stop a running agent', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    PathProviderPlatform.instance = _Paths();
    await _size(tester, const Size(390, 844));
    final client = _BotClient();
    await _app(tester, client, path: '/chat/design?bot=main');
    for (var i = 0; i < 100 && find.text('Steer').evaluate().isEmpty; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(find.text('Steer'), findsOneWidget);
    expect(find.byTooltip('Stop task'), findsOneWidget);
    final composer = find.byWidgetPredicate(
      (widget) =>
          widget is TextField && widget.decoration?.hintText == 'Message',
    );
    await tester.enterText(composer, 'Check the latest result first');
    await tester.pump();
    await tester.tap(find.text('Steer'));
    await tester.pump();
    expect(client.steered, [
      ('main', 'chat-main', 'Check the latest result first'),
    ]);
    expect(client.sent, isEmpty);
    expect(tester.widget<TextField>(composer).controller?.text, isEmpty);
    await tester.tap(find.byTooltip('Stop task'));
    await tester.pump();
    expect(client.stopped, [('main', 'chat-main')]);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('phone home shows contacts and opens the shared group', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    PathProviderPlatform.instance = _Paths();
    await _size(tester, const Size(390, 844));
    await _app(tester, _BotClient(), path: '/chat/design?group=1');
    for (var i = 0; i < 8; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 60)),
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byKey(const ValueKey('group-contact')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('group-contact')));
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 40)),
      );
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(find.byKey(const ValueKey('group-composer')), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _capture(tester, 'group-phone');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('phone group can steer and stop its active agent', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    PathProviderPlatform.instance = _Paths();
    await _size(tester, const Size(390, 844));
    final client = _BotClient();
    await _app(tester, client, path: '/chat/design?group=1');
    for (
      var i = 0;
      i < 20 && find.byKey(const ValueKey('group-contact')).evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 30)),
      );
      await tester.pump(const Duration(milliseconds: 30));
    }
    await tester.tap(find.byKey(const ValueKey('group-contact')));
    for (
      var i = 0;
      i < 100 && find.byTooltip('Stop research').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump(const Duration(milliseconds: 20));
    }
    expect(find.byTooltip('Stop research'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('group-composer')),
      'Focus on the sources',
    );
    await tester.pump();
    await tester.tap(find.byTooltip('Steer research'));
    await tester.pump();
    expect(client.steered, [
      ('research', 'group-research', 'Focus on the sources'),
    ]);
    expect(client.sent, isEmpty);
    expect(
      tester
          .widget<TextField>(find.byKey(const ValueKey('group-composer')))
          .controller
          ?.text,
      isEmpty,
    );
    await tester.tap(find.byTooltip('Stop research'));
    await tester.pump();
    expect(client.stopped, [('research', 'group-research')]);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('login form stays readable on desktop', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1440, 900));
    await _app(tester, _Client(), path: '/login');
    expect(tester.getSize(find.byType(TextField).first).width, lessThan(480));
    expect(tester.takeException(), isNull);
    await _capture(tester, 'login-desktop');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('file browser previews alongside the list', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1440, 900));
    await _app(tester, _Client(), path: '/instance/design/files');
    await tester.tap(find.text('README.md'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('This is a local desktop layout fixture.'),
      findsOneWidget,
    );
    expect(find.text('package.json'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _capture(tester, 'files-desktop');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('desktop chat panes resize and composer sends only Enter', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1200, 800));
    final controller = TextEditingController(text: 'Hello');
    final focus = FocusNode();
    final computer = ComputerState();
    var sends = 0;
    var pastes = 0;
    addTearDown(controller.dispose);
    addTearDown(focus.dispose);
    addTearDown(computer.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: Vc.dark(desktop: true),
        home: Scaffold(
          body: DesktopChatWorkspace(
            computer: computer,
            showComputer: true,
            onCloseComputer: () {},
            onRunCommand: (_) async {},
            onManualControl: () async {},
            chat: Column(
              children: [
                const Expanded(child: Center(child: Text('Conversation'))),
                DesktopComposerKeys(
                  controller: controller,
                  onSend: () => sends++,
                  onPaste: () => pastes++,
                  child: TextField(
                    controller: controller,
                    focusNode: focus,
                    maxLines: 6,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    focus.requestFocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(sends, 1);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    expect(sends, 1);
    tester.testTextInput.updateEditingValue(
      const TextEditingValue(
        text: 'Hello\n',
        selection: TextSelection.collapsed(offset: 6),
      ),
    );
    expect(controller.text, contains('\n'));
    await _shortcut(tester, LogicalKeyboardKey.keyV);
    expect(pastes, 1);
    controller.value = const TextEditingValue(
      text: 'compose',
      composing: TextRange(start: 0, end: 7),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(sends, 1);
    expect(tester.takeException(), isNull);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('phone login retains touch layout and Enter is not intercepted', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await _size(tester, const Size(390, 844));
    await _app(tester, _Client(), path: '/login');
    expect(find.byType(MenuBar), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Image &&
            widget.image is AssetImage &&
            (widget.image as AssetImage).assetName == 'assets/brand/logo.png',
      ),
      findsWidgets,
    );
    expect(tester.takeException(), isNull);
    await _capture(tester, 'login-mobile');
    debugDefaultTargetPlatformOverride = null;
  });
  testWidgets(
    'passive browser uses image stream; takeover opens full-window and restores viewing on exit',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      PathProviderPlatform.instance = _Paths();
      await _size(tester, const Size(1440, 900));
      final client = _PreviewClient();
      await _app(tester, client, path: '/chat/design');
      for (var i = 0; i < 8; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 40)),
        );
        await tester.pump(const Duration(milliseconds: 40));
      }
      expect(client.frameSubscriptions, 1);
      expect(client.ticketRequests, 0);
      expect(find.byType(BrowserHandoffScreen), findsNothing);
      final workspace = tester.widget<DesktopChatWorkspace>(
        find.byType(DesktopChatWorkspace),
      );
      workspace.computer.tab = 'browser';
      await tester.pump();
      expect(find.byType(ComputerBrowserView), findsWidgets);
      await tester.tap(find.text('Take over'));
      for (var i = 0; i < 10; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 25)),
        );
        await tester.pump(const Duration(milliseconds: 60));
      }
      expect(client.frameCancellations, 1);
      expect(
        client.ticketRequests,
        0,
        reason: 'A conflicting handoff must never connect noVNC',
      );
      expect(client.takeoverRequests, 0);
      expect(tester.getSize(find.byType(BrowserHandoffScreen)).width, 1440);
      expect(find.byKey(const ValueKey('handoff-notes')), findsNothing);
      await tester.tap(find.text('Back to viewing'));
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.byType(BrowserHandoffScreen), findsNothing);
      expect(client.frameSubscriptions, 2);
      await tester.pumpWidget(const SizedBox.shrink());
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets('desktop chat has inline computer and keyboard navigation', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1440, 900));
    await _app(tester, _Client(), path: '/chat/design');
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(DesktopChatWorkspace), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.runAsync(() async {
      for (
        var attempt = 0;
        attempt < 10 &&
            find.text('Connecting to sandbox…').evaluate().isNotEmpty;
        attempt++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 50));
      }
    });
    await tester.pump(const Duration(milliseconds: 200));
    await _capture(tester, 'chat-desktop');
    await _shortcut(tester, LogicalKeyboardKey.keyL);
    final composer = tester.widget<TextField>(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.hintText == 'Message',
      ),
    );
    expect(composer.focusNode!.hasFocus, isTrue);
    await _shortcut(tester, LogicalKeyboardKey.keyJ);
    expect(find.byType(ComputerTerminalView), findsNothing);
    await _shortcut(tester, LogicalKeyboardKey.keyF);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is TextField &&
            widget.decoration?.hintText == 'Find in conversation…',
      ),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 100)),
    );
    await tester.pump(const Duration(seconds: 2));
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets(
    'E2B bots switch chats without stopping another bot and route prompts explicitly',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      await _size(tester, const Size(1440, 900));
      final client = _BotClient();
      await _app(tester, client, path: '/chat/design');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 350)),
      );
      await tester.pump(const Duration(milliseconds: 300));
      for (
        var attempt = 0;
        attempt < 200 && find.byTooltip('Bots').evaluate().isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.byTooltip('Bots'),
        findsOneWidget,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((text) => text.data)
            .join(' | '),
      );
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .textContaining('Main only reply', findRichText: true)
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.textContaining('Main only reply', findRichText: true),
        findsWidgets,
        reason:
            'calls=${client.calls}, subscriptions=${client.subscriptions}, text=${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).join(' | ')}',
      );
      final computerState = tester
          .widget<DesktopChatWorkspace>(find.byType(DesktopChatWorkspace))
          .computer;
      expect(client.frameTargets, contains('main'));
      client.frameStreams.last.add(
        const ComputerFrame(
          type: 'status',
          desktop: true,
          connected: true,
          screencasting: true,
        ),
      );
      await tester.pump();
      expect(computerState.desktopAvailable, true);
      await _capture(tester, 'agents-desktop');
      await tester.tap(find.byTooltip('Bots'));
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Research'), findsWidgets);
      await tester.tap(
        find.descendant(
          of: find.byType(Dialog),
          matching: find.text('Research'),
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 350)),
      );
      await tester.pump(const Duration(milliseconds: 350));
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .textContaining('Research only reply', findRichText: true)
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.textContaining('Research only reply', findRichText: true),
        findsWidgets,
      );
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining('Main only reply', findRichText: true),
        ),
        findsNothing,
      );
      expect(client.subscriptions.last, ('research', 'chat-research'));
      expect(client.frameTargets, containsAllInOrder(['main', 'research']));
      expect(client.frameCancellations, greaterThanOrEqualTo(1));
      expect(computerState.desktopAvailable, false);
      expect(computerState.liveJpeg, isNull);
      final composer = find.byWidgetPredicate(
        (widget) =>
            widget is TextField && widget.decoration?.hintText == 'Message',
      );
      await tester.enterText(composer, 'research this');
      await tester.pump();
      await tester.tap(find.byTooltip('Send (Enter)'));
      for (var attempt = 0; attempt < 30 && client.sent.isEmpty; attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(client.sent, isNotEmpty, reason: '${client.calls}');
      expect(client.sent.last, ('research', 'chat-research', 'research this'));
      await tester.tap(find.byKey(const ValueKey('sidebar-group')));
      for (
        var attempt = 0;
        attempt < 100 && client.frameTargets.last != 'main';
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(client.frameTargets.last, 'main');
      expect(client.frameCancellations, greaterThanOrEqualTo(2));
      expect(find.byKey(const ValueKey('group-composer')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump(const Duration(seconds: 2));
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets(
    'switching bots hides the prior transcript before delayed network work',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      await _size(tester, const Size(1440, 900));
      PathProviderPlatform.instance = _Paths();
      final client = _DelayedBotClient();
      await _app(tester, client, path: '/chat/design');
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .textContaining('Main only reply', findRichText: true)
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining('Main only reply', findRichText: true),
        ),
        findsWidgets,
      );
      await tester.tap(find.byTooltip('Bots'));
      await tester.pump();
      await tester.tap(
        find.descendant(
          of: find.byType(Dialog),
          matching: find.text('Research'),
        ),
      );
      await tester.pump();
      expect(find.text('Opening Research…'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining('Main only reply', findRichText: true),
        ),
        findsNothing,
      );
      await tester.runAsync(() async {
        client.research.complete({
          'active': 'chat-research',
          'conversations': [
            {
              'sessionId': 'chat-research',
              'botId': 'research',
              'title': 'Research',
              'createdAt': 1,
              'updatedAt': 1,
            },
          ],
        });
      });
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .textContaining('Research only reply', findRichText: true)
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining(
            'Research only reply',
            findRichText: true,
          ),
        ),
        findsWidgets,
      );
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets(
    'rapid bot selections discard late replies from the previous selection',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      await _size(tester, const Size(1440, 900));
      PathProviderPlatform.instance = _Paths();
      final client = _RapidBotClient();
      await _app(tester, client, path: '/chat/design');
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .descendant(
                  of: find.byType(DesktopChatWorkspace),
                  matching: find.textContaining(
                    'Main only reply',
                    findRichText: true,
                  ),
                )
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining('Main only reply', findRichText: true),
        ),
        findsWidgets,
      );
      await tester.tap(find.byTooltip('Bots'));
      await tester.pump();
      await tester.tap(
        find.descendant(
          of: find.byType(Dialog),
          matching: find.text('Research'),
        ),
      );
      await tester.pump();
      expect(find.text('Opening Research…'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('agent-planning')));
      await tester.pump();
      expect(find.text('Opening Planning…'), findsOneWidget);
      await tester.runAsync(
        () async => client.research.complete({
          'active': 'chat-research',
          'conversations': [
            {
              'sessionId': 'chat-research',
              'botId': 'research',
              'title': 'Research',
              'createdAt': 1,
              'updatedAt': 1,
            },
          ],
        }),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Opening Planning…'), findsOneWidget);
      await tester.runAsync(
        () async => client.planning.complete({
          'active': 'chat-planning',
          'conversations': [
            {
              'sessionId': 'chat-planning',
              'botId': 'planning',
              'title': 'Planning',
              'createdAt': 1,
              'updatedAt': 1,
            },
          ],
        }),
      );
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .descendant(
                  of: find.byType(DesktopChatWorkspace),
                  matching: find.textContaining(
                    'Planning only reply',
                    findRichText: true,
                  ),
                )
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining(
            'Planning only reply',
            findRichText: true,
          ),
        ),
        findsWidgets,
      );
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining(
            'Research only reply',
            findRichText: true,
          ),
        ),
        findsNothing,
      );
      expect(client.subscriptions.last, ('planning', 'chat-planning'));
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets(
    'failed bot switch restores previous conversation without leaking another bot',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      await _size(tester, const Size(1440, 900));
      PathProviderPlatform.instance = _Paths();
      final client = _DelayedBotClient();
      await _app(tester, client, path: '/chat/design');
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .textContaining('Main only reply', findRichText: true)
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      await tester.tap(find.byTooltip('Bots'));
      await tester.pump();
      await tester.tap(
        find.descendant(
          of: find.byType(Dialog),
          matching: find.text('Research'),
        ),
      );
      await tester.pump();
      expect(find.text('Opening Research…'), findsOneWidget);
      await tester.runAsync(
        () async => client.research.completeError(StateError('Unavailable')),
      );
      for (
        var attempt = 0;
        attempt < 50 && find.text('Opening Research…').evaluate().isNotEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining('Main only reply', findRichText: true),
        ),
        findsWidgets,
      );
      expect(
        find.descendant(
          of: find.byType(DesktopChatWorkspace),
          matching: find.textContaining(
            'Research only reply',
            findRichText: true,
          ),
        ),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets(
    'phone agent contacts open a bot chat without showing the prior chat',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      await _size(tester, const Size(390, 844));
      PathProviderPlatform.instance = _Paths();
      final client = _BotClient();
      await _app(tester, client, path: '/chat/design');
      for (
        var attempt = 0;
        attempt < 200 &&
            (find.byTooltip('Bots').evaluate().isEmpty ||
                find
                    .textContaining('Main only reply', findRichText: true)
                    .evaluate()
                    .isEmpty);
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.textContaining('Main only reply', findRichText: true),
        findsWidgets,
      );
      await tester.tap(find.byTooltip('Bots'));
      await tester.pump();
      await _capture(tester, 'agents-phone');
      expect(find.byKey(const ValueKey('agent-research')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('agent-research')));
      for (
        var attempt = 0;
        attempt < 100 &&
            find
                .textContaining('Research only reply', findRichText: true)
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.textContaining('Research only reply', findRichText: true),
        findsWidgets,
        reason:
            'calls=${client.calls}; subscriptions=${client.subscriptions}; text=${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).join(' | ')}',
      );
      expect(
        find.textContaining('Main only reply', findRichText: true),
        findsNothing,
      );
      expect(client.subscriptions.last, ('research', 'chat-research'));
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets(
    'agent contact shows working state and recent reply without opening its thread',
    (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.linux;
      await _size(tester, const Size(1440, 900));
      PathProviderPlatform.instance = _Paths();
      final client = _ActivityBotClient();
      await _app(tester, client, path: '/chat/design');
      for (
        var attempt = 0;
        attempt < 200 &&
            find.byKey(const ValueKey('agent-research')).evaluate().isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      await tester.pump(const Duration(seconds: 7));
      for (
        var attempt = 0;
        attempt < 200 &&
            find
                .descendant(
                  of: find.byKey(const ValueKey('agent-research')),
                  matching: find.text('Working'),
                )
                .evaluate()
                .isEmpty;
        attempt++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('agent-research')),
          matching: find.text('Working'),
        ),
        findsOneWidget,
        reason:
            'status=${client.statusRequests}, bots=${client.savedBots}, '
            'subscriptions=${client.subscriptions}, texts=${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).join(' | ')}',
      );
      expect(
        client.subscriptions.where((pair) => pair.$1 == 'research'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      debugDefaultTargetPlatformOverride = null;
    },
  );

  testWidgets('desktop settings sections scroll to the actual controls', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1440, 900));
    await _app(tester, _Client(), path: '/instance/design');
    expect(find.text('Save configuration'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await _capture(tester, 'settings-desktop');
    final shellButton = find.widgetWithText(TextButton, 'Shell');
    await tester.tap(shellButton);
    await tester.pumpAndSettle();
    final shellHeading = find.byWidgetPredicate(
      (widget) => widget is SectionTitle && widget.text == 'Shell',
    );
    expect(tester.getTopLeft(shellHeading).dy, inInclusiveRange(150, 800));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('ordinary links open an internal preview on desktop', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1100, 750));
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(DesktopNative.channel, (call) async {
          calls.add(call);
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(DesktopNative.channel, null),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ChatMarkdown(data: '[Docs](https://example.org/docs)'),
        ),
      ),
    );
    await tester.tap(find.text('Docs'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(PreviewBrowserScreen), findsOneWidget);
    expect(find.byType(InlineBrowserView), findsOneWidget);
    expect(find.byTooltip('Open in browser'), findsOneWidget);
    expect(calls.where((call) => call.method == 'openBrowser'), isEmpty);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('inline preview hides behind a dialog and restores afterward', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(1100, 750));
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(DesktopNative.channel, (call) async {
          calls.add(call);
          return null;
        });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(DesktopNative.channel, null),
    );
    late BuildContext pageContext;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              pageContext = context;
              return const SizedBox.expand(
                child: InlineBrowserView(
                  surface: DesktopNative.previewSurface,
                  url: 'https://example.org/',
                ),
              );
            },
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(
      calls.map((call) => call.method),
      containsAllInOrder(['inlineLoad', 'inlineShow']),
    );
    showDialog<void>(
      context: pageContext,
      builder: (context) => AlertDialog(
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(calls.map((call) => call.method), contains('inlineHide'));
    await tester.tap(find.text('Close'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(calls.last.method, 'inlineShow');
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 100));
    expect(calls.last.method, 'inlineDispose');
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('compact PC and phone workspace navigation stay usable', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    await _size(tester, const Size(720, 540));
    await _app(tester, _Client());
    expect(find.byKey(const ValueKey('desktop-sidebar')), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    tester.view.physicalSize = const Size(390, 844);
    await _app(tester, _Client());
    expect(find.byType(MenuBar), findsNothing);
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(tester.takeException(), isNull);
    await _capture(tester, 'workspaces-mobile');
    await tester.pumpWidget(const SizedBox());
    debugDefaultTargetPlatformOverride = null;
  });
}
