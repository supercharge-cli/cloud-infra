import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function fixture() {
  const jobs: any[] = [];
  let seq = 0;
  const collection = { async findOne(query: any) { return jobs.find((row) => Object.entries(query).every(([key, value]) => row[key] === value)) ?? null; },
    async insertOne(row: any) { jobs.push(row); } };
  const source = readFileSync(new URL('./bot-jobs.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const deliveries: any[] = [];
  const api = new Function('getDb', 'getBot', 'nanoid', 'proxyInbox', `${js};return {createBotJob, deliverBotJob};`)(
    async () => ({ collection: () => collection }), async (_: unknown, id: string) => ['main', 'alpha', 'beta'].includes(id) ? { id } : null,
    () => `job-${++seq}`, async (_: unknown, __: unknown, init: any) => { deliveries.push(JSON.parse(init.body)); return { ok: true }; },
  );
  return { api, jobs, deliveries };
}
const instance = { id: 'instance', userId: 'owner' };

test('delegation records exact sender conversation and sends callback identity', async () => {
  const { api, deliveries } = fixture();
  const { job } = await api.createBotJob(instance, 'alpha', 'research this', 'request-one', { botId: 'main', sessionId: 'private-original' });
  await api.deliverBotJob(instance, job);
  assert.equal(job.senderSessionId, 'private-original');
  assert.equal(deliveries[0].senderBotId, 'main');
  assert.equal(deliveries[0].senderSessionId, 'private-original');
});

test('specialist may delegate to Main and duplicate IDs cannot cross origins', async () => {
  const { api, jobs } = fixture();
  const sender = { botId: 'alpha', sessionId: 'alpha-group' };
  const first = await api.createBotJob(instance, 'main', 'synthesize', 'request-two', sender);
  const same = await api.createBotJob(instance, 'main', 'synthesize', 'request-two', sender);
  assert.equal(first.job.id, same.job.id); assert.equal(jobs.length, 1);
  await assert.rejects(api.createBotJob(instance, 'main', 'synthesize', 'request-two', { botId: 'beta', sessionId: 'beta-group' }), /already been used/);
  await assert.rejects(api.createBotJob(instance, 'alpha', 'self loop', 'request-self', sender), /different/);
});
