import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { pluginRuntimeStatus, upgradePluginRuntime } from './plugin-runtime-upgrade';

test('requires sandbox and bot identities before contacting the gateway', async () => {
  await assert.rejects(pluginRuntimeStatus('session', '../wrong'));
  await assert.rejects(upgradePluginRuntime('session', 'sandbox', '../../unsafe'));
});

test('reattaches existing VM, sends a fixed update request once and checks sandbox identity', async (t) => {
  const requests: Array<{ path: string; body: unknown; authorization: string | undefined }> = [];
  let mismatched = false;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part.toString();
    const body = JSON.parse(raw || '{}');
    requests.push({ path: req.url || '', body, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/sessions') res.end(JSON.stringify({ success: true, sessionId: 'session', sandboxId: 'sandbox', runtime: 'supercharge' }));
    else res.end(JSON.stringify({ success: true, sandboxId: mismatched ? 'other' : 'sandbox', ready: true, updated: true }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address !== 'string');
  const previous = process.env.XIBECODE_SANDBOX_GATEWAY_URL;
  const token = process.env.XIBECODE_GATEWAY_TOKEN;
  process.env.XIBECODE_SANDBOX_GATEWAY_URL = `http://127.0.0.1:${address.port}`;
  process.env.XIBECODE_GATEWAY_TOKEN = 'test-only';
  t.after(() => {
    if (previous === undefined) delete process.env.XIBECODE_SANDBOX_GATEWAY_URL;
    else process.env.XIBECODE_SANDBOX_GATEWAY_URL = previous;
    if (token === undefined) delete process.env.XIBECODE_GATEWAY_TOKEN;
    else process.env.XIBECODE_GATEWAY_TOKEN = token;
  });
  const result = await upgradePluginRuntime('session', 'sandbox', 'github');
  assert.equal(result.ready, true);
  assert.deepEqual(requests.map((item) => item.path), ['/sessions', '/sessions/session/plugin-runtime']);
  assert.deepEqual(requests[1].body, { sandboxId: 'sandbox', botId: 'github' });
  assert.ok(requests.every((item) => item.authorization === 'Bearer test-only'));
  mismatched = true;
  await assert.rejects(pluginRuntimeStatus('session', 'sandbox'), /identity/);
  assert.equal(requests.filter((item) => item.path === '/sessions/session/plugin-runtime').length, 2);
});
