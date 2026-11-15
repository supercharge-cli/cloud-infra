import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:vectra_cloud/widgets/ui.dart';

void main() {
  testWidgets('back closes the open conversation before showing exit', (
    tester,
  ) async {
    var conversationOpen = true;
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => StatefulBuilder(
            builder: (context, setState) => AppPopScope(
              isRoot: true,
              onBack: () {
                if (!conversationOpen) return false;
                setState(() => conversationOpen = false);
                return true;
              },
              child: Scaffold(
                body: Text(conversationOpen ? 'Conversation' : 'Chats'),
              ),
            ),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Chats'), findsOneWidget);
    expect(find.text('Leave Vectra?'), findsNothing);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Leave Vectra?'), findsOneWidget);
    await tester.tap(find.text('Stay'));
    await tester.pumpAndSettle();
    expect(find.text('Chats'), findsOneWidget);
  });

  testWidgets('back follows route history before asking to leave', (
    tester,
  ) async {
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => Scaffold(
            body: TextButton(
              onPressed: () => context.push('/chat'),
              child: const Text('Open'),
            ),
          ),
        ),
        GoRoute(
          path: '/chat',
          builder: (context, state) => const AppPopScope(
            isRoot: true,
            child: Scaffold(body: Text('Chat')),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Open'), findsOneWidget);
    expect(find.text('Leave Vectra?'), findsNothing);
  });
}
