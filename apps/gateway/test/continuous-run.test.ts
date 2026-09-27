import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cycleRequired, cycleThreshold, DEFAULT_CYCLE_MS, runContinuousCycle, type CycleDriver } from '../src/continuous-run';
import { LifecycleStore } from '../src/lifecycle-store';

const identity = { sandboxId:'sandbox-1', sessionId:'gateway-1', runtime:'supercharge' as const, workspaceRoot:'/home/user/workspace' };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'vectra-lifecycle-'));
  const store = new LifecycleStore(directory);
  let clock = Date.parse('2026-09-27T00:00:00Z');
  let state = 'running';
  let failPause = false;
  let failConnect = false;
  let busy = false;
  const originalStart = clock - DEFAULT_CYCLE_MS;
  const calls: string[] = [];
  await store.write({...identity, runStartedAt: originalStart, phase:'running', updatedAt:clock, cycleCount:0});
  const driver: CycleDriver = {
    info: async () => ({state, startedAt:new Date(originalStart)}),
    pause: async () => { calls.push('pause'); if (failPause) throw new Error('pause failed'); state = 'paused'; return true; },
    connect: async () => { calls.push('connect'); if (failConnect) throw new Error('resume failed'); state = 'running'; },
    maintenance: async (action) => { calls.push(action); if (action === 'interrupt') busy = false; return {busy}; },
    refreshTimeout: async () => { calls.push('timeout'); },
  };
  const options = { now:() => clock, sleep:async (ms:number) => { clock += ms; }, drainMs:1000 };
  return {store, directory, calls, driver, options,
    advance: (ms:number) => { clock += ms; },
    setState:(value:string) => {state=value;},
    busy:() => {busy=true;},
    failPause:(value:boolean) => {failPause=value;},
    failConnect:(value:boolean) => {failConnect=value;},
    cleanup:() => rm(directory, {recursive:true,force:true})};
}

test('does not wake an idle-paused sandbox, even after a day', async () => {
  const f = await fixture();
  try {
    f.setState('paused'); f.advance(25 * 60 * 60_000);
    assert.equal(await runContinuousCycle(f.store, identity, f.driver, f.options), null);
    assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});

test('confirmed pause/resume resets durable clock even if SDK startedAt stays unchanged', async () => {
  const f = await fixture();
  try {
    const first = await runContinuousCycle(f.store, identity, f.driver, f.options);
    assert.equal(first?.cycleCount, 1);
    assert.equal(first?.runStartedAt, f.options.now());
    assert.deepEqual(f.calls, ['drain','pause','connect','timeout','resume']);
    const restartedStore = new LifecycleStore(f.directory);
    assert.equal(await runContinuousCycle(restartedStore, identity, f.driver, f.options), null);
    f.advance(DEFAULT_CYCLE_MS);
    assert.equal((await runContinuousCycle(restartedStore, identity, f.driver, f.options))?.cycleCount, 2);
  } finally { await f.cleanup(); }
});

test('active work drains and gets explicit interruption before pause', async () => {
  const f = await fixture();
  try {
    f.busy();
    await runContinuousCycle(f.store, identity, f.driver, f.options);
    assert.ok(f.calls.indexOf('interrupt') > 0);
    assert.ok(f.calls.indexOf('interrupt') < f.calls.indexOf('pause'));
  } finally { await f.cleanup(); }
});

test('failed pause never resets clock or loses retry phase', async () => {
  const f = await fixture();
  try {
    const before = await f.store.read(identity.sandboxId);
    f.failPause(true);
    await assert.rejects(runContinuousCycle(f.store, identity, f.driver, f.options), /pause failed/);
    const failed = await f.store.read(identity.sandboxId);
    assert.equal(failed?.runStartedAt, before?.runStartedAt);
    assert.equal(failed?.phase,'draining');
    f.failPause(false);
    assert.equal((await runContinuousCycle(f.store, identity, f.driver, f.options))?.phase, 'running');
  } finally { await f.cleanup(); }
});

test('failed resume survives gateway restart without pausing twice', async () => {
  const f = await fixture();
  try {
    f.failConnect(true);
    await assert.rejects(runContinuousCycle(f.store, identity, f.driver, f.options), /resume failed/);
    assert.equal((await f.store.read(identity.sandboxId))?.phase,'resuming');
    f.failConnect(false);
    await runContinuousCycle(new LifecycleStore(f.directory), identity, f.driver, f.options);
    assert.equal(f.calls.filter((value) => value === 'pause').length,1);
    assert.equal((await f.store.read(identity.sandboxId))?.phase,'running');
  } finally { await f.cleanup(); }
});

test('shared journal lease prevents two concurrent pause cycles', async () => {
  const f = await fixture();
  try {
    await Promise.all([
      runContinuousCycle(f.store, identity, f.driver, f.options),
      runContinuousCycle(new LifecycleStore(f.directory), identity, f.driver, f.options),
    ]);
    assert.equal(f.calls.filter((value) => value === 'pause').length,1);
  } finally { await f.cleanup(); }
});

test('cycle threshold reserves margin before hard expiry', () => {
  assert.ok(cycleThreshold(25 * 60 * 60_000) <= 23.5 * 60 * 60_000);
  assert.equal(cycleRequired({state:'running'}, DEFAULT_CYCLE_MS, Date.now()), true);
  assert.equal(cycleRequired({state:'paused'}, DEFAULT_CYCLE_MS, Date.now()), false);
});
