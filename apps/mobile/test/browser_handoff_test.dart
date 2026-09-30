import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:vectra_cloud/api/client.dart';
import 'package:vectra_cloud/chat/browser_handoff.dart';

Map<String, dynamic> _status(bool busy, {List<Object?> tasks = const []}) => {
  'turn': {'busy': busy},
  'backgroundTasks': tasks,
};

class _Client extends VectraClient {
  _Client() : super(baseUrl: 'https://example.test');

  final calls = <String>[];
  final statuses = <Map<String, dynamic>>[];
  Map<String, dynamic> computer = {'handoff': false};
  DateTime expiry = DateTime.now().add(const Duration(minutes: 10));
  Object? computerFailure;
  Object? statusFailure;
  Object? stopFailure;
  Object? startFailure;
  Object? releaseFailure;
  Completer<DateTime>? pendingStart;
  Completer<void>? pendingRelease;
  Completer<Map<String, dynamic>>? pendingStatus;

  @override
  Future<Map<String, dynamic>> computerStatus(String id) async {
    calls.add('computer');
    if (computerFailure != null) throw computerFailure!;
    return computer;
  }

  @override
  Future<Map<String, dynamic>> chatStatus(
    String id, {
    String? sessionId,
  }) async {
    if (statusFailure != null) {
      calls.add('status:error');
      throw statusFailure!;
    }
    if (pendingStatus != null) {
      calls.add('status:pending');
      return pendingStatus!.future;
    }
    final result = statuses.isEmpty ? _status(false) : statuses.removeAt(0);
    final turn = result['turn'];
    calls.add('status:${turn is Map ? turn['busy'] : 'missing'}');
    return result;
  }

  @override
  Future<void> stopChat(String id, {String? botId, String? chatId}) async {
    calls.add('stop');
    if (stopFailure != null) throw stopFailure!;
  }

  @override
  Future<DateTime> startBrowserHandoff(
    String id, {
    required String handoffId,
    String? botId,
    String? sessionId,
    int minutes = 10,
  }) async {
    calls.add('start');
    if (startFailure != null) throw startFailure!;
    return pendingStart == null ? expiry : pendingStart!.future;
  }

  @override
  Future<void> stopBrowserHandoff(
    String id, {
    required String handoffId,
  }) async {
    calls.add('release');
    if (releaseFailure != null) throw releaseFailure!;
    if (pendingRelease != null) await pendingRelease!.future;
  }
}

Future<void> _flush() => Future<void>.delayed(Duration.zero);

void main() {
  late _Client api;
  late BrowserHandoffController controller;
  late List<String> prompts;
  Object? suspendFailure;
  Object? continueFailure;

  BrowserHandoffController create({
    Duration pollInterval = Duration.zero,
    Duration pollTimeout = const Duration(seconds: 12),
    DateTime Function()? now,
  }) {
    return BrowserHandoffController(
      api: api,
      instanceId: 'instance-1',
      suspendViewer: () async {
        api.calls.add('suspend');
        if (suspendFailure != null) throw suspendFailure!;
      },
      continueChat: (prompt) async {
        api.calls.add('continue');
        prompts.add(prompt);
        if (continueFailure != null) throw continueFailure!;
      },
      pollInterval: pollInterval,
      pollTimeout: pollTimeout,
      now: now,
    );
  }

  setUp(() {
    api = _Client();
    prompts = [];
    suspendFailure = null;
    continueFailure = null;
    controller = create();
  });

  tearDown(() => controller.dispose());

  test(
    'watching close suspends the viewer without stopping or releasing AI',
    () async {
      expect(controller.phase, BrowserHandoffPhase.watching);
      expect(controller.hasControl, isFalse);
      expect(controller.busy, isFalse);
      await controller.returnControl();
      expect(api.calls, isEmpty);
      await controller.close();
      expect(api.calls, ['suspend']);
      expect(prompts, isEmpty);
      await controller.takeControl();
      expect(api.calls, ['suspend']);
    },
  );

  test(
    'takeover suspends, reads state, stops, waits idle, starts, verifies idle',
    () async {
      api.statuses.addAll([
        _status(true),
        _status(true),
        _status(false),
        _status(false),
      ]);
      final phases = <BrowserHandoffPhase>[];
      controller.addListener(() => phases.add(controller.phase));

      await controller.takeControl();

      expect(api.calls, [
        'suspend',
        'computer',
        'status:true',
        'stop',
        'status:true',
        'status:false',
        'start',
        'status:false',
      ]);
      expect(phases.first, BrowserHandoffPhase.takingControl);
      expect(phases.last, BrowserHandoffPhase.controlling);
      expect(controller.hasControl, isTrue);
      expect(controller.canContinue, isTrue);
      expect(controller.busy, isFalse);
      expect(controller.expiresAt, api.expiry);
      expect(controller.error, isNull);
      expect(prompts, isEmpty);
    },
  );

  test('idle foreground is still stopped before acquisition', () async {
    await controller.takeControl();
    expect(api.calls, [
      'suspend',
      'computer',
      'status:false',
      'stop',
      'status:false',
      'start',
      'status:false',
    ]);
  });

  test(
    'return without resuming releases input but sends no continuation',
    () async {
      await controller.takeControl();
      expect(controller.hasControl, isTrue);
      await controller.returnControl(notes: 'Signed in', continueTask: false);
      expect(controller.hasControl, isFalse);
      expect(api.calls.last, 'release');
      expect(prompts, isEmpty);
    },
  );

  test('duplicate takeovers do not acquire twice', () async {
    await Future.wait([controller.takeControl(), controller.takeControl()]);
    expect(api.calls.where((call) => call == 'start'), hasLength(1));
    expect(api.calls.where((call) => call == 'stop'), hasLength(1));
  });

  test(
    'another viewer handoff blocks takeover before stopping the AI',
    () async {
      api.computer = {'handoff': true};
      await controller.takeControl();
      expect(api.calls, ['suspend', 'computer']);
      expect(controller.phase, BrowserHandoffPhase.watching);
      expect(controller.hasControl, isFalse);
      expect(controller.error, contains('Another viewer'));
    },
  );

  for (final badComputer in <Map<String, dynamic>>[
    {},
    {'handoff': null},
    {'handoff': 'false'},
  ]) {
    test(
      'missing or malformed handoff status fails closed: $badComputer',
      () async {
        api.computer = badComputer;
        await controller.takeControl();
        expect(api.calls, ['suspend', 'computer']);
        expect(controller.hasControl, isFalse);
        expect(controller.phase, BrowserHandoffPhase.watching);
        expect(controller.error, isNotNull);
      },
    );
  }

  test(
    'unavailable computer status leaves watching without stop/start',
    () async {
      api.computerFailure = ApiException(404, 'Unavailable');
      await controller.takeControl();
      expect(api.calls, ['suspend', 'computer']);
      expect(controller.error, contains('Unavailable'));
      expect(controller.hasControl, isFalse);
    },
  );

  for (final badStatus in <Map<String, dynamic>>[
    {},
    {'turn': {}},
    {
      'turn': {'busy': null},
    },
    {
      'turn': {'busy': 'false'},
    },
    {
      'turn': {'busy': false},
      'backgroundTasks': 'unknown',
    },
  ]) {
    test(
      'unreadable before status never stops or acquires: $badStatus',
      () async {
        api.statuses.add(badStatus);
        await controller.takeControl();
        expect(api.calls, isNot(contains('stop')));
        expect(api.calls, isNot(contains('start')));
        expect(controller.hasControl, isFalse);
        expect(controller.error, isNotNull);
      },
    );
  }

  test('nonempty background tasks conservatively block takeover', () async {
    api.statuses.add(
      _status(
        false,
        tasks: [
          {'id': 'background-1'},
        ],
      ),
    );
    await controller.takeControl();
    expect(api.calls, isNot(contains('stop')));
    expect(api.calls, isNot(contains('start')));
    expect(controller.error, contains('Background tasks'));
  });

  test('another bot working prevents takeover without stopping it', () async {
    controller.dispose();
    controller = BrowserHandoffController(
      api: api,
      instanceId: 'instance-1',
      botId: 'research',
      chatId: 'chat-research',
      suspendViewer: () async => api.calls.add('suspend'),
      continueChat: (_) async {},
    );
    api.statuses.add({
      ..._status(false),
      'activeBotChats': ['chat-main'],
      'queuedBotChats': [],
    });
    await controller.takeControl();
    expect(api.calls, isNot(contains('stop')));
    expect(api.calls, isNot(contains('start')));
    expect(controller.hasControl, isFalse);
    expect(controller.error, contains('Another agent'));
  });

  test('chat status error fails closed', () async {
    api.statusFailure = ApiException(503, 'Status unavailable');
    await controller.takeControl();
    expect(controller.phase, BrowserHandoffPhase.watching);
    expect(controller.error, contains('Status unavailable'));
    expect(api.calls, isNot(contains('stop')));
  });

  test('failed foreground stop never starts handoff', () async {
    api.stopFailure = ApiException(502, 'Stop unconfirmed');
    await controller.takeControl();
    expect(api.calls, ['suspend', 'computer', 'status:false', 'stop']);
    expect(controller.hasControl, isFalse);
    expect(controller.error, contains('Stop unconfirmed'));
  });

  test('missing idle state after stop prevents handoff', () async {
    api.statuses.addAll([
      _status(true),
      {'turn': {}},
    ]);
    await controller.takeControl();
    expect(api.calls, contains('stop'));
    expect(api.calls, isNot(contains('start')));
    expect(controller.hasControl, isFalse);
    expect(controller.phase, BrowserHandoffPhase.watching);
  });

  for (final status in [404, 500]) {
    test(
      'handoff start $status never grants input or requests continuation',
      () async {
        api.startFailure = ApiException(status, 'Start refused');
        await controller.takeControl();
        expect(controller.phase, BrowserHandoffPhase.watching);
        expect(controller.hasControl, isFalse);
        expect(controller.expiresAt, isNull);
        expect(controller.error, contains('Start refused'));
        expect(controller.error, contains('AI remains stopped'));
        expect(controller.canContinue, isFalse);
        await controller.close();
        expect(api.calls, isNot(contains('release')));
        expect(prompts, isEmpty);
      },
    );
  }

  for (final afterStart in <Map<String, dynamic>>[
    _status(true),
    {},
    _status(
      false,
      tasks: [
        {'id': 'new-background-task'},
      ],
    ),
  ]) {
    test(
      'failed post-start check retains a releasable lease: $afterStart',
      () async {
        api.statuses.addAll([_status(false), _status(false), afterStart]);
        await controller.takeControl();
        expect(controller.phase, BrowserHandoffPhase.watching);
        expect(controller.hasControl, isTrue);
        expect(controller.canContinue, isFalse);
        expect(controller.expiresAt, api.expiry);
        expect(controller.error, isNotNull);
        await controller.returnControl();
        expect(api.calls.sublist(api.calls.length - 2), ['suspend', 'release']);
        expect(controller.hasControl, isFalse);
        expect(controller.canContinue, isFalse);
        expect(prompts, isEmpty);
      },
    );
  }

  test(
    'close waits for pending acquisition and releases without granting input',
    () async {
      api.pendingStart = Completer<DateTime>();
      final phases = <BrowserHandoffPhase>[];
      controller.addListener(() => phases.add(controller.phase));
      final taking = controller.takeControl();
      await _flush();
      expect(api.calls.last, 'start');
      expect(controller.busy, isTrue);
      final closing = controller.close();
      expect(api.calls, isNot(contains('release')));
      api.pendingStart!.complete(api.expiry);
      await Future.wait([taking, closing]);
      expect(api.calls.sublist(api.calls.length - 2), ['suspend', 'release']);
      expect(phases, isNot(contains(BrowserHandoffPhase.controlling)));
      expect(controller.hasControl, isFalse);
      expect(prompts, isEmpty);
    },
  );

  test('suspension failure prevents remote stop and takeover', () async {
    suspendFailure = StateError('Viewer could not disconnect');
    await controller.takeControl();
    expect(api.calls, ['suspend']);
    expect(controller.error, contains('Viewer could not disconnect'));
    expect(controller.hasControl, isFalse);
  });

  test(
    'normal return suspends then confirms release before continuing once',
    () async {
      api.statuses.addAll([_status(true), _status(false), _status(false)]);
      await controller.takeControl();
      api.calls.clear();
      api.pendingRelease = Completer<void>();
      final returning = controller.returnControl(
        notes: 'Logged in and selected the report.',
      );
      await _flush();
      expect(api.calls, ['suspend', 'release']);
      expect(controller.phase, BrowserHandoffPhase.returningControl);
      expect(controller.hasControl, isTrue);
      expect(prompts, isEmpty);
      api.pendingRelease!.complete();
      await returning;
      expect(api.calls, ['suspend', 'release', 'continue']);
      expect(controller.phase, BrowserHandoffPhase.watching);
      expect(controller.hasControl, isFalse);
      expect(controller.expiresAt, isNull);
      expect(prompts.single, contains('SAME E2B desktop and browser session'));
      expect(prompts.single, contains('desktop_observe'));
      expect(prompts.single, contains('active window, tab and desktop state'));
      expect(prompts.single, contains('fresh screenshot'));
      expect(prompts.single, contains('original task'));
      expect(prompts.single, contains('automatically replay'));
      expect(prompts.single, contains('other secrets'));
      expect(prompts.single, contains('Logged in and selected the report.'));
      expect(prompts.single, contains('running task was interrupted'));
      await controller.returnControl();
      expect(prompts, hasLength(1));
    },
  );

  test(
    'failed release keeps ownership with disabled input and retries safely',
    () async {
      await controller.takeControl();
      api.calls.clear();
      api.releaseFailure = ApiException(502, 'Release unconfirmed');
      await controller.returnControl();
      expect(api.calls, ['suspend', 'release']);
      expect(controller.phase, BrowserHandoffPhase.watching);
      expect(controller.hasControl, isTrue);
      expect(controller.expiresAt, api.expiry);
      expect(controller.error, contains('Release unconfirmed'));
      expect(prompts, isEmpty);
      api.releaseFailure = null;
      await controller.returnControl(notes: 'Completed the form.');
      expect(api.calls, [
        'suspend',
        'release',
        'suspend',
        'release',
        'continue',
      ]);
      expect(controller.hasControl, isFalse);
      expect(prompts, hasLength(1));
    },
  );

  test('failed viewer suspension does not release or resume', () async {
    await controller.takeControl();
    api.calls.clear();
    suspendFailure = StateError('Socket still active');
    await controller.returnControl();
    expect(api.calls, ['suspend']);
    expect(controller.hasControl, isTrue);
    expect(controller.phase, BrowserHandoffPhase.watching);
    expect(prompts, isEmpty);
    suspendFailure = null;
    await controller.returnControl();
    expect(api.calls, ['suspend', 'suspend', 'release', 'continue']);
  });

  test('forced close retries failed release without ever continuing', () async {
    await controller.takeControl();
    api.calls.clear();
    api.releaseFailure = ApiException(503, 'Temporary failure');
    await controller.close();
    expect(controller.hasControl, isTrue);
    expect(controller.error, contains('Temporary failure'));
    api.releaseFailure = null;
    await controller.close();
    expect(api.calls, ['suspend', 'release', 'suspend', 'release']);
    expect(controller.hasControl, isFalse);
    expect(prompts, isEmpty);
    await controller.takeControl();
    expect(api.calls, isNot(contains('start')));
  });

  test('close during a pending return suppresses the new turn', () async {
    await controller.takeControl();
    api.pendingRelease = Completer<void>();
    final returning = controller.returnControl();
    await _flush();
    final closing = controller.close();
    api.pendingRelease!.complete();
    await Future.wait([returning, closing]);
    expect(controller.hasControl, isFalse);
    expect(prompts, isEmpty);
    expect(api.calls.where((call) => call == 'release'), hasLength(1));
  });

  test(
    'continuation failure clears ownership and is never automatically retried',
    () async {
      await controller.takeControl();
      continueFailure = ApiException(503, 'Reply lost');
      await Future.wait([
        controller.returnControl(),
        controller.returnControl(),
      ]);
      expect(controller.hasControl, isFalse);
      expect(controller.expiresAt, isNull);
      expect(controller.error, contains('will not be retried automatically'));
      expect(prompts, hasLength(1));
      await controller.returnControl();
      await controller.close();
      expect(prompts, hasLength(1));
      expect(api.calls.where((call) => call == 'release'), hasLength(1));
    },
  );

  testWidgets(
    'expiry disables input and releases without automatic continuation',
    (tester) async {
      controller.dispose();
      var now = DateTime.utc(2030);
      api.expiry = now.add(const Duration(seconds: 10));
      controller = create(now: () => now);
      await controller.takeControl();
      expect(controller.phase, BrowserHandoffPhase.controlling);
      api.calls.clear();
      now = now.add(const Duration(seconds: 10));
      await tester.pump(const Duration(seconds: 10));
      expect(api.calls, ['suspend', 'release']);
      expect(controller.phase, BrowserHandoffPhase.watching);
      expect(controller.hasControl, isFalse);
      expect(controller.error, contains('control expired'));
      expect(prompts, isEmpty);
      await controller.returnControl();
      expect(prompts, isEmpty);
    },
  );

  testWidgets('expired lease release can retry but cannot resume', (
    tester,
  ) async {
    controller.dispose();
    var now = DateTime.utc(2030);
    api.expiry = now.add(const Duration(seconds: 10));
    controller = create(now: () => now);
    await controller.takeControl();
    api.releaseFailure = ApiException(503, 'Unavailable');
    now = now.add(const Duration(seconds: 10));
    await tester.pump(const Duration(seconds: 10));
    expect(controller.hasControl, isTrue);
    expect(controller.phase, BrowserHandoffPhase.watching);
    expect(controller.error, contains('control expired'));
    api.releaseFailure = null;
    await controller.returnControl();
    expect(controller.hasControl, isFalse);
    expect(prompts, isEmpty);
  });

  testWidgets('idle polling times out at the injected deadline', (
    tester,
  ) async {
    controller.dispose();
    var now = DateTime.utc(2030);
    controller = create(
      now: () => now,
      pollInterval: const Duration(seconds: 1),
      pollTimeout: const Duration(seconds: 2),
    );
    api.statuses.addAll([_status(true), _status(true)]);
    final taking = controller.takeControl();
    await tester.pump();
    expect(api.calls.last, 'status:true');
    now = now.add(const Duration(seconds: 2));
    await tester.pump(const Duration(seconds: 2));
    await taking;
    expect(controller.phase, BrowserHandoffPhase.watching);
    expect(controller.error, contains('did not become idle'));
    expect(api.calls, isNot(contains('start')));
  });

  testWidgets('a hanging status read is bounded by the poll timeout', (
    tester,
  ) async {
    controller.dispose();
    var now = DateTime.utc(2030);
    controller = create(
      now: () => now,
      pollTimeout: const Duration(seconds: 2),
    );
    api.pendingStatus = Completer<Map<String, dynamic>>();
    final taking = controller.takeControl();
    await tester.pump();
    now = now.add(const Duration(seconds: 2));
    await tester.pump(const Duration(seconds: 2));
    await taking;
    expect(controller.phase, BrowserHandoffPhase.watching);
    expect(controller.hasControl, isFalse);
    expect(controller.error, contains('TimeoutException'));
    expect(api.calls, isNot(contains('stop')));
    api.pendingStatus!.complete(_status(false));
  });
}
