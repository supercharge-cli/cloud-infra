import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAfterKill, killWithPreStop, prepareMigration } from '../src/pre-stop';

function fixture(run: () => Promise<Record<string, unknown>>) {
  const calls: string[] = [];
  const errors: string[] = [];
  const sandbox = {
    commands: { run: async (command: string, options?: Record<string, unknown>) => {
      calls.push('pre-stop');
      assert.match(command, /--unix-socket \/home\/user\/\.superagent\/lifecycle\/pre-stop\.sock/);
      assert.match(command, /"reason":"terminate"/);
      assert.equal(options?.timeoutMs, 6_000);
      return run();
    } },
    kill: async () => { calls.push('kill'); },
  };
  return { sandbox, calls, errors, onFailure: (message: string) => errors.push(message) };
}

test('supercharge invokes local pre-stop before killing', async () => {
  const f = fixture(async () => ({ exitCode: 0, stdout: '{"v":1,"verdict":"ok"}' }));
  await killWithPreStop(f.sandbox, 'supercharge', f.onFailure);
  assert.deepEqual(f.calls, ['pre-stop', 'kill']);
  assert.deepEqual(f.errors, []);
});

test('migration invokes old-VM pre-stop before the final archive and only once', async () => {
  const f = fixture(async () => ({ exitCode: 0, stdout: '{"v":1,"verdict":"ok"}' }));
  const packed = await prepareMigration(f.sandbox, 'supercharge', async () => {
    f.calls.push('pack');
    return 'archive-with-flushed-state';
  }, f.onFailure);
  assert.equal(packed, 'archive-with-flushed-state');
  await f.sandbox.kill(); // Old VM kill after copy/switchover does not invoke pre-stop again.
  assert.deepEqual(f.calls, ['pre-stop', 'pack', 'kill']);
});

test('migration proceeds with a bounded wait after old-VM pre-stop failure or timeout', async () => {
  for (const run of [
    async (): Promise<Record<string, unknown>> => { throw new Error('unreachable'); },
    (): Promise<Record<string, unknown>> => new Promise(() => {}),
  ]) {
    const f = fixture(run);
    await prepareMigration(f.sandbox, 'supercharge', async () => { f.calls.push('pack'); }, f.onFailure, 10);
    assert.deepEqual(f.calls, ['pre-stop', 'pack']);
    assert.equal(f.errors.length, 1);
  }
});

test('DELETE retains the session and lifecycle record after provider kill failure, then retries', async () => {
  const sessions = new Map([['session-1', 'sandbox-1']]);
  const lifecycle = new Set(['sandbox-1']);
  const calls: string[] = [];
  let fail = true;
  const sandbox = {
    commands: { run: async () => { calls.push('pre-stop'); return { exitCode: 0, stdout: '{"v":1,"verdict":"ok"}' }; } },
    kill: async () => { calls.push('kill'); if (fail) throw new Error('provider unavailable'); },
    close: async () => { calls.push('close'); },
  };
  const forget = () => { calls.push('forget'); lifecycle.delete('sandbox-1'); sessions.delete('session-1'); };
  await assert.rejects(deleteAfterKill(sandbox, 'supercharge', forget), /provider unavailable/);
  assert.deepEqual(calls, ['pre-stop', 'kill']);
  assert.equal(sessions.get('session-1'), 'sandbox-1');
  assert.equal(lifecycle.has('sandbox-1'), true);
  fail = false;
  await deleteAfterKill(sandbox, 'supercharge', forget);
  assert.deepEqual(calls, ['pre-stop', 'kill', 'pre-stop', 'kill', 'forget', 'close']);
  assert.equal(sessions.has('session-1'), false);
  assert.equal(lifecycle.size, 0);
});

test('DELETE does not report success if provider kill is unavailable', async () => {
  let forgotten = false;
  await assert.rejects(deleteAfterKill({}, 'supercharge', () => { forgotten = true; }), /kill is unavailable/);
  assert.equal(forgotten, false);
});

test('non-supercharge sandbox skips pre-stop', async () => {
  const f = fixture(async () => { throw new Error('unexpected'); });
  await killWithPreStop(f.sandbox, 'xibecode', f.onFailure);
  assert.deepEqual(f.calls, ['kill']);
});

test('pre-stop failure and handler failure still kill', async () => {
  for (const run of [
    async () => { throw new Error('socket unavailable'); },
    async () => ({ exitCode: 7 }),
    async () => ({ exitCode: 0, stdout: '{"v":1,"verdict":"partial"}' }),
  ]) {
    const f = fixture(run);
    await killWithPreStop(f.sandbox, 'supercharge', f.onFailure);
    assert.deepEqual(f.calls, ['pre-stop', 'kill']);
    assert.equal(f.errors.length, 1);
  }
});

test('kill still happens if failure reporting throws', async () => {
  const f = fixture(async () => { throw new Error('socket unavailable'); });
  await assert.rejects(
    killWithPreStop(f.sandbox, 'supercharge', () => { throw new Error('logger unavailable'); }),
    /logger unavailable/,
  );
  assert.deepEqual(f.calls, ['pre-stop', 'kill']);
});

test('hung E2B command is bounded and kill follows timeout', async () => {
  const f = fixture(() => new Promise(() => {}));
  await killWithPreStop(f.sandbox, 'supercharge', f.onFailure, 10);
  assert.deepEqual(f.calls, ['pre-stop', 'kill']);
  assert.match(f.errors[0] || '', /timed out/);
});
