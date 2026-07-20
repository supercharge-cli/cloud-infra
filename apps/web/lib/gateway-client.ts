/**
 * Thin HTTP client for packages/gateway (sandbox control plane).
 * API keys for the cloud provider stay on the gateway, not in the browser.
 */

function gatewayBase(): string {
  let base =
    process.env.XIBECODE_SANDBOX_GATEWAY_URL?.trim() ||
    process.env.XIBECODE_E2B_GATEWAY_URL?.trim() ||
    'http://127.0.0.1:8787';
  // strip wrapping quotes from Vercel env paste mistakes
  if (
    (base.startsWith('"') && base.endsWith('"')) ||
    (base.startsWith("'") && base.endsWith("'"))
  ) {
    base = base.slice(1, -1).trim();
  }
  if (/^XIBECODE_.*URL\s*=/i.test(base)) {
    base = base.replace(/^[A-Z_]+\s*=\s*/i, '').trim();
  }
  return base.replace(/\/$/, '');
}

function gatewayToken(): string {
  let t =
    process.env.XIBECODE_GATEWAY_TOKEN?.trim() ||
    process.env.XIBECODE_SANDBOX_AUTH_TOKEN?.trim() ||
    '';
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Human-readable reason when gateway returns HTML / Cloudflare / wrong host. */
export function explainGatewayFailure(status: number, body: string, url: string): string {
  const snippet = (body || '').slice(0, 280).replace(/\s+/g, ' ');
  const lower = snippet.toLowerCase();

  if (
    lower.includes('just a moment') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cloudflare') ||
    lower.includes('attention required') ||
    lower.includes('_cf_chl')
  ) {
    return (
      `Gateway blocked by Cloudflare bot check (HTTP ${status}) at ${url}. ` +
      `Vercel cannot pass the "Just a moment…" page. Fix: set XIBECODE_SANDBOX_GATEWAY_URL to the ` +
      `direct Railway/Coolify origin (*.up.railway.app or server IP/http), not a custom domain with ` +
      `Cloudflare orange-cloud proxy. In Cloudflare DNS set the record to DNS-only (grey cloud), ` +
      `or turn off Bot Fight Mode / Under Attack for that hostname.`
    );
  }

  if (lower.includes('<!doctype html') || lower.includes('<html')) {
    return (
      `Gateway returned HTML instead of JSON (HTTP ${status}) from ${url}. ` +
      `Check XIBECODE_SANDBOX_GATEWAY_URL points at the gateway service (ends without a path), ` +
      `not a website homepage. Body: ${snippet.slice(0, 120)}…`
    );
  }

  if (
    url.includes('127.0.0.1') ||
    url.includes('localhost') ||
    url.includes('0.0.0.0')
  ) {
    return (
      `Gateway URL is localhost (${url}) — that only works on your machine, not on Vercel. ` +
      `Set XIBECODE_SANDBOX_GATEWAY_URL to your public gateway HTTPS URL and redeploy.`
    );
  }

  if (status === 401 || status === 403) {
    return (
      `Gateway auth failed (HTTP ${status}) at ${url}. ` +
      `XIBECODE_GATEWAY_TOKEN on Vercel must match the token on the gateway (XIBECODE_GATEWAY_TOKEN). ` +
      `Body: ${snippet || '(empty)'}`
    );
  }

  return `Gateway request failed (HTTP ${status}) ${url}: ${snippet || '(empty body)'}`;
}

function assertGatewayUrlUsable(): void {
  const base = gatewayBase();
  if (
    process.env.VERCEL === '1' &&
    (base.includes('127.0.0.1') || base.includes('localhost'))
  ) {
    throw new Error(
      'XIBECODE_SANDBOX_GATEWAY_URL is localhost on Vercel. Set it to your public Railway/Coolify gateway URL (Production env) and redeploy.',
    );
  }
}

async function gwFetch(path: string, init: RequestInit = {}): Promise<Response> {
  assertGatewayUrlUsable();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  // Identify as server client (helps some proxies; does not bypass Cloudflare challenge)
  headers.set('user-agent', 'VectraCloud-Web/1.0 (+server)');
  const token = gatewayToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const url = `${gatewayBase()}${path}`;
  try {
    return await fetch(url, { ...init, headers, redirect: 'manual' });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    throw new Error(
      `Gateway unreachable at ${gatewayBase()}: ${msg}. Is the gateway deployed and is the URL correct?`,
    );
  }
}

export type GatewaySession = {
  sessionId: string;
  sandboxId?: string;
  strategy?: string;
  workspaceRoot?: string;
};

export async function createGatewaySession(opts?: {
  sessionId?: string;
  sandboxId?: string;
  strategy?: 'sandbox_full' | 'host_only';
}): Promise<GatewaySession> {
  const res = await gwFetch('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: opts?.sessionId,
      sandboxId: opts?.sandboxId,
      strategy: opts?.strategy || 'sandbox_full',
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      explainGatewayFailure(res.status, text, `${gatewayBase()}/sessions`),
    );
  }
  try {
    return JSON.parse(text) as GatewaySession;
  } catch {
    throw new Error(
      explainGatewayFailure(res.status || 200, text, `${gatewayBase()}/sessions`),
    );
  }
}

/** Re-attach after gateway restart (session map is memory-only). */
export async function ensureGatewaySession(
  sessionId: string,
  sandboxId?: string,
): Promise<void> {
  await createGatewaySession({
    sessionId,
    sandboxId,
    strategy: 'sandbox_full',
  });
}

export async function destroyGatewaySession(sessionId: string): Promise<void> {
  const res = await gwFetch(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Gateway destroy failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

export type ExecResult = {
  success?: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: boolean;
  message?: string;
};

export async function execInSession(
  sessionId: string,
  command: string,
  opts?: { timeout?: number; cwd?: string; sandboxId?: string },
): Promise<ExecResult> {
  // Always pass sandboxId so gateway can reattach after restart / pause
  // (same contract as /wake — fixes "command doesn't resume, telegram does").
  if (opts?.sandboxId) {
    try {
      await ensureGatewaySession(sessionId, opts.sandboxId);
    } catch {
      /* exec body still carries sandboxId for server-side reattach */
    }
  }

  const doExec = async () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/exec`, {
      method: 'POST',
      body: JSON.stringify({
        command,
        timeout: opts?.timeout ?? 120,
        cwd: opts?.cwd,
        sandboxId: opts?.sandboxId,
      }),
    });

  let res = await doExec();
  // Session lost / reattach race → ensure + retry once
  if ((res.status === 404 || res.status === 502) && opts?.sandboxId) {
    try {
      await ensureGatewaySession(sessionId, opts.sandboxId);
      // Explicit wake/reconnect path (connect + optional no daemon restart)
      await wakeSession(sessionId, {
        sandboxId: opts.sandboxId,
        restartDaemon: false,
      }).catch(() => undefined);
      res = await doExec();
    } catch (e) {
      return {
        success: false,
        error: true,
        exitCode: 1,
        message: `reattach failed: ${(e as Error).message}`,
      };
    }
  }
  const text = await res.text();
  let data: ExecResult = {};
  try {
    data = JSON.parse(text) as ExecResult;
  } catch {
    data = { message: explainGatewayFailure(res.status, text, `${gatewayBase()}/sessions/.../exec`) };
  }
  if (!res.ok) {
    return {
      success: false,
      error: true,
      exitCode: typeof data.exitCode === 'number' ? data.exitCode : 1,
      stdout: data.stdout || '',
      stderr: data.stderr || data.message || text.slice(0, 400),
      message: data.message || `HTTP ${res.status}`,
    };
  }
  return data;
}

async function writeFileInSession(
  sessionId: string,
  path: string,
  content: string,
  sandboxId?: string,
): Promise<{ success?: boolean; message?: string }> {
  const doPut = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    });
  let res = await doPut();
  if (res.status === 404 && sandboxId) {
    await ensureGatewaySession(sessionId, sandboxId);
    res = await doPut();
  }
  const text = await res.text();
  let data: { success?: boolean; message?: string; error?: boolean } = {};
  try {
    data = JSON.parse(text) as { success?: boolean; message?: string; error?: boolean };
  } catch {
    data = { success: false, message: text.slice(0, 200) };
  }
  if (!res.ok || data.success === false || data.error) {
    return {
      success: false,
      message: data.message || `HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  }
  return { success: true, message: data.message };
}

async function readFileInSession(
  sessionId: string,
  path: string,
  sandboxId?: string,
): Promise<{ success?: boolean; content?: string; message?: string }> {
  const q = new URLSearchParams({ path });
  const doGet = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/file?${q.toString()}`, {
      method: 'GET',
    });
  let res = await doGet();
  if (res.status === 404 && sandboxId) {
    await ensureGatewaySession(sessionId, sandboxId);
    res = await doGet();
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as { success?: boolean; content?: string; message?: string };
  } catch {
    return { success: res.ok, content: text, message: text.slice(0, 200) };
  }
}

export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) {
      const visible = s.slice(0, 4) + '…' + s.slice(-4);
      out = out.split(s).join(visible);
    }
  }
  out = out.replace(/\brk_[a-f0-9]{20,}\b/gi, 'rk_…[redacted]');
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{10,}\b/g, 'sk-…[redacted]');
  out = out.replace(/\b\d{6,}:[A-Za-z0-9_\-]{20,}\b/g, 'telegram:…[redacted]');
  return out;
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

export type SandboxConfigView = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  hasTelegramToken: boolean;
  apiKeyHint?: string;
  telegramHint?: string;
};

function hint(secret: string | undefined): string | undefined {
  if (!secret || secret.length < 8) return secret ? '••••' : undefined;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** Safe view of config currently on the sandbox (secrets masked). */
export async function readSandboxConfig(
  sessionId: string,
  sandboxId?: string,
): Promise<SandboxConfigView> {
  const empty: SandboxConfigView = { hasApiKey: false, hasTelegramToken: false };
  try {
    const envFile = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/daemon.env',
      sandboxId,
    );
    const profileFile = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/profile-default.json',
      sandboxId,
    );
    const env = parseEnvFile(envFile.content || '');
    let profile: Record<string, string> = {};
    try {
      profile = JSON.parse(profileFile.content || '{}') as Record<string, string>;
    } catch {
      /* ignore */
    }
    const apiKey =
      env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.XIBECODE_API_KEY || profile.apiKey || '';
    const tg = env.TELEGRAM_BOT_TOKEN || env.XIBECODE_TELEGRAM_BOT_TOKEN || '';
    return {
      provider: profile.provider || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai'),
      model: profile.model || env.XIBECODE_MODEL || '',
      baseUrl: profile.baseUrl || env.XIBECODE_BASE_URL || '',
      hasApiKey: Boolean(apiKey),
      hasTelegramToken: Boolean(tg),
      apiKeyHint: hint(apiKey),
      telegramHint: hint(tg),
    };
  } catch {
    return empty;
  }
}

export type ConfigInput = {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  telegramBotToken?: string;
  /** If true, blank apiKey/token means keep values already on the sandbox. */
  mergeExisting?: boolean;
  /**
   * true = anyone can talk to the bot (no pairing).
   * false/omit = pairing required (recommended). First DM gets a code; approve in dashboard.
   */
  allowAllUsers?: boolean;
};

/** Write AI/Telegram config into the sandbox (no daemon start). */
export async function writeSandboxConfig(
  sessionId: string,
  input: ConfigInput & { sandboxId?: string },
): Promise<{ ok: boolean; logs: string[]; meta: SandboxConfigView }> {
  const logs: string[] = [];
  const secrets: string[] = [];
  const redact = (s: string) => redactSecrets(s, secrets);
  const sandboxId = input.sandboxId;

  let existing = await readSandboxConfig(sessionId, sandboxId);
  // Need raw secrets for merge — read env again
  let prevEnv: Record<string, string> = {};
  let prevProfile: Record<string, string> = {};
  try {
    const envFile = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/daemon.env',
      sandboxId,
    );
    prevEnv = parseEnvFile(envFile.content || '');
    const pf = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/profile-default.json',
      sandboxId,
    );
    prevProfile = JSON.parse(pf.content || '{}') as Record<string, string>;
  } catch {
    /* first write */
  }

  const provider =
    (input.provider || prevProfile.provider || 'openai').replace(/[^a-z0-9_-]/gi, '') ||
    'openai';
  const model = (input.model ?? prevProfile.model ?? prevEnv.XIBECODE_MODEL ?? '').trim();
  const baseUrl = (input.baseUrl ?? prevProfile.baseUrl ?? prevEnv.XIBECODE_BASE_URL ?? '').trim();

  const prevApi =
    prevEnv.OPENAI_API_KEY ||
    prevEnv.ANTHROPIC_API_KEY ||
    prevEnv.XIBECODE_API_KEY ||
    prevProfile.apiKey ||
    '';
  const prevTg = prevEnv.TELEGRAM_BOT_TOKEN || prevEnv.XIBECODE_TELEGRAM_BOT_TOKEN || '';

  const apiKey = (input.apiKey || '').trim() || (input.mergeExisting !== false ? prevApi : '');
  const telegramBotToken =
    (input.telegramBotToken || '').trim() || (input.mergeExisting !== false ? prevTg : '');

  if (!apiKey) {
    return {
      ok: false,
      logs: ['API key is required (enter a new key or set one first).'],
      meta: existing,
    };
  }
  if (!telegramBotToken) {
    return {
      ok: false,
      logs: ['Telegram bot token is required (enter a new token or set one first).'],
      meta: existing,
    };
  }

  secrets.push(apiKey, telegramBotToken);

  // Prefer pairing (secure) unless tenant opts into open access.
  // If the form omits the flag, keep previous value; brand-new installs default to pairing.
  const openAccess =
    typeof input.allowAllUsers === 'boolean'
      ? input.allowAllUsers
      : prevEnv.GATEWAY_ALLOW_ALL_USERS === 'true';

  const envBody =
    [
      `TELEGRAM_BOT_TOKEN=${telegramBotToken}`,
      `XIBECODE_TELEGRAM_BOT_TOKEN=${telegramBotToken}`,
      openAccess ? `GATEWAY_ALLOW_ALL_USERS=true` : `GATEWAY_ALLOW_ALL_USERS=false`,
      provider === 'anthropic' ? `ANTHROPIC_API_KEY=${apiKey}` : `OPENAI_API_KEY=${apiKey}`,
      // clear the other provider key so conf/env don't fight
      provider === 'anthropic' ? `OPENAI_API_KEY=` : `ANTHROPIC_API_KEY=`,
      `XIBECODE_API_KEY=${apiKey}`,
      model ? `XIBECODE_MODEL=${model}` : '',
      baseUrl ? `XIBECODE_BASE_URL=${baseUrl}` : '',
      `XIBECODE_DAEMON_WORKDIR=/home/user/workspace`,
    ]
      .filter((line) => line !== '')
      .join('\n') + '\n';

  // Merge into existing conf profile so we don't wipe unrelated settings.
  const mergedProfile = {
    ...prevProfile,
    provider,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : { baseUrl: prevProfile.baseUrl }),
    apiKey,
  };
  const profileJson = JSON.stringify(mergedProfile, null, 2);

  await execInSession(sessionId, 'mkdir -p /home/user/.xibecode', {
    timeout: 30,
    sandboxId,
  });
  const w1 = await writeFileInSession(
    sessionId,
    '/home/user/.xibecode/daemon.env',
    envBody,
    sandboxId,
  );
  const w2 = await writeFileInSession(
    sessionId,
    '/home/user/.xibecode/gateway.env',
    envBody,
    sandboxId,
  );
  const w3 = await writeFileInSession(
    sessionId,
    '/home/user/.xibecode/profile-default.json',
    profileJson,
    sandboxId,
  );

  if (w1.success === false || w2.success === false || w3.success === false) {
    logs.push(
      redact(
        `WRITE FAILED: daemon.env=${w1.message || w1.success} gateway.env=${w2.message || w2.success} profile=${w3.message || w3.success}`,
      ),
    );
    return { ok: false, logs, meta: existing };
  }

  await execInSession(
    sessionId,
    'chmod 600 /home/user/.xibecode/daemon.env /home/user/.xibecode/gateway.env /home/user/.xibecode/profile-default.json 2>/dev/null; true',
    { timeout: 30, sandboxId },
  );

  // Verify what actually landed
  const verify = await execInSession(
    sessionId,
    'grep -E "^(XIBECODE_MODEL|XIBECODE_BASE_URL|GATEWAY_ALLOW_ALL)" /home/user/.xibecode/daemon.env; python3 -c "import json;d=json.load(open(\'/home/user/.xibecode/profile-default.json\'));print(\'profile model=\',d.get(\'model\'),\'provider=\',d.get(\'provider\'))"',
    { timeout: 30, sandboxId },
  );
  logs.push(
    redact(
      `config saved OK · pairing=${openAccess ? 'OFF (open access)' : 'ON (approve in dashboard)'} · provider=${provider} model=${model || '(none)'} baseUrl=${baseUrl || '(none)'}\n${verify.stdout || ''}`,
    ),
  );

  existing = {
    provider,
    model,
    baseUrl,
    hasApiKey: true,
    hasTelegramToken: true,
    apiKeyHint: hint(apiKey),
    telegramHint: hint(telegramBotToken),
  };
  return { ok: true, logs, meta: existing };
}

export type PairingView = {
  pending: Array<{ code: string; platform: string; userId: string; chatId: string; expiresAt: number }>;
  approved: Array<{ platform: string; userId: string; chatId?: string; approvedAt: number }>;
};

export async function listPairings(
  sessionId: string,
  sandboxId?: string,
): Promise<PairingView> {
  const r = await execInSession(
    sessionId,
    `python3 - <<'PY'
import json, os
paths=[
  os.path.expanduser("~/.xibecode/daemon/pairing.json"),
  os.path.expanduser("~/.xibecode/gateway/pairing.json"),
]
for p in paths:
  if os.path.isfile(p):
    print(open(p).read())
    raise SystemExit(0)
print(json.dumps({"pending":[],"approved":[]}))
PY`,
    { timeout: 30, sandboxId },
  );
  try {
    return JSON.parse((r.stdout || '').trim() || '{}') as PairingView;
  } catch {
    return { pending: [], approved: [] };
  }
}

export async function approvePairingCode(
  sessionId: string,
  code: string,
  platform = 'telegram',
  sandboxId?: string,
): Promise<{ ok: boolean; logs: string[] }> {
  const safe = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!safe) return { ok: false, logs: ['Invalid pairing code'] };
  const plat = platform.replace(/[^a-z]/g, '') || 'telegram';
  const r = await execInSession(
    sessionId,
    `xibecode pair approve ${plat} ${safe} 2>&1; echo EXIT:$?`,
    { timeout: 60, sandboxId },
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const ok = /approved|ok|success/i.test(out) || out.includes('EXIT:0');
  return { ok, logs: [out.slice(0, 800)] };
}

/** Restart (or start) xibecode daemon inside the sandbox using saved env. */
export async function restartDaemon(
  sessionId: string,
  sandboxId?: string,
): Promise<{ ok: boolean; logs: string[] }> {
  const setupCmd = [
    'set +e',
    'set -a',
    '[ -f /home/user/.xibecode/daemon.env ] && . /home/user/.xibecode/daemon.env',
    'set +a',
    'if [ -f /tmp/xibecode-daemon.pid ]; then kill "$(cat /tmp/xibecode-daemon.pid)" 2>/dev/null; sleep 1; fi',
    'nohup xibecode daemon --workdir /home/user/workspace >/tmp/xibecode-daemon.log 2>&1 &',
    'echo $! > /tmp/xibecode-daemon.pid',
    'sleep 3',
    'echo "--- daemon pid ---"',
    'cat /tmp/xibecode-daemon.pid 2>/dev/null || true',
    'echo "--- daemon log ---"',
    'head -80 /tmp/xibecode-daemon.log 2>/dev/null || true',
    'echo "--- processes ---"',
    'ps -o pid,user,comm -C node 2>/dev/null | head -15 || true',
    'pgrep -f "xibecode daemon" >/dev/null && echo "xibecode daemon: running" || echo "xibecode daemon: not found"',
    'echo RESTART_DONE',
  ].join('\n');

  const r = await execInSession(sessionId, setupCmd, { timeout: 180, sandboxId });
  const out = `${r.stdout || ''}\n${r.stderr || ''}\n${r.message || ''}`;
  const logs = [
    redactSecrets(
      `restart exit=${r.exitCode ?? '?'} ${out.slice(0, 2500)}`,
    ),
  ];
  const ok = out.includes('RESTART_DONE') || out.includes('telegram enabled');
  return { ok, logs };
}

/** Write config + restart daemon (full setup). */
export async function setupAiAndTelegram(
  sessionId: string,
  input: {
    provider?: string;
    apiKey: string;
    baseUrl?: string;
    model?: string;
    telegramBotToken: string;
    sandboxId?: string;
  },
): Promise<{ ok: boolean; logs: string[] }> {
  const w = await writeSandboxConfig(sessionId, {
    ...input,
    mergeExisting: false,
  });
  if (!w.ok) return { ok: false, logs: w.logs };
  const r = await restartDaemon(sessionId, input.sandboxId);
  return { ok: w.ok && r.ok, logs: [...w.logs, ...r.logs] };
}

export function getGatewayUrl(): string {
  return gatewayBase();
}

export type SandboxLiveState = {
  sandboxId: string;
  state: 'running' | 'paused' | 'missing' | 'unknown' | string;
  resumable: boolean;
  message?: string;
  lifecycle?: { onTimeout?: string; autoResume?: boolean };
};

/** Query live sandbox state (paused still exists and is resumable). */
export async function getSandboxState(sandboxId: string): Promise<SandboxLiveState> {
  const res = await gwFetch(`/sandboxes/${encodeURIComponent(sandboxId)}`);
  const text = await res.text();
  let data: Partial<SandboxLiveState> & { success?: boolean; message?: string } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  return {
    sandboxId,
    state: String(data.state || 'unknown'),
    resumable: data.resumable !== false && data.state !== 'missing',
    message: data.message,
    lifecycle: data.lifecycle,
  };
}

/** Resume a paused sandbox (and optionally restart xibecode daemon for Telegram). */
export async function wakeSession(
  sessionId: string,
  opts?: { sandboxId?: string; restartDaemon?: boolean },
): Promise<{ ok: boolean; state?: string; resumed?: boolean; logs: string[]; message?: string }> {
  const res = await gwFetch(`/sessions/${encodeURIComponent(sessionId)}/wake`, {
    method: 'POST',
    body: JSON.stringify({
      sandboxId: opts?.sandboxId,
      restartDaemon: opts?.restartDaemon !== false,
    }),
  });
  const text = await res.text();
  let data: {
    success?: boolean;
    state?: string;
    resumed?: boolean;
    message?: string;
    daemon?: { ok?: boolean; logs?: string[] };
  } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!res.ok) {
    return {
      ok: false,
      logs: [data.message || text.slice(0, 400)],
      message: data.message || `HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    state: data.state,
    resumed: data.resumed,
    logs: data.daemon?.logs || [],
  };
}
