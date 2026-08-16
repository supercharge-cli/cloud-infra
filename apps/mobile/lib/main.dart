import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'api/models.dart';
import 'screens/account.dart';
import 'screens/billing.dart';
import 'screens/chat.dart';
import 'screens/instance_settings.dart';
import 'screens/instances.dart';
import 'screens/login.dart';
import 'state/session.dart';

const apiBase = String.fromEnvironment(
  'API_BASE',
  defaultValue: 'http://127.0.0.1:3001',
);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(VectraApp());
}

class VectraApp extends StatelessWidget {
  VectraApp({super.key});

  final session = SessionController(apiBase: apiBase);

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: session..load(),
      child: Consumer<SessionController>(
        builder: (context, s, _) {
          final router = GoRouter(
            refreshListenable: s,
            redirect: (ctx, state) {
              if (!s.ready) return null;
              final loggingIn = state.matchedLocation == '/login';
              if (s.user == null) return loggingIn ? null : '/login';
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
                builder: (c, st) => BillingScreen(
                  instanceId: st.extra is String ? st.extra as String : null,
                ),
              ),
              GoRoute(path: '/account', builder: (c, st) => const AccountScreen()),
            ],
          );
          return MaterialApp.router(
            title: 'Vectra Cloud',
            theme: ThemeData(
              brightness: Brightness.dark,
              colorSchemeSeed: const Color(0xFF22C55E),
              useMaterial3: true,
            ),
            routerConfig: router,
          );
        },
      ),
    );
  }
}
