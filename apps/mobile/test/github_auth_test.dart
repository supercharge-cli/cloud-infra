import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/chat/github_auth.dart';
import 'package:vectra_cloud/chat/github_auth_dialog.dart';

class FakeGitHubClient extends VectraClient {
  FakeGitHubClient() : super(baseUrl: 'https://example.test');

  Map<String, dynamic> state = {'status': 'idle'};
  int reveals = 0;
  int standaloneStarts = 0;
  bool authorized = true;
  String? source;

  @override
  Future<Map<String, dynamic>> githubAuthStatus(String id) async => state;

  @override
  Future<Map<String, dynamic>> githubAuthStart(
    String id,
    String chatId,
    String requestId,
  ) async {
    expect(id, 'vm-1');
    expect(chatId, 'direct-1');
    expect(requestId.length, greaterThanOrEqualTo(8));
    return state = {
      'status': 'pending',
      'code': 'ABCD-1234',
      'expiresAt': DateTime.now().millisecondsSinceEpoch + 300000,
    };
  }

  @override
  Future<Map<String, dynamic>> githubAuthStartStandalone(
    String id,
    String requestId,
  ) async {
    expect(id, 'vm-1');
    expect(requestId.length, greaterThanOrEqualTo(8));
    standaloneStarts++;
    return state = {
      'status': 'pending',
      'code': 'ABCD-1234',
      'url': 'https://github.com/login/device',
    };
  }

  @override
  Future<Map<String, dynamic>> githubAuthDone(String id) async {
    if (!authorized) {
      throw ApiException(409, 'Complete authorization on GitHub first.');
    }
    return state = {'status': 'delivered', 'username': 'fixture-user'};
  }

  @override
  Future<Map<String, dynamic>> githubAuthCancel(String id) async =>
      state = {'status': 'cancelled'};

  @override
  Future<String> githubToken(
    String id,
    String chatId,
    String kind,
    String requestId,
  ) async {
    expect(chatId, 'direct-1');
    source = kind;
    reveals++;
    return 'gho_${'x' * 36}';
  }
}

void main() {
  testWidgets(
    'Connected VM shows status instead of another GitHub login prompt',
    (tester) async {
      final api = FakeGitHubClient()
        ..state = {'status': 'delivered', 'username': 'fixture-user'};
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: GitHubAuthConnection(api: api, instanceId: 'vm-1'),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('GitHub CLI connected'), findsOneWidget);
      expect(find.text('Connected as fixture-user'), findsOneWidget);
      expect(find.text('Connect GitHub CLI'), findsNothing);
      expect(api.standaloneStarts, 0);

      api.state = {'status': 'idle'};
      await tester.pump(const Duration(seconds: 30));
      await tester.pump();
      expect(find.text('Connect GitHub CLI'), findsOneWidget);
    },
  );

  testWidgets('Completed popup refreshes the workspace connection status', (
    tester,
  ) async {
    final api = FakeGitHubClient();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: GitHubAuthConnection(api: api, instanceId: 'vm-1'),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('workspace-github-login')));
    await tester.pumpAndSettle();
    expect(find.text('ABCD-1234'), findsOneWidget);
    await tester.tap(find.text('Verify connection'));
    await tester.pump();
    expect(find.textContaining('Done! GitHub connected'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('GitHub CLI connected'), findsOneWidget);
    expect(find.text('Connect GitHub CLI'), findsNothing);
    expect(api.standaloneStarts, 1);
  });

  testWidgets(
    'Standalone workspace popup starts without chat and verifies only after VM confirmation',
    (tester) async {
      final api = FakeGitHubClient()..authorized = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: GitHubAuthDialog(api: api, instanceId: 'vm-1'),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(api.standaloneStarts, 1);
      expect(find.text('ABCD-1234'), findsOneWidget);
      expect(find.text('Copy link'), findsOneWidget);
      await tester.tap(find.text('Verify connection'));
      await tester.pump();
      expect(find.textContaining('Complete authorization'), findsOneWidget);
      api.authorized = true;
      await tester.tap(find.text('Verify connection'));
      await tester.pump();
      expect(find.textContaining('Done! GitHub connected'), findsOneWidget);
      expect(api.reveals, 0);
    },
  );

  testWidgets(
    'GitHub CLI device code, Done, cancel and confirmed token disclosure',
    (tester) async {
      final api = FakeGitHubClient();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: GitHubAuthPanel(
              api: api,
              instanceId: 'vm-1',
              chatId: 'direct-1',
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.text('Connect GitHub CLI'));
      await tester.pump();
      expect(find.text('ABCD-1234'), findsOneWidget);
      expect(find.text('https://github.com/login/device'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      expect(find.text('Connect GitHub CLI'), findsOneWidget);
      await tester.tap(find.text('Connect GitHub CLI'));
      await tester.pump();
      await tester.tap(find.text('Done — verify in VM'));
      await tester.pump();
      expect(find.textContaining('verified as fixture-user'), findsOneWidget);
      await tester.tap(find.text('Show my GitHub MCP token in chat'));
      await tester.pumpAndSettle();
      expect(api.reveals, 0);
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Cancel'),
        ),
      );
      await tester.pumpAndSettle();
      expect(api.reveals, 0);
      await tester.tap(find.text('Show my GitHub CLI token in chat'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send token to this chat'));
      await tester.pumpAndSettle();
      expect(api.reveals, 1);
      expect(api.source, 'cli');
      expect(find.text('gho_${'x' * 36}'), findsOneWidget);
    },
  );
}
