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
  out = out.replace(/\bxoxb-[A-Za-z0-9\-]+/g, 'xoxb-…[redacted]');
  out = out.replace(/\bxapp-[A-Za-z0-9\-]+/g, 'xapp-…[redacted]');
  return out;
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    // support optional "export KEY=val"
    const body = t.startsWith('export ') ? t.slice(7).trim() : t;
    const i = body.indexOf('=');
    if (i < 0) continue;
    let key = body.slice(0, i).trim();
    let val = body.slice(i + 1).trim();
    // strip matching single/double quotes around values
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/** First non-empty trimmed string. */
function pick(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Common provider API key env names (profile.apiKey still preferred). */
const API_KEY_ENV_NAMES = [
  'XIBECODE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ROUTINGRUN_API_KEY',
  'OPENROUTER_API_KEY',
  'ZENLLM_API_KEY',
  'DEEPSEEK_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'PERPLEXITY_API_KEY',
  'COHERE_API_KEY',
  'MOONSHOT_API_KEY',
  'KIMI_API_KEY',
  'MINIMAX_API_KEY',
  'HF_TOKEN',
  'AZURE_FOUNDRY_API_KEY',
  'LM_API_KEY',
  'OLLAMA_API_KEY',
] as const;

function apiKeyFromEnv(env: Record<string, string>): string {
  for (const k of API_KEY_ENV_NAMES) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  // any *API_KEY leftover (provider-specific)
  for (const [k, v] of Object.entries(env)) {
    if (!v?.trim()) continue;
    if (/_API_KEY$/i.test(k) || k === 'HF_TOKEN') return v.trim();
  }
  return '';
}

export type SandboxConfigView = {
  provider?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  hasTelegramToken: boolean;
  hasDiscordToken: boolean;
  hasSlackToken: boolean;
  /** Full values for owner edit form (auth-gated API only). */
  apiKey?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  allowAllUsers?: boolean;
  apiKeyHint?: string;
  telegramHint?: string;
  discordHint?: string;
  slackHint?: string;
};

function hint(secret: string | undefined): string | undefined {
  if (!secret || secret.length < 8) return secret ? '••••' : undefined;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function emptyConfigView(): SandboxConfigView {
  return {
    hasApiKey: false,
    hasTelegramToken: false,
    hasDiscordToken: false,
    hasSlackToken: false,
    allowAllUsers: false,
  };
}

function parseProfileJson(raw: string): Record<string, unknown> {
  try {
    const data = JSON.parse(raw || '{}') as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function strField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v.trim() : v != null && typeof v !== 'object' ? String(v).trim() : '';
}

function viewFromSources(
  env: Record<string, string>,
  profile: Record<string, unknown>,
): SandboxConfigView {
  // Prefer profile (what xibecode CLI/Telegram setup writes) then daemon/gateway env.
  const apiKey = pick(strField(profile, 'apiKey'), apiKeyFromEnv(env));
  const tg = pick(
    env.TELEGRAM_BOT_TOKEN,
    env.XIBECODE_TELEGRAM_BOT_TOKEN,
    strField(profile, 'telegramBotToken'),
  );
  const dc = pick(
    env.DISCORD_BOT_TOKEN,
    env.XIBECODE_DISCORD_BOT_TOKEN,
    strField(profile, 'discordBotToken'),
  );
  const slackBot = pick(
    env.SLACK_BOT_TOKEN,
    env.XIBECODE_SLACK_BOT_TOKEN,
    strField(profile, 'slackBotToken'),
  );
  const slackApp = pick(
    env.SLACK_APP_TOKEN,
    env.XIBECODE_SLACK_APP_TOKEN,
    strField(profile, 'slackAppToken'),
  );
  const model = pick(strField(profile, 'model'), env.XIBECODE_MODEL);
  const baseUrl = pick(
    strField(profile, 'baseUrl'),
    env.XIBECODE_BASE_URL,
    env.OPENAI_BASE_URL,
    env.ANTHROPIC_BASE_URL,
  );
  const provider = pick(
    strField(profile, 'provider'),
    env.XIBECODE_PROVIDER,
    env.ANTHROPIC_API_KEY ? 'anthropic' : '',
    'openai',
  );
  const slackOk = Boolean(slackBot && slackApp);
  return {
    provider: provider || 'openai',
    model: model || '',
    baseUrl: baseUrl || '',
    hasApiKey: Boolean(apiKey),
    hasTelegramToken: Boolean(tg),
    hasDiscordToken: Boolean(dc),
    hasSlackToken: slackOk,
    apiKey: apiKey || undefined,
    telegramBotToken: tg || undefined,
    discordBotToken: dc || undefined,
    slackBotToken: slackBot || undefined,
    slackAppToken: slackApp || undefined,
    allowAllUsers: env.GATEWAY_ALLOW_ALL_USERS === 'true',
    apiKeyHint: hint(apiKey),
    telegramHint: hint(tg),
    discordHint: hint(dc),
    slackHint: slackOk ? hint(slackBot) : undefined,
  };
}

/** Config currently on the sandbox — full secrets for authenticated owner edit. */
export async function readSandboxConfig(
  sessionId: string,
  sandboxId?: string,
): Promise<SandboxConfigView> {
  try {
    // One shell dump is more reliable than separate file reads (and picks up
    // profile-*.json + both env files that Telegram / CLI setup may write).
    const dump = await execInSession(
      sessionId,
      `python3 - <<'PY'
import json, os
from pathlib import Path
home = Path(os.path.expanduser("~/.xibecode"))
if not home.is_dir():
    home = Path("/home/user/.xibecode")
env = {}
for name in ("daemon.env", "gateway.env"):
    p = home / name
    if not p.is_file():
        continue
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    for line in text.splitlines():
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        if t.startswith("export "):
            t = t[7:].strip()
        i = t.find("=")
        if i < 0:
            continue
        k, v = t[:i].strip(), t[i+1:].strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        if k and v and k not in env:
            env[k] = v
profile = {}
meta_path = home / "meta.json"
default = "default"
if meta_path.is_file():
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8", errors="replace"))
        if isinstance(meta, dict) and meta.get("defaultProfile"):
            default = str(meta["defaultProfile"]).strip() or "default"
    except Exception:
        pass
for name in (f"profile-{default}.json", "profile-default.json", "config.json", "settings.json"):
    p = home / name
    if not p.is_file():
        continue
    try:
        data = json.loads(p.read_text(encoding="utf-8", errors="replace"))
        if isinstance(data, dict):
            # later files only fill missing keys (prefer default profile)
            for k, v in data.items():
                if k not in profile:
                    profile[k] = v
    except Exception:
        pass
# also merge any other profile-*.json fields that default missed
for p in sorted(home.glob("profile-*.json")):
    try:
        data = json.loads(p.read_text(encoding="utf-8", errors="replace"))
        if isinstance(data, dict):
            for k, v in data.items():
                if k not in profile and v not in (None, "", [], {}):
                    profile[k] = v
    except Exception:
        pass
print(json.dumps({"env": env, "profile": profile}, ensure_ascii=False))
PY`,
      { timeout: 45, sandboxId },
    );

    if (dump.stdout?.trim()) {
      try {
        const parsed = JSON.parse(dump.stdout.trim()) as {
          env?: Record<string, string>;
          profile?: Record<string, unknown>;
        };
        return viewFromSources(parsed.env || {}, parsed.profile || {});
      } catch {
        /* fall through to file reads */
      }
    }

    // Fallback: direct file reads (older gateway / python missing)
    const envFile = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/daemon.env',
      sandboxId,
    );
    const gatewayEnvFile = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/gateway.env',
      sandboxId,
    );
    const profileFile = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/profile-default.json',
      sandboxId,
    );
    const env = {
      ...parseEnvFile(gatewayEnvFile.content || ''),
      ...parseEnvFile(envFile.content || ''),
    };
    const profile = parseProfileJson(profileFile.content || '');
    return viewFromSources(env, profile);
  } catch {
    return emptyConfigView();
  }
}

export type ConfigInput = {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  /** If true, blank apiKey/token means keep values already on the sandbox. */
  mergeExisting?: boolean;
  /**
   * true = anyone can talk (no pairing).
   * false/omit = pairing required (recommended). First message gets a code; approve in dashboard.
   */
  allowAllUsers?: boolean;
};

/** Write AI + chat-channel config into the sandbox (no daemon start). */
export async function writeSandboxConfig(
  sessionId: string,
  input: ConfigInput & { sandboxId?: string },
): Promise<{ ok: boolean; logs: string[]; meta: SandboxConfigView }> {
  const logs: string[] = [];
  const secrets: string[] = [];
  const redact = (s: string) => redactSecrets(s, secrets);
  const sandboxId = input.sandboxId;

  let existing = await readSandboxConfig(sessionId, sandboxId);

  // Full profile for merge (preserve unrelated conf keys like plugins, theme, etc.)
  let prevProfile: Record<string, unknown> = {};
  try {
    const pf = await readFileInSession(
      sessionId,
      '/home/user/.xibecode/profile-default.json',
      sandboxId,
    );
    prevProfile = parseProfileJson(pf.content || '');
  } catch {
    /* first write */
  }

  const provider =
    (input.provider || existing.provider || 'openai').replace(/[^a-z0-9_-]/gi, '') ||
    'openai';
  const model = (input.model ?? existing.model ?? '').trim();
  const baseUrl = (input.baseUrl ?? existing.baseUrl ?? '').trim();

  const merge = input.mergeExisting !== false;
  const apiKey =
    (input.apiKey || '').trim() || (merge ? existing.apiKey || '' : '');
  const telegramBotToken =
    (input.telegramBotToken || '').trim() ||
    (merge ? existing.telegramBotToken || '' : '');
  const discordBotToken =
    (input.discordBotToken || '').trim() ||
    (merge ? existing.discordBotToken || '' : '');
  const slackBotToken =
    (input.slackBotToken || '').trim() || (merge ? existing.slackBotToken || '' : '');
  const slackAppToken =
    (input.slackAppToken || '').trim() || (merge ? existing.slackAppToken || '' : '');

  if (!apiKey) {
    return {
      ok: false,
      logs: ['API key is required (enter a new key or set one first).'],
      meta: existing,
    };
  }
  if (Boolean(slackBotToken) !== Boolean(slackAppToken)) {
    return {
      ok: false,
      logs: ['Slack needs both SLACK_BOT_TOKEN (xoxb-…) and SLACK_APP_TOKEN (xapp-…).'],
      meta: existing,
    };
  }
  // XibeCode daemon starts any adapter that has tokens — at least one channel required.
  if (!telegramBotToken && !discordBotToken && !slackBotToken) {
    return {
      ok: false,
      logs: [
        'At least one chat channel is required: Telegram bot token, Discord bot token, or Slack bot+app tokens.',
      ],
      meta: existing,
    };
  }

  secrets.push(apiKey, telegramBotToken, discordBotToken, slackBotToken, slackAppToken);

  // Prefer pairing (secure) unless tenant opts into open access.
  // If the form omits the flag, keep previous value; brand-new installs default to pairing.
  const openAccess =
    typeof input.allowAllUsers === 'boolean'
      ? input.allowAllUsers
      : Boolean(existing.allowAllUsers);

  const channels: string[] = [];
  if (telegramBotToken) channels.push('telegram');
  if (discordBotToken) channels.push('discord');
  if (slackBotToken) channels.push('slack');

  const envBody =
    [
      telegramBotToken ? `TELEGRAM_BOT_TOKEN=${telegramBotToken}` : '',
      telegramBotToken ? `XIBECODE_TELEGRAM_BOT_TOKEN=${telegramBotToken}` : '',
      discordBotToken ? `DISCORD_BOT_TOKEN=${discordBotToken}` : '',
      discordBotToken ? `XIBECODE_DISCORD_BOT_TOKEN=${discordBotToken}` : '',
      slackBotToken ? `SLACK_BOT_TOKEN=${slackBotToken}` : '',
      slackBotToken ? `XIBECODE_SLACK_BOT_TOKEN=${slackBotToken}` : '',
      slackAppToken ? `SLACK_APP_TOKEN=${slackAppToken}` : '',
      slackAppToken ? `XIBECODE_SLACK_APP_TOKEN=${slackAppToken}` : '',
      openAccess ? `GATEWAY_ALLOW_ALL_USERS=true` : `GATEWAY_ALLOW_ALL_USERS=false`,
      provider === 'anthropic' ? `ANTHROPIC_API_KEY=${apiKey}` : `OPENAI_API_KEY=${apiKey}`,
      // clear the other provider key so conf/env don't fight
      provider === 'anthropic' ? `OPENAI_API_KEY=` : `ANTHROPIC_API_KEY=`,
      `XIBECODE_API_KEY=${apiKey}`,
      `XIBECODE_PROVIDER=${provider}`,
      model ? `XIBECODE_MODEL=${model}` : '',
      baseUrl ? `XIBECODE_BASE_URL=${baseUrl}` : '',
      baseUrl && provider !== 'anthropic' ? `OPENAI_BASE_URL=${baseUrl}` : '',
      `XIBECODE_DAEMON_WORKDIR=/home/user/workspace`,
    ]
      .filter((line) => line !== '')
      .join('\n') + '\n';

  // Merge into existing conf profile so we don't wipe unrelated settings.
  const mergedProfile = {
    ...prevProfile,
    provider,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : prevProfile.baseUrl ? { baseUrl: prevProfile.baseUrl } : {}),
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
    'grep -E "^(XIBECODE_MODEL|XIBECODE_BASE_URL|GATEWAY_ALLOW_ALL|TELEGRAM_|DISCORD_|SLACK_)" /home/user/.xibecode/daemon.env | sed -E "s/(TOKEN|KEY)=.*/\\1=…/"; python3 -c "import json;d=json.load(open(\'/home/user/.xibecode/profile-default.json\'));print(\'profile model=\',d.get(\'model\'),\'provider=\',d.get(\'provider\'))"',
    { timeout: 30, sandboxId },
  );
  logs.push(
    redact(
      `config saved OK · channels=${channels.join('+') || 'none'} · pairing=${openAccess ? 'OFF (open access)' : 'ON (approve in dashboard)'} · provider=${provider} model=${model || '(none)'} baseUrl=${baseUrl || '(none)'}\n${verify.stdout || ''}`,
    ),
  );

  existing = {
    provider,
    model,
    baseUrl,
    hasApiKey: true,
    hasTelegramToken: Boolean(telegramBotToken),
    hasDiscordToken: Boolean(discordBotToken),
    hasSlackToken: Boolean(slackBotToken && slackAppToken),
    apiKey,
    telegramBotToken: telegramBotToken || undefined,
    discordBotToken: discordBotToken || undefined,
    slackBotToken: slackBotToken || undefined,
    slackAppToken: slackAppToken || undefined,
    allowAllUsers: openAccess,
    apiKeyHint: hint(apiKey),
    telegramHint: hint(telegramBotToken),
    discordHint: hint(discordBotToken),
    slackHint: slackBotToken ? hint(slackBotToken) : undefined,
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

/** Parse `xibecode -v` / package version from shell output. */
export function parseXibecodeVersion(text: string): string | null {
  const m = String(text || '').match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : null;
}

/** Current CLI version inside the sandbox (+ npm latest from host when possible). */
export async function getCliVersionInfo(
  sessionId: string,
  sandboxId?: string,
): Promise<{
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  logs: string[];
}> {
  const logs: string[] = [];
  let current: string | null = null;

  const r = await execInSession(
    sessionId,
    [
      'set +e',
      'echo "--- xibecode -v ---"',
      'xibecode -v 2>&1 || xibecode --version 2>&1 || true',
      'echo "--- which ---"',
      'which xibecode 2>/dev/null || true',
      'echo VERSION_DONE',
    ].join('\n'),
    { timeout: 60, sandboxId },
  );
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  logs.push(redactSecrets(out.slice(0, 1200)));
  current = parseXibecodeVersion(out);

  let latest: string | null = null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const res = await fetch('https://registry.npmjs.org/xibecode/latest', {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data.version) latest = String(data.version).trim();
    }
  } catch {
    logs.push('npm registry latest: unreachable (host)');
  }

  // Optional: try sandbox-side check if host registry failed
  if (!latest) {
    const r2 = await execInSession(
      sessionId,
      `xibecode update --check --json 2>/dev/null || true`,
      { timeout: 30, sandboxId },
    );
    const j = `${r2.stdout || ''}`;
    try {
      const parsed = JSON.parse(j) as { latest?: string; current?: string };
      if (parsed.latest) latest = String(parsed.latest);
      if (!current && parsed.current) current = String(parsed.current);
    } catch {
      /* ignore */
    }
  }

  const updateAvailable = Boolean(
    current &&
      latest &&
      compareSemverCore(latest, current) > 0,
  );

  return { current, latest, updateAvailable, logs };
}

/** Semver core compare (positive if a > b). */
export function compareSemverCore(a: string, b: string): number {
  const coreA = a.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const coreB = b.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = coreA[i] ?? 0;
    const y = coreB[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Opt-in upgrade: sudo npm install -g xibecode@latest && xibecode -v, then restart daemon.
 */
export async function updateCliInSandbox(
  sessionId: string,
  opts?: { sandboxId?: string; version?: string },
): Promise<{
  ok: boolean;
  from: string | null;
  to: string | null;
  verified: string | null;
  logs: string[];
}> {
  const sandboxId = opts?.sandboxId;
  const logs: string[] = [];

  const shell = [
    'set +e',
    'echo "--- pre version ---"',
    'xibecode -v 2>&1 || true',
    'echo "--- install ---"',
    'sudo npm install -g xibecode@latest 2>&1 || npm install -g xibecode@latest 2>&1',
    'echo "--- post version ---"',
    'xibecode -v 2>&1 || true',
    'echo UPDATE_DONE',
  ].join('\n');

  const r = await execInSession(sessionId, shell, {
    timeout: 300,
    sandboxId,
    cwd: '/home/user',
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}\n${r.message || ''}`;
  logs.push(redactSecrets(out.slice(0, 5000)));

  const from = parseXibecodeVersion(out.split('--- pre version ---')[1] || '');
  const verified = parseXibecodeVersion(out.split('--- post version ---').pop() || '');

  logs.push('--- restart daemon ---');
  const restart = await restartDaemon(sessionId, sandboxId);
  logs.push(...restart.logs);

  return {
    ok: Boolean(verified && out.includes('UPDATE_DONE') && restart.ok),
    from,
    to: verified,
    verified,
    logs,
  };
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
  const ok =
    out.includes('RESTART_DONE') ||
    /telegram enabled|discord enabled|slack enabled/i.test(out);
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
    telegramBotToken?: string;
    discordBotToken?: string;
    slackBotToken?: string;
    slackAppToken?: string;
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
): Promise<{
  ok: boolean;
  state?: string;
  resumed?: boolean;
  daemonOk?: boolean;
  logs: string[];
  message?: string;
}> {
  const logs: string[] = [];
  const restartDaemon = opts?.restartDaemon !== false;

  // Session map is memory-only — reattach before wake after gateway restart.
  if (opts?.sandboxId) {
    try {
      await ensureGatewaySession(sessionId, opts.sandboxId);
      logs.push('gateway session ensured');
    } catch (e) {
      logs.push(`ensure session: ${(e as Error).message}`);
      // /wake still carries sandboxId for server-side reattach
    }
  }

  const doWake = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/wake`, {
      method: 'POST',
      body: JSON.stringify({
        sandboxId: opts?.sandboxId,
        restartDaemon,
      }),
    });

  let res = await doWake();
  // Lost session / cold gateway → ensure + retry once
  if ((res.status === 404 || res.status === 502) && opts?.sandboxId) {
    try {
      await ensureGatewaySession(sessionId, opts.sandboxId);
      res = await doWake();
      logs.push('wake retried after reattach');
    } catch (e) {
      return {
        ok: false,
        logs: [...logs, `reattach failed: ${(e as Error).message}`],
        message: (e as Error).message,
      };
    }
  }

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
  if (data.daemon?.logs?.length) {
    logs.push(...data.daemon.logs);
  }
  if (!res.ok || data.success === false) {
    return {
      ok: false,
      state: data.state,
      resumed: data.resumed,
      daemonOk: data.daemon?.ok,
      logs: [...logs, data.message || text.slice(0, 400)],
      message: data.message || `HTTP ${res.status}`,
    };
  }

  // Sandbox is up; daemon restart is best-effort but surface failure to callers.
  const daemonOk = restartDaemon ? data.daemon?.ok !== false : true;
  if (restartDaemon && data.daemon && data.daemon.ok === false) {
    logs.push('daemon restart reported DAEMON_FAIL — host webhook should stay armed');
  }

  return {
    ok: true,
    state: data.state || 'running',
    resumed: data.resumed,
    daemonOk,
    logs,
  };
}
