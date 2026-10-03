import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:vectra_cloud/screens/managed_mcp_section.dart';
import 'package:vectra_cloud/state/session.dart';
import 'package:vectra_cloud/widgets/side_panel.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/api/marketplace.dart';
import 'package:vectra_cloud/api/models.dart';
import 'package:vectra_cloud/screens/marketplace.dart';
import 'package:vectra_cloud/screens/marketplace_detail.dart';
import 'package:vectra_cloud/state/marketplace.dart';
import 'package:vectra_cloud/theme.dart';

Map<String, dynamic> echoCatalog() => {
  'id': 'vectra-echo',
  'name': 'Echo MCP',
  'version': '1.0.0',
  'description': 'A local echo tool.',
  'source': {'type': 'archive', 'sha256': 'a' * 64},
};

Map<String, dynamic> discoveryEntry({String id = 'community-echo'}) => {
  'id': id,
  'name': 'Community Echo',
  'description': 'Browse a community connector.',
  'category': 'Community tools',
  'publisher': 'OpenAI',
  'url': 'https://github.com/openai/plugins',
  'auth': 'oauth',
};

Map<String, dynamic> installed({
  int revision = 1,
  bool trusted = false,
  bool enabled = false,
}) => {
  'id': 'vectra-echo',
  'revision': revision,
  'trusted': trusted,
  'enabled': enabled,
  'configuredKeys': <String>[],
  'activeDigest': 'e1288de348eab757a0c5f0dd4580a371d02850470abfc0466af067b672f9081a',
  'manifest': {
    'name': 'Echo MCP',
    'version': '1.0.0',
    'permissions': ['mcp:stdio'],
    'mcpServers': {'echo': {}},
    'userConfig': <String, dynamic>{},
  },
};

class MarketplaceApi extends VectraClient {
  MarketplaceApi() : super(baseUrl: 'https://example.test');
  List<CloudInstance> workspaces = [
    CloudInstance(
      id: 'vm-a',
      name: 'Workspace A',
      status: 'running',
      runtime: AgentRuntime.supercharge,
    ),
    CloudInstance(
      id: 'vm-b',
      name: 'Workspace B',
      status: 'running',
      runtime: AgentRuntime.supercharge,
    ),
    CloudInstance(id: 'legacy', name: 'Legacy', status: 'running'),
  ];
  List<Map<String, dynamic>> entries = [echoCatalog()];
  final stores = <String, List<Map<String, dynamic>>>{
    'vm-a/main': [],
    'vm-a/other': [],
    'vm-b/main': [],
  };
  final requests = <Map<String, dynamic>>[];
  Map<String, dynamic> binding = {};
  bool failStatus = false;
  bool failCatalog = false;
  bool failDiscovery = false;
  Map<String, dynamic> discoveryResponse = {
    'discovery': {
      'source': {'repository': 'openai/plugins', 'commit': 'a' * 40},
      'plugins': <Map<String, dynamic>>[],
    },
  };
  bool failAction = false;
  bool failConversations = false;
  List<Map<String, dynamic>>? botRows;
  Future<Map<String, dynamic>> Function(String instance, String bot)?
  pendingStatus;
  Future<Map<String, dynamic>> Function(String instance, String bot)?
  pendingConversations;
  Completer<Map<String, dynamic>>? pendingAction;

  @override
  Future<DashboardData> dashboard() async =>
      DashboardData(instances: workspaces, quota: FreeQuota());
  @override
  Future<Map<String, dynamic>> managedMcpCatalog() async {
    if (failCatalog) throw ApiException(500, 'Catalog failed');
    return {'plugins': entries};
  }

  @override
  Future<Map<String, dynamic>> managedMcpDiscovery() async {
    if (failDiscovery) throw ApiException(503, 'Discovery failed');
    return discoveryResponse;
  }

  @override
  Future<Map<String, dynamic>> listBots(String id) async => {
    'bots':
        botRows ??
        [
          {'id': 'main', 'name': 'Main'},
          {'id': 'other', 'name': 'Other'},
        ],
  };
  @override
  Future<Map<String, dynamic>> listConversations(
    String id, {
    String? botId,
  }) async {
    if (pendingConversations != null) return pendingConversations!(id, botId!);
    if (failConversations) throw ApiException(500, 'Conversations failed');
    return {
      'conversations': [
        {'sessionId': 'chat-$botId', 'botId': botId, 'title': 'Current chat'},
        {'sessionId': 'foreign', 'botId': 'foreign', 'title': 'Foreign chat'},
        {'sessionId': 'group', 'botId': botId, 'source': 'group'},
      ],
    };
  }

  Map<String, dynamic> status(String id, String bot) => {
    'inventory': {'plugins': stores['$id/$bot'] ?? []},
    'bindings': binding.isEmpty ? {} : {'chat-$bot': binding},
  };
  @override
  Future<Map<String, dynamic>> botManagedMcp(
    String id,
    String botId,
    Map<String, dynamic> action,
  ) async {
    requests.add({'instance': id, 'bot': botId, ...action});
    if (action['action'] == 'status') {
      if (pendingStatus != null) return pendingStatus!(id, botId);
      if (failStatus) throw ApiException(503, 'unsupported');
      return status(id, botId);
    }
    if (pendingAction != null) return pendingAction!.future;
    if (failAction) throw ApiException(500, 'secret-value-should-not-appear');
    final key = '$id/$botId';
    if (action['action'] == 'installCatalog') stores[key] = [installed()];
    if (action['action'] == 'pluginAction') {
      final change = action['pluginAction'] as Map;
      final row = stores[key]!.first;
      row['revision'] = (row['revision'] as int) + 1;
      if (change['action'] == 'trust') row['trusted'] = true;
      if (change['action'] == 'enable') row['enabled'] = true;
      if (change['action'] == 'disable') row['enabled'] = false;
      if (change['action'] == 'configure') {
        row['configuredKeys'] = (change['values'] as Map).keys.toList();
      }
    }
    if (action['action'] == 'apply') {
      binding = {
        'pluginId': action['pluginId'],
        'serverId': action['serverId'],
        'status': 'applied',
        'revision': 1,
        'tools': [
          {'name': 'echo-tool', 'description': 'vectra-echo/echo/echo: local echo'},
        ],
      };
    }
    if (action['action'] == 'verify') binding['status'] = 'ready';
    return {};
  }
}

Future<void> scrollTo(WidgetTester tester, Finder finder, double delta) async {
  await tester.scrollUntilVisible(
    finder,
    delta,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  late MarketplaceApi api;
  late MarketplaceController controller;
  setUp(() {
    api = MarketplaceApi();
    controller = MarketplaceController(api);
  });
  tearDown(() => controller.dispose());

  test(
    'legacy catalog has honest local fallbacks and optional metadata is searchable',
    () {
      final legacy = MarketplacePlugin(echoCatalog());
      expect(legacy.publisher, 'Publisher not provided');
      expect(legacy.category, 'Uncategorized');
      expect(legacy.auth, 'unspecified');
      expect(legacy.capabilities, isEmpty);
      expect(legacy.icon, Icons.graphic_eq);
      final extended = MarketplacePlugin({
        ...echoCatalog(),
        'publisher': 'Vectra',
        'category': 'Developer tools',
        'auth': 'none',
        'icon': 'https://untrusted.test/tracker.svg',
        'capabilities': ['mcp'],
      });
      expect(extended.matches('developer'), isTrue);
      expect(extended.matches('vectra'), isTrue);
      expect(extended.icon, Icons.graphic_eq);
      expect(
        MarketplacePlugin({
          'id': 'unknown',
          'icon': 'https://untrusted.test/x',
        }).icon,
        Icons.extension_outlined,
      );
      expect(
        MarketplacePlugin({
          ...echoCatalog(),
          'source': {'type': 'archive', 'sha256': 'bad'},
        }).digest,
        isNull,
      );
    },
  );

  test('OAuth-only releases cannot be enabled or attached without a flow', () async {
    api.entries = [
      {...echoCatalog(), 'auth': 'oauth'},
    ];
    api.stores['vm-a/main'] = [
      {
        ...installed(trusted: true, enabled: true),
        'manifest': {
          ...installed()['manifest'] as Map<String, dynamic>,
          'userConfig': {
            'oauthToken': {'required': false},
          },
        },
      },
    ];
    await controller.load(initialInstanceId: 'vm-a');
    final plugin = controller.plugin('vectra-echo')!;
    expect(plugin.authenticationSupported, isFalse);
    expect(await controller.setEnabled(plugin.id, true), isFalse);
    expect(await controller.attach(plugin.id, 'echo', 'chat-main'), isFalse);
    expect(api.requests.where((row) => row['action'] == 'apply'), isEmpty);
    api.stores['vm-a/main'] = [];
    await controller.refreshInventory();
    expect(await controller.install(plugin.id), isFalse);
    expect(api.requests.where((row) => row['action'] == 'installCatalog'), isEmpty);
  });

  test(
    'install, write-only configuration, exact approval, enable, attach and consented verification use VM actions',
    () async {
      await controller.load(initialInstanceId: 'vm-a');
      expect(controller.conversations.map((row) => row['sessionId']), [
        'chat-main',
      ]);
      expect(await controller.install('vectra-echo'), isTrue);
      final install = api.requests.firstWhere(
        (row) => row['action'] == 'installCatalog',
      );
      expect(install['instance'], 'vm-a');
      expect(install['bot'], 'main');
      expect(install['catalogSha256'], 'a' * 64);
      expect(install.containsKey('url'), isFalse);
      expect(controller.plugin('vectra-echo')!.trusted, isFalse);
      expect(await controller.setEnabled('vectra-echo', true), isFalse);
      final oldConsent = controller.reviewFingerprint('vectra-echo')!;
      final manifest = api.stores['vm-a/main']!.first['manifest'] as Map;
      manifest['userConfig'] = {
        'token': {'required': true, 'sensitive': true},
      };
      expect(
        await controller.configure('vectra-echo', {'undeclared': 'secret'}),
        isFalse,
      );
      expect(
        await controller.configure('vectra-echo', {'token': 'secret'}),
        isTrue,
      );
      expect(await controller.approve('vectra-echo', oldConsent), isFalse);
      expect(
        await controller.approve(
          'vectra-echo',
          controller.reviewFingerprint('vectra-echo')!,
        ),
        isTrue,
      );
      final approval = api.requests.lastWhere(
        (row) => (row['pluginAction'] as Map?)?['action'] == 'trust',
      );
      expect((approval['pluginAction'] as Map)['permissions'], ['mcp:stdio']);
      expect((approval['pluginAction'] as Map)['expectedRevision'], 2);
      expect(await controller.setEnabled('vectra-echo', true), isTrue);
      expect(
        await controller.attach('vectra-echo', 'echo', 'foreign'),
        isFalse,
      );
      expect(
        await controller.attach('vectra-echo', 'echo', 'chat-main'),
        isTrue,
      );
      expect(
        await controller.bindingAction(
          'vectra-echo',
          'chat-main',
          'verify',
          tool: 'echo-tool',
        ),
        isFalse,
      );
      expect(
        await controller.bindingAction(
          'vectra-echo',
          'chat-main',
          'verify',
          tool: 'arbitrary',
          consent: true,
        ),
        isFalse,
      );
      expect(
        await controller.bindingAction(
          'vectra-echo',
          'chat-main',
          'verify',
          tool: 'echo-tool',
          consent: true,
        ),
        isTrue,
      );
      expect(controller.bindings['chat-main']['status'], 'ready');
    },
  );

  test(
    'required configuration gates enable even after permission approval',
    () async {
      final row = installed(trusted: true);
      (row['manifest'] as Map)['userConfig'] = {
        'token': {'required': true},
      };
      api.stores['vm-a/main'] = [row];
      await controller.load();
      expect(controller.plugin('vectra-echo')!.missingConfiguration, ['token']);
      expect(await controller.setEnabled('vectra-echo', true), isFalse);
    },
  );

  test('a catalog ID collision cannot approve, enable, attach or verify', () async {
    api.stores['vm-a/main'] = [
      {...installed(trusted: true, enabled: true), 'activeDigest': 'b' * 64},
    ];
    await controller.load(initialInstanceId: 'vm-a');
    expect(controller.plugin('vectra-echo')!.reviewedInstallation, isFalse);
    expect(controller.reviewFingerprint('vectra-echo'), isNull);
    expect(await controller.setEnabled('vectra-echo', true), isFalse);
    expect(await controller.attach('vectra-echo', 'echo', 'chat-main'), isFalse);
  });

  test(
    'VM inventory is authoritative, including non-catalog plugins',
    () async {
      api.stores['vm-a/main'] = [
        {...installed(), 'id': 'private-plugin'},
      ];
      await controller.load();
      expect(
        controller.plugins.where((p) => p.installed != null).single.id,
        'private-plugin',
      );
      api.failStatus = true;
      await controller.refreshInventory();
      expect(controller.inventoryKnown, isFalse);
      expect(controller.inventory, isEmpty);
      expect(controller.canAct, isFalse);
      expect(controller.targetError, contains('Older runtimes'));
    },
  );

  test(
    'catalog failure stays independent of successful inventory refresh',
    () async {
      api.failCatalog = true;
      await controller.load();
      expect(controller.catalogError, isNotNull);
      expect(controller.inventoryKnown, isTrue);
      await controller.refreshInventory();
      expect(controller.catalogError, isNotNull);
      api.failCatalog = false;
      await controller.loadCatalog();
      expect(controller.catalogError, isNull);
    },
  );

  test(
    'unsupported runtime, missing owned target, and empty bots never call VM actions',
    () async {
      await controller.load(initialInstanceId: 'legacy');
      expect(controller.supported, isFalse);
      expect(api.requests, isEmpty);
      await controller.selectWorkspace('not-owned');
      expect(controller.instanceId, isNull);
      expect(api.requests, isEmpty);
      api.botRows = [];
      await controller.selectWorkspace('vm-a');
      expect(controller.botId, isNull);
      expect(api.requests, isEmpty);
    },
  );

  test(
    'bot ABA switch discards late inventory, conversations and consent',
    () async {
      api.stores['vm-a/main'] = [installed()];
      await controller.load();
      final consent = controller.reviewFingerprint('vectra-echo')!;
      final lateStatus = Completer<Map<String, dynamic>>();
      final lateConversations = Completer<Map<String, dynamic>>();
      api.pendingStatus = (_, _) => lateStatus.future;
      api.pendingConversations = (_, _) => lateConversations.future;
      final oldStatus = controller.refreshInventory();
      final oldConversations = controller.loadConversations();
      api.pendingStatus = null;
      api.pendingConversations = null;
      await controller.selectBot('other');
      expect(controller.inventory, isEmpty);
      expect(controller.notice, isNull);
      await controller.selectBot('main');
      lateStatus.complete({
        'inventory': {
          'plugins': [
            {...installed(), 'id': 'stale'},
          ],
        },
      });
      lateConversations.complete({
        'conversations': [
          {'botId': 'main', 'sessionId': 'stale'},
        ],
      });
      await Future.wait([oldStatus, oldConversations]);
      expect(controller.plugin('stale'), isNull);
      expect(controller.conversations.single['sessionId'], 'chat-main');
      expect(await controller.approve('vectra-echo', consent), isFalse);
    },
  );

  test(
    'late mutation completion cannot refresh or notify a different VM',
    () async {
      await controller.load();
      api.pendingAction = Completer<Map<String, dynamic>>();
      final installing = controller.install('vectra-echo');
      expect(controller.busy, isTrue);
      await controller.selectWorkspace('vm-b');
      final count = api.requests.length;
      api.pendingAction!.complete({});
      expect(await installing, isFalse);
      expect(api.requests.length, count);
      expect(controller.instanceId, 'vm-b');
      expect(controller.notice, isNull);
      expect(controller.inventory, isEmpty);
    },
  );

  test(
    'configuration errors never echo server secrets and require refresh after unknown outcomes',
    () async {
      final row = installed();
      (row['manifest'] as Map)['userConfig'] = {
        'token': {'required': true},
      };
      api.stores['vm-a/main'] = [row];
      await controller.load();
      api.failAction = true;
      expect(
        await controller.configure('vectra-echo', {
          'token': 'secret-value-should-not-appear',
        }),
        isFalse,
      );
      expect(
        controller.actionError,
        isNot(contains('secret-value-should-not-appear')),
      );
      expect(controller.canAct, isFalse);
      await controller.refreshInventory();
      expect(controller.canAct, isTrue);
    },
  );

  testWidgets(
    'Marketplace search, installed filter, local icons and details fit a narrow screen',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      api.stores['vm-a/main'] = [installed()];
      api.entries = [
        {
          ...echoCatalog(),
          'publisher': 'Vectra',
          'category': 'Developer tools',
        },
      ];
      await controller.load();
      await tester.pumpWidget(
        MaterialApp(
          theme: Vc.dark(),
          home: Scaffold(body: MarketplaceBrowser(controller: controller)),
        ),
      );
      await tester.enterText(find.byType(TextField).first, 'not found');
      await tester.pump();
      await scrollTo(tester, find.text('No plugins match your search.'), 250);
      expect(find.text('No plugins match your search.'), findsOneWidget);
      await scrollTo(tester, find.byType(TextField).first, -250);
      await tester.enterText(find.byType(TextField).first, 'vectra');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await scrollTo(tester, find.text('Installed'), 100);
      await tester.tap(find.text('Installed'));
      await tester.pump();
      await scrollTo(tester, find.text('Echo MCP'), 250);
      expect(find.byType(Image), findsNothing);
      await tester.tap(find.text('Echo MCP'));
      await tester.pumpAndSettle();
      expect(find.text('Plugin details'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'detail target switch clears write-only input and permission consent',
    (tester) async {
      final row = installed();
      (row['manifest'] as Map)['userConfig'] = {
        'token': {'required': true},
      };
      api.stores['vm-a/main'] = [row];
      api.stores['vm-a/other'] = [installed()];
      await controller.load();
      await tester.pumpWidget(
        MaterialApp(
          theme: Vc.dark(),
          home: MarketplaceDetail(
            controller: controller,
            pluginId: 'vectra-echo',
          ),
        ),
      );
      final field = find.byKey(const ValueKey('config-token'));
      await scrollTo(tester, field, 300);
      await tester.enterText(field, 'never-carry-this');
      final checkbox = find.byType(CheckboxListTile).first;
      await scrollTo(tester, checkbox, 250);
      await tester.tap(checkbox);
      await tester.pump();
      expect(tester.widget<CheckboxListTile>(checkbox).value, isTrue);
      await controller.selectBot('other');
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byType(CheckboxListTile).first, -200);
      expect(
        tester
            .widget<CheckboxListTile>(find.byType(CheckboxListTile).first)
            .value,
        isFalse,
      );
      expect(find.text('never-carry-this'), findsNothing);
      expect(controller.conversations.single['sessionId'], 'chat-other');
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'catalog target and unsupported authentication do not claim support',
    () async {
      api.entries = [
        {
          ...echoCatalog(),
          'targets': ['supercharge-desktop'],
        },
      ];
      await controller.load();
      expect(await controller.install('vectra-echo'), isFalse);
      api.entries = [
        {...echoCatalog(), 'auth': 'oauth'},
      ];
      api.stores['vm-a/main'] = [installed(trusted: true)];
      await controller.loadCatalog();
      await controller.refreshInventory();
      expect(
        controller.plugin('vectra-echo')!.authenticationSupported,
        isFalse,
      );
      expect(await controller.setEnabled('vectra-echo', true), isFalse);
    },
  );

  testWidgets(
    'drawer Marketplace destination keeps selected owned VM and bot',
    (tester) async {
      final session = SessionController(apiBase: api.baseUrl)..client = api;
      await session.workspaces.refresh();
      final router = GoRouter(
        initialLocation: '/chat/vm-a?bot=other',
        routes: [
          GoRoute(
            path: '/chat/:id',
            builder: (_, _) => AppScaffold(
              currentInstanceId: 'vm-a',
              appBar: AppBar(title: const Text('Chats')),
              body: const SizedBox(),
            ),
          ),
          GoRoute(
            path: '/marketplace',
            builder: (_, state) => MarketplaceScreen(
              initialInstanceId: state.uri.queryParameters['instance'],
              initialBotId: state.uri.queryParameters['bot'],
            ),
          ),
        ],
      );
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: session,
          child: MaterialApp.router(theme: Vc.dark(), routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Marketplace'));
      await tester.pumpAndSettle();
      final location = GoRouterState.of(
        tester.element(find.byType(MarketplaceScreen)),
      ).uri;
      expect(location.path, '/marketplace');
      expect(location.queryParameters, {'instance': 'vm-a', 'bot': 'other'});
      expect(find.text('Give your bot new tools'), findsOneWidget);
      expect(api.requests.last['bot'], 'other');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      router.dispose();
      session.dispose();
    },
  );

  testWidgets(
    'Managed MCP settings still work and discard bot consent and configuration',
    (tester) async {
      final row = installed();
      (row['manifest'] as Map)['userConfig'] = {
        'token': {'required': true},
      };
      api.stores['vm-a/main'] = [row];
      api.stores['vm-a/other'] = [installed()];
      await tester.pumpWidget(
        MaterialApp(
          theme: Vc.dark(),
          home: Scaffold(
            body: ListView(
              children: [
                ManagedMcpSection(
                  api: api,
                  instanceId: 'vm-a',
                  superchargeRuntime: true,
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final config = find.widgetWithText(
        TextField,
        'Configuration values (JSON object)',
      );
      await scrollTo(tester, config, 250);
      await tester.enterText(config, '{"token":"private"}');
      final checkbox = find.byType(CheckboxListTile);
      await scrollTo(tester, checkbox, 150);
      await tester.tap(checkbox);
      await tester.pump();
      expect(tester.widget<CheckboxListTile>(checkbox).value, isTrue);
      await scrollTo(
        tester,
        find.byType(DropdownButtonFormField<String>).first,
        -300,
      );
      await tester.tap(find.text('Main').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('other').last);
      await tester.pumpAndSettle();
      await scrollTo(tester, find.byType(CheckboxListTile), 250);
      expect(
        tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value,
        isFalse,
      );
      expect(find.textContaining('private'), findsNothing);
      expect(api.requests.last['bot'], 'other');
      await tester.pumpWidget(const SizedBox());
    },
  );

  test(
    'discovery is independent of reviewed catalog, inventory and actions',
    () async {
      (api.discoveryResponse['discovery'] as Map)['plugins'] = [
        discoveryEntry(),
        discoveryEntry(id: 'vectra-echo'),
        {'id': 'incomplete'},
      ];
      api.failCatalog = true;
      await controller.load();
      expect(controller.catalogError, isNotNull);
      expect(controller.discovery, hasLength(2));
      expect(controller.plugin('community-echo'), isNull);
      expect(controller.plugin('vectra-echo'), isNull);
      expect(await controller.install('community-echo'), isFalse);
      expect(await controller.install('vectra-echo'), isFalse);
      expect(await controller.approve('community-echo', 'anything'), isFalse);
      expect(
        await controller.configure('community-echo', {'token': 'x'}),
        isFalse,
      );
      expect(await controller.setEnabled('community-echo', true), isFalse);
      expect(
        await controller.attach('community-echo', 'echo', 'chat-main'),
        isFalse,
      );
      expect(api.requests.where((row) => row['action'] != 'status'), isEmpty);

      api.failCatalog = false;
      api.failDiscovery = true;
      await controller.load();
      expect(controller.discoveryError, isNotNull);
      expect(controller.discovery, isEmpty);
      expect(controller.plugin('vectra-echo')!.digest, 'a' * 64);
      expect(controller.catalogError, isNull);
      expect(await controller.install('vectra-echo'), isTrue);
      expect(
        api.requests
            .where((row) => row['action'] == 'installCatalog')
            .single['catalogId'],
        'vectra-echo',
      );
      api.failDiscovery = false;
      await controller.loadDiscovery();
      expect(controller.discovery, hasLength(2));
      expect(controller.discoveryError, isNull);
    },
  );

  testWidgets('browse-only discovery searches categories without VM actions', (
    tester,
  ) async {
    (api.discoveryResponse['discovery'] as Map)['plugins'] = [discoveryEntry()];
    await controller.load();
    await tester.pumpWidget(
      MaterialApp(
        theme: Vc.dark(),
        home: Scaffold(body: MarketplaceBrowser(controller: controller)),
      ),
    );
    await tester.enterText(find.byType(TextField).first, 'community tools');
    await tester.pump();
    await scrollTo(tester, find.text('Community Echo'), 250);
    expect(find.text('Browse only — not supported in VM'), findsOneWidget);
    await tester.tap(find.text('Community Echo'));
    await tester.pumpAndSettle();
    expect(find.textContaining('not a reviewed release'), findsOneWidget);
    expect(find.text('Open source link'), findsOneWidget);
    expect(find.textContaining('openai/plugins @'), findsOneWidget);
    expect(find.text('Install in selected bot VM'), findsNothing);
    expect(find.text('Configure'), findsNothing);
    expect(find.text('Attach'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Installed'), -250);
    await tester.tap(find.text('Installed'));
    await tester.pump();
    expect(find.text('Community Echo'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('loading, unsupported and empty inventory states are explicit', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: Vc.dark(),
        home: Scaffold(body: MarketplaceBrowser(controller: controller)),
      ),
    );
    expect(find.byType(LinearProgressIndicator), findsWidgets);
    await controller.load(initialInstanceId: 'legacy');
    await tester.pump();
    await scrollTo(tester, find.textContaining('Unsupported runtime.'), 200);
    expect(find.textContaining('Unsupported runtime.'), findsOneWidget);
    await controller.selectWorkspace('vm-a');
    await tester.pump();
    await scrollTo(tester, find.text('Installed'), -200);
    await tester.tap(find.text('Installed'));
    await tester.pump();
    await scrollTo(tester, find.textContaining('No plugins installed'), 200);
    expect(find.textContaining('No plugins installed'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
