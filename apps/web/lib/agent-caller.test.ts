import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function fixture() {
  let allowed = true;
  let delivered: any;
  const source = readFileSync(new URL('./bot-service.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const deps = {
    getInstanceById: async (id: string) => id === 'mine' ? { id, runtime: 'supercharge', status: 'running' } : null,
    hasInstanceAccess: () => true,
    getBot: async (_: unknown, id: string) => id === 'research' ? { id } : null,
    proxyInbox: async (_: unknown, path: string, init: any) => { delivered = { path, body: JSON.parse(init.body) }; return { ok: allowed, json: async () => ({ ok: allowed }) }; },
    NextResponse: { json: (body: any, options: any) => ({ body, ...options }) },
  };
  const api = new Function(...Object.keys(deps), `${js};return {requireAgentCaller};`)(...Object.values(deps));
  return { api, deny: () => allowed = false, delivered: () => delivered };
}
const body = { instanceId: 'mine', senderBotId: 'research', senderSessionId: 'research-dm' };
const request = new Request('https://example.invalid', { headers: { 'x-vectra-bot-capability': 's'.repeat(43) } });

test('agent credential is verified against exact bot and conversation', async () => {
  const f = fixture();
  const caller = await f.api.requireAgentCaller(request, body);
  assert.equal(caller.botId, 'research');
  assert.equal(caller.sessionId, 'research-dm');
  assert.deepEqual(f.delivered().body, { botId: 'research', sessionId: 'research-dm', credential: 's'.repeat(43) });
});

test('unknown instance, wrong bot and rejected credential all fail closed', async () => {
  const f = fixture();
  assert.equal((await f.api.requireAgentCaller(request, { ...body, instanceId: 'another' })).status, 401);
  assert.equal((await f.api.requireAgentCaller(request, { ...body, senderBotId: 'main' })).status, 401);
  f.deny(); assert.equal((await f.api.requireAgentCaller(request, body)).status, 401);
});
