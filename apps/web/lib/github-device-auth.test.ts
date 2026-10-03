import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import ts from 'typescript';

type Row = { [key: string]: unknown; id: string; status: string; conversationId: string; expiresAt: number };

function fixture(conversationSource = 'direct') {
  let row: Row | null = null;
  let generation = 'vm-one';
  let username: string | undefined;
  let vmState: Record<string, string> = { state: 'pending', code: 'ABCD-1234' };
  const calls: string[] = [];
  const messages: { chatId: string; botId: string; text: string }[] = [];
  let deliver = true;
  const match = (query: Record<string, unknown>) => row !== null && Object.entries(query).every(([key, value]) => {
    if (typeof value === 'object' && value && '$exists' in value) return (key in row!) === value.$exists;
    if (typeof value === 'object' && value && '$in' in value && Array.isArray(value.$in)) return value.$in.includes(row![key]);
    return row![key] === value;
  });
  const collection = {
    async findOne(query: Record<string, unknown>) { return match(query) ? { ...row } : null; },
    async findOneAndUpdate(query: Record<string, unknown>, update: { $set: Partial<Row> }, opts?: { upsert?: boolean; returnDocument?: string }) {
      if (!match(query) && !(opts?.upsert && row === null)) return null;
      const before = row && { ...row };
      row = { ...row, ...update.$set, _id: row?._id ?? query._id } as Row;
      return opts?.returnDocument === 'before' ? before : { ...row };
    },
    async updateOne(query: Record<string, unknown>, update: { $set: Partial<Row> }) { if (match(query)) row = { ...row, ...update.$set } as Row; },
  };
  const source = readFileSync(new URL('./github-device-auth.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText.replace(/^export /gm, '');
  const api = new Function('randomUUID', 'getDb', 'execInSession', 'proxyInbox', 'getBot', `${js};return {startDeviceAuth,statusDeviceAuth,finishDeviceAuth,cancelDeviceAuth,DeviceAuthError,commandScript};`)(
    () => `attempt-${calls.length}-${Math.random().toString(36).slice(2)}`,
    async () => ({ collection: () => collection }),
    async (_session: string, command: string) => {
      assert.doesNotMatch(command, /token|gh auth token/i);
      const action = command.match(/ (start|status|cancel)$/)?.[1] || 'verify';
      calls.push(action);
      return { stdout: JSON.stringify(action === 'verify' ? { username } : action === 'status' ? vmState : {}), exitCode: 0 };
    },
    async (_instance: unknown, path: string, options?: { body: string }) => {
      if (path.startsWith('/v1/conversations/')) return { ok: true, json: async () => ({ botId: 'github', sessionId: 'github-chat' }) };
      if (path.startsWith('/v1/conversations?')) return { ok: true, json: async () => ({ conversations: [{ sessionId: 'github-chat', source: conversationSource }] }) };
      messages.push(JSON.parse(options!.body));
      return { ok: deliver };
    },
    async () => ({ id: 'github' }),
  );
  const instance = () => ({ id: 'one', userId: 'owner', sessionId: 'session', sandboxId: generation, runtime: 'supercharge' });
  return { api, instance, calls, messages, record: () => row!, vm: (state: Record<string, string>) => { vmState = state; }, login: (value?: string) => { username = value; }, generation: (value: string) => { generation = value; }, delivery: (value: boolean) => { deliver = value; } };
}

test('auth route rejects nonowners before reading or changing a VM', async () => {
  const source = readFileSync(new URL('../app/api/instances/[id]/github-auth/route.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let touched = false;
  const api = new Function('requireChatInstance', 'NextResponse', 'cancelDeviceAuth', 'statusDeviceAuth', 'startDeviceAuth', 'finishDeviceAuth', 'DeviceAuthError', `${js};return {GET,POST,DELETE};`)(
    async () => ({ ok: false, response: { status: 404 } }),
    { json: () => { touched = true; } },
    () => { touched = true; }, () => { touched = true; }, () => { touched = true; }, () => { touched = true; },
    class extends Error {},
  );
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await api[method]({ json: async () => ({ action: 'done' }) }, { params: Promise.resolve({ id: 'another-users-vm' }) });
    assert.equal(response.status, 404);
  }
  assert.equal(touched, false);
});

test('VM runner and detached worker compile without host credentials', () => {
  const { api } = fixture();
  const result = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: api.commandScript, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(api.commandScript, /GH_BROWSER.*true/);
  assert.doesNotMatch(api.commandScript, /gh auth token|os\.environ\.copy/);
});

test('device code stays in VM; Done requires gh api user; only one continuation to originating conversation', async () => {
  const f = fixture();
  const started = await f.api.startDeviceAuth(f.instance(), 'github-chat', 'request-123');
  assert.equal(started.code, 'ABCD-1234');
  assert.equal(started.url, 'https://github.com/login/device');
  assert.equal(f.record().conversationId, 'github-chat');
  assert.equal(f.record().code, undefined);
  await assert.rejects(f.api.finishDeviceAuth(f.instance()), /has not completed/);
  assert.equal(f.messages.length, 0);
  f.vm({ state: 'finished', code: 'ABCD-1234' });
  await assert.rejects(f.api.finishDeviceAuth(f.instance()), /not authenticated/);
  f.login('real-user');
  assert.equal((await f.api.finishDeviceAuth(f.instance())).status, 'delivered');
  assert.equal((await f.api.finishDeviceAuth(f.instance())).status, 'delivered');
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].chatId, 'github-chat');
  assert.equal(f.messages[0].botId, 'github');
  assert.match(f.messages[0].text, /GitHub MCP authentication is separate/);
});

test('repeat start, competing attempt, cancel, expiry and sandbox replacement', async () => {
  const f = fixture();
  await f.api.startDeviceAuth(f.instance(), 'github-chat', 'request-123');
  await f.api.startDeviceAuth(f.instance(), 'github-chat', 'request-123');
  assert.equal(f.calls.filter((action: string) => action === 'start').length, 1);
  await assert.rejects(f.api.startDeviceAuth(f.instance(), 'github-chat', 'different-456'), /already active/);
  assert.equal((await f.api.cancelDeviceAuth(f.instance())).status, 'cancelled');
  await assert.rejects(f.api.finishDeviceAuth(f.instance()), /No active/);
  await f.api.startDeviceAuth(f.instance(), 'github-chat', 'different-456');
  f.record().expiresAt = Date.now() - 1;
  assert.equal((await f.api.statusDeviceAuth(f.instance())).status, 'expired');
  await assert.rejects(f.api.finishDeviceAuth(f.instance()), /No active|expired/);
  f.generation('vm-two');
  assert.equal((await f.api.statusDeviceAuth(f.instance())).status, 'idle');
});

test('failed device authorization is reported and never resumes', async () => {
  const f = fixture();
  await f.api.startDeviceAuth(f.instance(), 'github-chat', 'request-123');
  f.vm({ state: 'failed' });
  assert.equal((await f.api.statusDeviceAuth(f.instance())).status, 'failed');
  f.login('other-login');
  await assert.rejects(f.api.finishDeviceAuth(f.instance()), /No active/);
  assert.equal(f.messages.length, 0);
});

test('uncertain delivery is never replayed', async () => {
  const f = fixture();
  await f.api.startDeviceAuth(f.instance(), 'github-chat', 'request-123');
  f.vm({ state: 'finished', code: 'ABCD-1234' }); f.login('real-user'); f.delivery(false);
  assert.equal((await f.api.finishDeviceAuth(f.instance())).status, 'uncertain');
  f.delivery(true);
  assert.equal((await f.api.finishDeviceAuth(f.instance())).status, 'uncertain');
  assert.equal(f.messages.length, 1);
});

test('group and delegated jobs cannot be mistaken for direct GitHub conversations', async () => {
  for (const source of ['group', 'delegation']) {
    const f = fixture(source);
    await assert.rejects(f.api.startDeviceAuth(f.instance(), 'github-chat', 'request-123'), /direct GitHub conversation/);
    assert.equal(f.calls.length, 0);
  }
});

test('bad conversation and request ID cannot start a VM login', async () => {
  const f = fixture();
  await assert.rejects(f.api.startDeviceAuth(f.instance(), 'not/a/conversation', 'request-123'), /Invalid conversation/);
  await assert.rejects(f.api.startDeviceAuth(f.instance(), 'github-chat', 'x'), /Invalid request ID/);
  assert.equal(f.calls.length, 0);
});
