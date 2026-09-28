import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function fixture(initial = 0) {
  let instances = initial;
  let lock: any = null;
  let sequence = 0;
  const collection = {
    async findOneAndUpdate(query: any, change: any) {
      if (lock && lock.expiresAt > query.expiresAt.$lte) throw { code: 11000 };
      lock = { _id: query._id, ...change.$set }; return lock;
    },
    async updateOne() {},
    async deleteOne(query: any) { if (lock?.token === query.token) lock = null; },
  };
  const source = readFileSync(new URL('./workspace-limit.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function('getDb', 'countInstancesForUser', 'randomUUID', `${js}; return { withWorkspaceCreation, requireWorkspaceSlot };`)(
    async () => ({ collection: () => collection }), async () => instances, () => `${++sequence}`,
  );
  return { api, add: () => instances++, reset: () => instances = 0 };
}

test('blocks a second workspace without invoking provisioner', async () => {
  const { api } = fixture(1);
  let provisioned = false;
  await assert.rejects(api.withWorkspaceCreation('user', async () => { provisioned = true; }), /already has a workspace/);
  assert.equal(provisioned, false);
});

test('concurrent create requests cannot provision two workspaces', async () => {
  const { api, add } = fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const first = api.withWorkspaceCreation('user', async () => { await pending; add(); return 'created'; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(api.withWorkspaceCreation('user', async () => 'duplicate'), /already in progress/);
  release(); assert.equal(await first, 'created');
  await assert.rejects(api.requireWorkspaceSlot('user'), /already has a workspace/);
});

test('failed creation releases its lock and permits retry', async () => {
  const { api } = fixture();
  await assert.rejects(api.withWorkspaceCreation('user', async () => { throw new Error('provision failed'); }), /provision failed/);
  assert.equal(await api.withWorkspaceCreation('user', async () => 'retry works'), 'retry works');
});
