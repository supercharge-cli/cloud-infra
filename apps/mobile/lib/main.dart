import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'api/models.dart';
import 'chat/notifications.dart';
import 'screens/account.dart';
import 'screens/billing.dart';
import 'screens/chat.dart';
import 'screens/instance_settings.dart';
import 'screens/instances.dart';
import 'screens/login.dart';
import 'state/session.dart';
import 'theme.dart';
import 'widgets/ui.dart';

const apiBase = String.fromEnvironment(
  'API_BASE',
  defaultValue: 'https://infra.xibeai.in',
);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(Vc.overlay);
  unawaited(TaskNotifications.init());
  runApp(const VectraApp());
}

class VectraApp extends StatefulWidget {
  const VectraApp({super.key});

  @override
  State<VectraApp> createState() => _VectraAppState();
}

class _VectraAppState extends State<VectraApp> {
  late final SessionController session;
  late final GoRouter router;

  @override
  void initState() {
    super.initState();
    session = SessionController(apiBase: apiBase);
    router = GoRouter(
      refreshListenable: session,
      redirect: (ctx, state) {
        if (!session.ready) return null;
        final loggingIn = state.matchedLocation == '/login';
        if (session.user == null) return loggingIn ? null : '/login';
        if (loggingIn) return '/';
        return null;
      },
      routes: [
        GoRoute(path: '/login', builder: (c, st) => const LoginScreen()),
        GoRoute(path: '/', builder: (c, st) => const InstancesScreen()),
        GoRoute(
          path: '/chat/:id',
          builder: (c, st) => ChatScreen(
            instanceId: st.pathParameters['id']!,
            instance: st.extra is CloudInstance ? st.extra as CloudInstance : null,
          ),
        ),
        GoRoute(
          path: '/instance/:id',
          builder: (c, st) => InstanceSettingsScreen(
            instanceId: st.pathParameters['id']!,
            instance: st.extra is CloudInstance ? st.extra as CloudInstance : null,
          ),
        ),
        GoRoute(
          path: '/billing',
          builder: (c, st) {
            final extra = st.extra;
            if (extra is BillingArgs) return BillingScreen(args: extra);
            if (extra is String) return BillingScreen(args: BillingArgs(instanceId: extra));
            return const BillingScreen();
          },
        ),
        GoRoute(path: '/account', builder: (c, st) => const AccountScreen()),
      ],
    );
    TaskNotifications.onOpenChat = (id) {
      router.go('/chat/$id');
    };
    session.load();
  }

  @override
  void dispose() {
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
            theme: Vc.dark(),
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
