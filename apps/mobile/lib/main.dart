import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'api/models.dart';
import 'chat/notifications.dart';
import 'desktop.dart';
import 'desktop/native.dart';
import 'desktop/shell.dart';
import 'screens/account.dart';
import 'screens/billing.dart';
import 'screens/chat.dart';
import 'screens/chat_home.dart';
import 'screens/instance_settings.dart';
import 'screens/marketplace.dart';
import 'screens/workspace.dart';
import 'screens/instances.dart';
import 'screens/login.dart';
import 'screens/pollen_connected.dart';
import 'screens/pollen_hub.dart';
import 'state/session.dart';
import 'theme.dart';
import 'widgets/ui.dart';

const apiBase = String.fromEnvironment(
  'API_BASE',
  defaultValue: 'https://infra.xibeai.in',
);

/// Map `vectra://pollinations/connected?instance=` to a GoRouter path.
String? pollenAppPath(Uri? uri) {
  if (uri == null) return null;
  final raw = uri.toString().replaceAll(RegExp(r'\s+'), '');
  final parsed = Uri.tryParse(raw);
  if (parsed == null) return null;
  final blob = parsed.toString().toLowerCase();
  final looksPollen =
      parsed.scheme == 'vectra' &&
      (parsed.host.toLowerCase() == 'pollinations' ||
          blob.contains('pollinations/connected'));
  if (!looksPollen) return null;
  if (!blob.contains('connected')) return '/pollinations';
  final id = parsed.queryParameters['instance']?.trim() ?? '';
  if (id.isEmpty) return '/pollinations/connected';
  return '/pollinations/connected?instance=${Uri.encodeQueryComponent(id)}';
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  DesktopNative.initialize();
  SystemChrome.setSystemUIOverlayStyle(Vc.overlay);
  unawaited(TaskNotifications.init());
  runApp(const VectraApp());
}

class VectraApp extends StatefulWidget {
  const VectraApp({super.key});

  @override
  State<VectraApp> createState() => _VectraAppState();
}

class _VectraAppState extends State<VectraApp> with WidgetsBindingObserver {
  late final SessionController session;
  late final GoRouter router;
  late final AppLinks _appLinks;
  StreamSubscription<Uri>? _linkSub;
  Timer? _workspaceRefresh;
  bool _foreground = true;
  Uri? _pendingLink;

  @override
  void initState() {
    super.initState();
    session = SessionController(apiBase: apiBase);
    WidgetsBinding.instance.addObserver(this);
    _workspaceRefresh = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_foreground && session.user != null) {
        unawaited(session.workspaces.refresh(force: false));
      }
    });
    router = GoRouter(
      initialLocation: '/',
      overridePlatformDefaultLocation: true,
      refreshListenable: session,
      onException: (ctx, state, r) {
        final path =
            pollenAppPath(state.uri) ??
            pollenAppPath(Uri.tryParse(state.uri.toString()));
        r.go(path ?? '/');
      },
      redirect: (ctx, state) {
        final pollenPath = pollenAppPath(state.uri);
        if (pollenPath != null &&
            state.matchedLocation != '/pollinations/connected') {
          if (!session.ready || session.user == null) {
            _pendingLink = state.uri;
            return session.ready ? '/login' : null;
          }
          return pollenPath;
        }
        if (!session.ready) return null;
        final loggingIn = state.matchedLocation == '/login';
        if (session.user == null) return loggingIn ? null : '/login';
        if (loggingIn) {
          final pending = pollenAppPath(_pendingLink);
          if (pending != null) return pending;
          return '/';
        }
        return null;
      },
      routes: [
        GoRoute(path: '/login', builder: (c, st) => const LoginScreen()),
        ShellRoute(
          builder: (context, state, child) =>
              isDesktop ? DesktopShell(child: child) : child,
          routes: [
            GoRoute(path: '/', builder: (c, st) => const ChatHomeScreen()),
            GoRoute(
              path: '/marketplace',
              builder: (c, st) => MarketplaceScreen(
                key: ValueKey('marketplace-${st.uri.query}'),
                initialInstanceId: st.uri.queryParameters['instance'],
                initialBotId: st.uri.queryParameters['bot'],
              ),
            ),
            GoRoute(
              path: '/workspaces',
              builder: (c, st) => const InstancesScreen(),
            ),
            GoRoute(
              path: '/chat/:id',
              builder: (c, st) => ChatScreen(
                key: ValueKey('chat-${st.pathParameters['id']}'),
                instanceId: st.pathParameters['id']!,
                initialBotId: st.uri.queryParameters['bot'],
                initialSessionId: st.uri.queryParameters['thread'],
                showGroup:
                    st.uri.queryParameters['group'] == '1' ||
                    st.uri.queryParameters['bot'] == null,
                instance: st.extra is CloudInstance
                    ? st.extra as CloudInstance
                    : null,
              ),
            ),
            GoRoute(
              path: '/instance/:id',
              builder: (c, st) => InstanceSettingsScreen(
                key: ValueKey('settings-${st.pathParameters['id']}'),
                instanceId: st.pathParameters['id']!,
                instance: st.extra is CloudInstance
                    ? st.extra as CloudInstance
                    : null,
              ),
            ),
            GoRoute(
              path: '/instance/:id/files',
              builder: (c, st) => WorkspaceScreen(
                key: ValueKey('files-${st.pathParameters['id']}'),
                instanceId: st.pathParameters['id']!,
                instance: st.extra is CloudInstance
                    ? st.extra as CloudInstance
                    : null,
              ),
            ),
            GoRoute(
              path: '/pollinations',
              builder: (c, st) => const PollenHubScreen(),
            ),
            GoRoute(
              path: '/pollinations/connected',
              builder: (c, st) => PollenConnectedScreen(
                instanceId: st.uri.queryParameters['instance'] ?? '',
              ),
            ),
            GoRoute(
              path: '/billing',
              builder: (c, st) {
                final extra = st.extra;
                if (extra is BillingArgs) return BillingScreen(args: extra);
                if (extra is String) {
                  return BillingScreen(args: BillingArgs(instanceId: extra));
                }
                return const BillingScreen();
              },
            ),
            GoRoute(
              path: '/account',
              builder: (c, st) => const AccountScreen(),
            ),
          ],
        ),
      ],
    );
    TaskNotifications.onOpenChat = (id) {
      router.go('/chat/$id');
      if (isDesktop) unawaited(DesktopNative.focusWindow());
    };
    session.addListener(_flushPendingLink);
    _listenDeepLinks();
    session.load();
  }

  void _applyLink(Uri uri) {
    _pendingLink = uri;
    _flushPendingLink();
  }

  void _flushPendingLink() {
    if (!session.ready || session.user == null) return;
    final path = pollenAppPath(_pendingLink);
    if (path == null) return;
    _pendingLink = null;
    router.go(path);
  }

  Future<void> _listenDeepLinks() async {
    _appLinks = AppLinks();
    try {
      final initial = await _appLinks.getInitialLink();
      if (initial != null) _applyLink(initial);
    } catch (_) {}
    _linkSub = _appLinks.uriLinkStream.listen(_applyLink, onError: (_) {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground && session.user != null) {
      unawaited(session.workspaces.refresh());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _workspaceRefresh?.cancel();
    _linkSub?.cancel();
    session.removeListener(_flushPendingLink);
    session.dispose();
    router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: session,
      child: Consumer<SessionController>(
        builder: (context, s, _) {
          return MaterialApp.router(
            title: 'Vectra Cloud',
            theme: Vc.dark(desktop: isDesktop),
            scrollBehavior: const MaterialScrollBehavior().copyWith(
              scrollbars: isDesktop,
            ),
            routerConfig: router,
            builder: (context, child) {
              if (!s.ready) {
                return const AnnotatedRegion<SystemUiOverlayStyle>(
                  value: Vc.overlay,
                  child: Scaffold(
                    backgroundColor: Vc.bg,
                    body: BusyOverlay(message: 'Loading Vectra…'),
                  ),
                );
              }
              return AnnotatedRegion<SystemUiOverlayStyle>(
                value: Vc.overlay,
                child: child ?? const SizedBox.shrink(),
              );
            },
          );
        },
      ),
    );
  }
}
