import { randomUUID } from 'node:crypto';
import { getDb } from './mongodb';
import { execInSession } from './gateway-client';
import { proxyInbox } from './app-chat';
import { getBot } from './bots';
import type { Instance } from './store';

export const DEVICE_URL = 'https://github.com/login/device';
const TTL_MS = 10 * 60_000;
export type Handoff = {
  instanceId: string; userId: string; sandboxId: string; id: string;
  botId: 'github'; conversationId: string | null; requestId: string;
  expiresAt: number; status: 'starting' | 'pending' | 'cancelled' | 'expired' | 'failed' | 'verified' | 'delivering' | 'delivered' | 'uncertain';
  username?: string;
};
export class DeviceAuthError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

// The VM worker keeps only a device code and process state on disk. It never writes CLI output or tokens.
const VM_SCRIPT = String.raw`
import json, os, pathlib, pwd, re, selectors, subprocess, sys, time
u = pwd.getpwnam('user')
if os.geteuid() == 0:
    os.setgroups([])
    os.setgid(u.pw_gid)
    os.setuid(u.pw_uid)
if os.geteuid() != u.pw_uid: raise SystemExit(3)
identity, action = sys.argv[1:3]
root = pathlib.Path(u.pw_dir) / '.local/state/supercharge-gh-device'
root.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(root, 0o700)
file = root / (identity + '.json')
stop = root / (identity + '.stop')
def save(data):
    temp = root / (identity + '.tmp')
    temp.write_text(json.dumps(data))
    os.chmod(temp, 0o600)
    temp.replace(file)
if action == 'cancel':
    stop.touch(mode=0o600)
    file.unlink(missing_ok=True)
    print('{}')
elif action == 'status':
    print(file.read_text() if file.exists() else '{}')
elif action == 'start':
    if file.exists(): raise SystemExit(4)
    save({'state':'starting'})
    p = subprocess.Popen([sys.executable, '-c', WORKER, identity, 'worker'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    print('{}')
elif action == 'worker':
    env = {'HOME':u.pw_dir, 'USER':'user', 'LOGNAME':'user', 'PATH':'/usr/local/bin:/usr/bin:/bin', 'GH_BROWSER':'true', 'BROWSER':'true', 'GH_CONFIG_DIR':str(pathlib.Path(u.pw_dir)/'.config/gh'), 'XDG_CONFIG_HOME':str(pathlib.Path(u.pw_dir)/'.config'), 'TERM':'dumb'}
    try:
        child = subprocess.Popen(['gh','auth','login','--hostname','github.com','--git-protocol','https','--web','--skip-ssh-key'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    except OSError:
        save({'state':'failed'})
        raise SystemExit(1)
    child.stdin.write(b'\n'); child.stdin.flush(); child.stdin.close()
    sel = selectors.DefaultSelector(); sel.register(child.stdout, selectors.EVENT_READ)
    data = b''; code = None; end = time.monotonic() + 600
    while time.monotonic() < end and not stop.exists():
        for key, _ in sel.select(1):
            chunk = os.read(key.fd, 4096)
            if chunk:
                data = (data + chunk)[-8192:]
                match = re.search(rb'\b([A-Z0-9]{4}-[A-Z0-9]{4})\b', data)
                if match and not code:
                    code = match.group(1).decode('ascii')
                    save({'state':'pending','code':code})
            elif child.poll() is not None: break
        if child.poll() is not None: break
    if child.poll() is None: child.terminate()
    try: child.wait(timeout=3)
    except subprocess.TimeoutExpired: child.kill(); child.wait()
    state = 'cancelled' if stop.exists() else 'expired' if time.monotonic() >= end else 'finished' if child.returncode == 0 else 'failed'
    save({'state':state, 'code':code if state == 'finished' else None})
else: raise SystemExit(2)
`;
const commandScript = VM_SCRIPT.replace(
  "if action == 'cancel':",
  `WORKER = __import__('base64').b64decode('${Buffer.from(VM_SCRIPT).toString('base64')}').decode()\nif action == 'cancel':`,
);

async function vm(instance: Instance, action: 'start' | 'status' | 'cancel' | 'verify', id?: string) {
  if (!instance.sandboxId || instance.runtime !== 'supercharge') throw new DeviceAuthError('GitHub CLI login requires a Supercharge VM', 404);
  const program = action === 'verify' ? String.raw`
import json, os, pwd, subprocess
u=pwd.getpwnam('user')
if os.geteuid()==0:
 os.setgroups([]); os.setgid(u.pw_gid); os.setuid(u.pw_uid)
if os.geteuid()!=u.pw_uid: raise SystemExit(3)
env={'HOME':u.pw_dir,'USER':'user','LOGNAME':'user','PATH':'/usr/local/bin:/usr/bin:/bin','GH_CONFIG_DIR':u.pw_dir+'/.config/gh','XDG_CONFIG_HOME':u.pw_dir+'/.config','TERM':'dumb'}
p=subprocess.run(['gh','api','user','--jq','.login'],env=env,capture_output=True,text=True,timeout=15)
login=p.stdout.strip()
print(json.dumps({'username':login if p.returncode==0 and len(login)<=39 and all(c.isalnum() or c=='-' for c in login) else None}))
` : commandScript;
  const args = action === 'verify' ? '' : ` ${id} ${action}`;
  const cmd = `python3 -c 'import base64;exec(compile(base64.b64decode("${Buffer.from(program).toString('base64')}"),"<github-device>","exec"))'${args}`;
  const result = await execInSession(instance.sessionId, cmd, { sandboxId: instance.sandboxId, runtime: instance.runtime, timeout: 25, cwd: '/home/user/workspace' });
  if (result.exitCode !== 0 || result.error) throw new DeviceAuthError('GitHub CLI in this VM is unavailable; retry or check that gh is installed', 502);
  try { return JSON.parse(result.stdout || '{}') as { state?: string; code?: string; username?: string }; }
  catch { throw new DeviceAuthError('GitHub CLI status is unavailable', 502); }
}

async function conversation(instance: Instance, conversationId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) throw new DeviceAuthError('Invalid conversation');
  if (!await getBot(instance, 'github')) throw new DeviceAuthError('GitHub bot is unavailable', 404);
  const response = await proxyInbox(instance, `/v1/conversations/${encodeURIComponent(conversationId)}?botId=github`);
  if (!response.ok) throw new DeviceAuthError('GitHub conversation not found', 404);
  const body = await response.json() as { botId?: string; sessionId?: string };
  if (body.botId !== 'github' || body.sessionId !== conversationId) throw new DeviceAuthError('GitHub conversation not found', 404);
  const list = await proxyInbox(instance, '/v1/conversations?botId=github');
  if (!list.ok) throw new DeviceAuthError('GitHub conversation list unavailable', 502);
  const summary = await list.json() as { conversations?: { sessionId: string; source: string }[] };
  if (!summary.conversations?.some((item) => item.sessionId === conversationId && item.source === 'direct')) {
    throw new DeviceAuthError('Select a direct GitHub conversation, not a group or delegated job', 400);
  }
}

export async function startDeviceAuth(instance: Instance, conversationId: string | null, requestId: string) {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)) throw new DeviceAuthError('Invalid request ID');
  if (!instance.sandboxId || instance.runtime !== 'supercharge') throw new DeviceAuthError('GitHub CLI login requires a Supercharge VM', 404);
  if (conversationId !== null) await conversation(instance, conversationId);
  const collection = (await getDb()).collection<Handoff & { _id: string }>('github_device_auth');
  const now = Date.now();
  const existing = await collection.findOne({ _id: instance.id });
  if (existing && existing.sandboxId === instance.sandboxId && existing.requestId === requestId) {
    if (existing.conversationId !== conversationId) throw new DeviceAuthError('Request ID has already been used', 409);
    return statusDeviceAuth(instance);
  }
  if (existing && existing.sandboxId === instance.sandboxId && existing.expiresAt > now && ['starting', 'pending', 'verified', 'delivering', 'uncertain'].includes(existing.status)) {
    if (existing.requestId !== requestId || existing.conversationId !== conversationId) throw new DeviceAuthError('A GitHub login is already active for this VM', 409);
    return statusDeviceAuth(instance);
  }
  if (existing && existing.sandboxId === instance.sandboxId && ['starting', 'pending'].includes(existing.status)) await vm(instance, 'cancel', existing.id).catch(() => undefined);
  const record: Handoff = { instanceId: instance.id, userId: instance.userId, sandboxId: instance.sandboxId, id: randomUUID(), botId: 'github', conversationId, requestId, expiresAt: now + TTL_MS, status: 'starting' };
  const claimed = await collection.findOneAndUpdate({ _id: instance.id, ...(existing ? { id: existing.id } : { id: { $exists: false } }) }, { $set: record }, { upsert: !existing, returnDocument: 'after' }).catch((error: unknown) => { if ((error as { code?: number }).code === 11000) return null; throw error; });
  if (!claimed || claimed.id !== record.id) throw new DeviceAuthError('A GitHub login is already active', 409);
  try { await vm(instance, 'start', record.id); }
  catch (error) { await collection.updateOne({ instanceId: instance.id, id: record.id }, { $set: { status: 'cancelled' } }); throw error; }
  return statusDeviceAuth(instance);
}

export async function statusDeviceAuth(instance: Instance) {
  const collection = (await getDb()).collection<Handoff & { _id: string }>('github_device_auth');
  const record = await collection.findOne({ _id: instance.id });
  if (!record) return { status: 'idle' };
  if (record.sandboxId !== instance.sandboxId) return { status: 'idle' };
  if (record.expiresAt <= Date.now() && ['starting', 'pending'].includes(record.status)) {
    await collection.updateOne({ instanceId: instance.id, id: record.id, status: record.status }, { $set: { status: 'expired' } });
    await vm(instance, 'cancel', record.id).catch(() => undefined);
    return { status: 'expired' };
  }
  if (record.status === 'starting' || record.status === 'pending') {
    const state = await vm(instance, 'status', record.id);
    if (state.state === 'failed' || state.state === 'cancelled' || state.state === 'expired') {
      await collection.updateOne({ instanceId: instance.id, id: record.id }, { $set: { status: state.state } });
      return { status: state.state };
    }
    return { status: state.code && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(state.code) ? 'pending' : 'starting', code: state.code && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(state.code) ? state.code : undefined, url: DEVICE_URL, expiresAt: record.expiresAt };
  }
  return { status: record.status, username: record.username };
}

export async function cancelDeviceAuth(instance: Instance) {
  const collection = (await getDb()).collection<Handoff & { _id: string }>('github_device_auth');
  const record = await collection.findOneAndUpdate({ instanceId: instance.id, sandboxId: instance.sandboxId, status: { $in: ['starting', 'pending'] } }, { $set: { status: 'cancelled' } }, { returnDocument: 'before' });
  if (record) await vm(instance, 'cancel', record.id).catch(() => undefined);
  return statusDeviceAuth(instance);
}

export async function finishDeviceAuth(instance: Instance) {
  const collection = (await getDb()).collection<Handoff & { _id: string }>('github_device_auth');
  const record = await collection.findOne({ _id: instance.id });
  if (!record || record.sandboxId !== instance.sandboxId || !['starting', 'pending', 'verified', 'delivering', 'delivered', 'uncertain'].includes(record.status)) throw new DeviceAuthError('No active GitHub login in this VM', 409);
  if (record.expiresAt <= Date.now() && record.status !== 'delivered') { await statusDeviceAuth(instance); throw new DeviceAuthError('GitHub login expired; start again', 409); }
  if (record.status === 'delivering' || record.status === 'uncertain') return { status: 'uncertain', username: record.username };
  if (record.status === 'delivered') return { status: 'delivered', username: record.username };
  if (record.status !== 'verified') {
    const device = await vm(instance, 'status', record.id);
    if (device.state !== 'finished' || !device.code || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device.code)) {
      throw new DeviceAuthError('GitHub device authorization has not completed in this VM. Complete authorization on GitHub, then retry Done.', 409);
    }
  }
  const verified = await vm(instance, 'verify');
  if (!verified.username) throw new DeviceAuthError('GitHub CLI is not authenticated in this VM yet. Complete authorization on GitHub, then retry Done.', 409);
  await collection.updateOne({ instanceId: instance.id, id: record.id, status: { $in: ['starting', 'pending'] } }, { $set: { status: 'verified', username: verified.username } });
  if (record.conversationId === null) {
    const claimed = await collection.findOneAndUpdate({ instanceId: instance.id, id: record.id, status: 'verified', sandboxId: instance.sandboxId }, { $set: { status: 'delivered' } }, { returnDocument: 'after' });
    if (!claimed) return statusDeviceAuth(instance);
    await vm(instance, 'cancel', record.id).catch(() => undefined);
    return { status: 'delivered', username: verified.username };
  }
  await conversation(instance, record.conversationId);
  const claimed = await collection.findOneAndUpdate({ instanceId: instance.id, id: record.id, status: 'verified', sandboxId: instance.sandboxId }, { $set: { status: 'delivering' } }, { returnDocument: 'after' });
  if (!claimed) return statusDeviceAuth(instance);
  await vm(instance, 'cancel', record.id).catch(() => undefined);
  try {
    const response = await proxyInbox(instance, '/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId: 'github', chatId: record.conversationId, text: `GitHub CLI device login is verified in this VM as ${verified.username}. Continue the original task in this conversation. Check current CLI status and rules before using gh. GitHub MCP authentication is separate; do not claim MCP is connected. [GitHub login handoff ${record.requestId}]` }) });
    if (!response.ok) throw new Error('delivery not acknowledged');
    await collection.updateOne({ instanceId: instance.id, id: record.id, status: 'delivering' }, { $set: { status: 'delivered' } });
    return { status: 'delivered', username: verified.username };
  } catch {
    await collection.updateOne({ instanceId: instance.id, id: record.id, status: 'delivering' }, { $set: { status: 'uncertain' } });
    return { status: 'uncertain', username: verified.username };
  }
}
