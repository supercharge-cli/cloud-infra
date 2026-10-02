/**
 * Thin HTTP client for packages/gateway (sandbox control plane).
 * API keys for the cloud provider stay on the gateway, not in the browser.
 */

import {
  defaultImageModel,
  imageProviderFormat,
  stockBaseUrl,
} from "./provider-defaults";
import {
  normalizeApiWireFormat,
  type ApiWireFormat,
} from "./api-format";
import {
  envKeysForProvider,
  parseSavedProviders,
  slotFromActive,
  upsertSavedProvider,
  type SavedProvider,
} from "./saved-providers";

function gatewayBase(): string {
  let base =
    process.env.XIBECODE_SANDBOX_GATEWAY_URL?.trim() ||
    process.env.XIBECODE_E2B_GATEWAY_URL?.trim() ||
    "http://127.0.0.1:8787";
  // strip wrapping quotes from Vercel env paste mistakes
  if (
    (base.startsWith('"') && base.endsWith('"')) ||
    (base.startsWith("'") && base.endsWith("'"))
  ) {
    base = base.slice(1, -1).trim();
  }
  if (/^XIBECODE_.*URL\s*=/i.test(base)) {
    base = base.replace(/^[A-Z_]+\s*=\s*/i, "").trim();
  }
  return base.replace(/\/$/, "");
}

function gatewayToken(): string {
  let t =
    process.env.XIBECODE_GATEWAY_TOKEN?.trim() ||
    process.env.XIBECODE_SANDBOX_AUTH_TOKEN?.trim() ||
    "";
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Human-readable reason when gateway returns HTML / Cloudflare / wrong host. */
export function explainGatewayFailure(
  status: number,
  body: string,
  url: string,
): string {
  const snippet = (body || "").slice(0, 280).replace(/\s+/g, " ");
  const lower = snippet.toLowerCase();

  if (
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("cloudflare") ||
    lower.includes("attention required") ||
    lower.includes("_cf_chl")
  ) {
    return (
      `Gateway blocked by Cloudflare bot check (HTTP ${status}) at ${url}. ` +
      `Vercel cannot pass the "Just a moment…" page. Fix: set XIBECODE_SANDBOX_GATEWAY_URL to the ` +
      `direct Railway/Coolify origin (*.up.railway.app or server IP/http), not a custom domain with ` +
      `Cloudflare orange-cloud proxy. In Cloudflare DNS set the record to DNS-only (grey cloud), ` +
      `or turn off Bot Fight Mode / Under Attack for that hostname.`
    );
  }

  if (lower.includes("<!doctype html") || lower.includes("<html")) {
    return (
      `Gateway returned HTML instead of JSON (HTTP ${status}) from ${url}. ` +
      `Check XIBECODE_SANDBOX_GATEWAY_URL points at the gateway service (ends without a path), ` +
      `not a website homepage. Body: ${snippet.slice(0, 120)}…`
    );
  }

  if (
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    url.includes("0.0.0.0")
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
      `Body: ${snippet || "(empty)"}`
    );
  }

  return `Gateway request failed (HTTP ${status}) ${url}: ${snippet || "(empty body)"}`;
}

function assertGatewayUrlUsable(): void {
  const base = gatewayBase();
  if (
    process.env.VERCEL === "1" &&
    (base.includes("127.0.0.1") || base.includes("localhost"))
  ) {
    throw new Error(
      "XIBECODE_SANDBOX_GATEWAY_URL is localhost on Vercel. Set it to your public Railway/Coolify gateway URL (Production env) and redeploy.",
    );
  }
}

async function gwFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  assertGatewayUrlUsable();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  // Identify as server client (helps some proxies; does not bypass Cloudflare challenge)
  headers.set("user-agent", "VectraCloud-Web/1.0 (+server)");
  const token = gatewayToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const url = `${gatewayBase()}${path}`;
  try {
    return await fetch(url, { ...init, headers, redirect: "manual" });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    throw new Error(
      `Gateway unreachable at ${gatewayBase()}: ${msg}. Is the gateway deployed and is the URL correct?`,
    );
  }
}

export type AgentRuntime = "xibecode" | "supercharge";

export type GatewaySession = {
  sessionId: string;
  sandboxId?: string;
  strategy?: string;
  runtime?: AgentRuntime;
  template?: string;
  workspaceRoot?: string;
};

export async function createGatewaySession(opts?: {
  sessionId?: string;
  sandboxId?: string;
  strategy?: "sandbox_full" | "host_only";
  runtime?: AgentRuntime;
}): Promise<GatewaySession> {
  const res = await gwFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({
      sessionId: opts?.sessionId,
      sandboxId: opts?.sandboxId,
      strategy: opts?.strategy || "sandbox_full",
      runtime: opts?.runtime || "xibecode",
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
      explainGatewayFailure(
        res.status || 200,
        text,
        `${gatewayBase()}/sessions`,
      ),
    );
  }
}

/** Re-attach after gateway restart (session map is memory-only). */
export async function ensureGatewaySession(
  sessionId: string,
  sandboxId?: string,
  runtime?: AgentRuntime,
): Promise<void> {
  await createGatewaySession({
    sessionId,
    sandboxId,
    strategy: "sandbox_full",
    runtime,
  });
}

export async function recreateSandboxSession(
  sessionId: string,
  opts?: { sandboxId?: string; runtime?: AgentRuntime },
): Promise<{
  ok: boolean;
  sessionId: string;
  oldSandboxId?: string;
  sandboxId: string;
  template?: string;
  bytes?: number;
  logs: string[];
  message?: string;
}> {
  const res = await gwFetch(
    `/sessions/${encodeURIComponent(sessionId)}/recreate`,
    {
      method: "POST",
      body: JSON.stringify({
        sandboxId: opts?.sandboxId,
        runtime: opts?.runtime,
      }),
    },
  );
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { message: text };
  }
  const logs = Array.isArray(data.logs) ? data.logs.map((l) => String(l)) : [];
  if (!res.ok) {
    return {
      ok: false,
      sessionId,
      sandboxId: String(data.sandboxId || opts?.sandboxId || ""),
      logs,
      message: String(
        data.message || explainGatewayFailure(res.status, text, "recreate"),
      ),
    };
  }
  return {
    ok: true,
    sessionId: String(data.sessionId || sessionId),
    oldSandboxId: data.oldSandboxId ? String(data.oldSandboxId) : undefined,
    sandboxId: String(data.sandboxId || ""),
    template: data.template ? String(data.template) : undefined,
    bytes: typeof data.bytes === "number" ? data.bytes : undefined,
    logs,
  };
}

export async function destroyGatewaySession(sessionId: string): Promise<void> {
  const res = await gwFetch(`/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(
      `Gateway destroy failed (${res.status}): ${text.slice(0, 400)}`,
    );
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
  opts?: {
    timeout?: number;
    cwd?: string;
    sandboxId?: string;
    runtime?: AgentRuntime;
  },
): Promise<ExecResult> {
  // Always pass sandboxId so gateway can reattach after restart / pause
  // (same contract as /wake — fixes "command doesn't resume, telegram does").
  if (opts?.sandboxId) {
    try {
      await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime);
    } catch {
      /* exec body still carries sandboxId for server-side reattach */
    }
  }

  const doExec = async () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/exec`, {
      method: "POST",
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
      await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime);
      // Explicit wake/reconnect path (connect + optional no daemon restart)
      await wakeSession(sessionId, {
        sandboxId: opts.sandboxId,
        runtime: opts.runtime,
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
    data = {
      message: explainGatewayFailure(
        res.status,
        text,
        `${gatewayBase()}/sessions/.../exec`,
      ),
    };
  }
  if (!res.ok) {
    return {
      success: false,
      error: true,
      exitCode: typeof data.exitCode === "number" ? data.exitCode : 1,
      stdout: data.stdout || "",
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
  runtime?: AgentRuntime,
): Promise<{ success?: boolean; message?: string }> {
  const doPut = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    });
  let res = await doPut();
  if (res.status === 404 && sandboxId) {
    await ensureGatewaySession(sessionId, sandboxId, runtime);
    res = await doPut();
  }
  const text = await res.text();
  let data: { success?: boolean; message?: string; error?: boolean } = {};
  try {
    data = JSON.parse(text) as {
      success?: boolean;
      message?: string;
      error?: boolean;
    };
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
  runtime?: AgentRuntime,
): Promise<{ success?: boolean; content?: string; message?: string }> {
  const q = new URLSearchParams({ path });
  const doGet = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/file?${q.toString()}`, {
      method: "GET",
    });
  let res = await doGet();
  if (res.status === 404 && sandboxId) {
    await ensureGatewaySession(sessionId, sandboxId, runtime);
    res = await doGet();
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as {
      success?: boolean;
      content?: string;
      message?: string;
    };
  } catch {
    return { success: res.ok, content: text, message: text.slice(0, 200) };
  }
}

export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 8) {
      const visible = s.slice(0, 4) + "…" + s.slice(-4);
      out = out.split(s).join(visible);
    }
  }
  out = out.replace(/\brk_[a-f0-9]{20,}\b/gi, "rk_…[redacted]");
  out = out.replace(/\bsk-[A-Za-z0-9_\-]{10,}\b/g, "sk-…[redacted]");
  out = out.replace(/\b\d{6,}:[A-Za-z0-9_\-]{20,}\b/g, "telegram:…[redacted]");
  out = out.replace(/\bxoxb-[A-Za-z0-9\-]+/g, "xoxb-…[redacted]");
  out = out.replace(/\bxapp-[A-Za-z0-9\-]+/g, "xapp-…[redacted]");
  return out;
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    // support optional "export KEY=val"
    const body = t.startsWith("export ") ? t.slice(7).trim() : t;
    const i = body.indexOf("=");
    if (i < 0) continue;
    const key = body.slice(0, i).trim();
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
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Common provider API key env names (profile.apiKey still preferred). */
const API_KEY_ENV_NAMES = [
  "XIBECODE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ROUTINGRUN_API_KEY",
  "OPENROUTER_API_KEY",
  "NOUS_API_KEY",
  "HERMES_API_KEY",
  "ZENLLM_API_KEY",
  "DEEPSEEK_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "PERPLEXITY_API_KEY",
  "COHERE_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "HF_TOKEN",
  "AZURE_FOUNDRY_API_KEY",
  "LM_API_KEY",
  "OLLAMA_API_KEY",
] as const;

function apiKeyFromEnv(env: Record<string, string>): string {
  for (const k of API_KEY_ENV_NAMES) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  // any *API_KEY leftover (provider-specific)
  for (const [k, v] of Object.entries(env)) {
    if (!v?.trim()) continue;
    if (/_API_KEY$/i.test(k) || k === "HF_TOKEN") return v.trim();
  }
  return "";
}

export type SavedProviderView = {
  id: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyHint?: string;
  format?: ApiWireFormat;
};

export type SandboxConfigView = {
  runtime?: AgentRuntime;
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
  savedProviders?: SavedProviderView[];
  format?: ApiWireFormat;
  /** Supercharge image generation (`/isetup`). Independent of chat provider. */
  imageProvider?: string;
  imageModel?: string;
  imageBaseUrl?: string;
  imageFormat?: string;
  imageApiKey?: string;
  hasImageApiKey?: boolean;
  imageApiKeyHint?: string;
};

function hint(secret: string | undefined): string | undefined {
  if (!secret || secret.length < 8) return secret ? "••••" : undefined;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function emptyConfigView(runtime: AgentRuntime = "xibecode"): SandboxConfigView {
  return {
    runtime,
    hasApiKey: false,
    hasTelegramToken: false,
    hasDiscordToken: false,
    hasSlackToken: false,
    allowAllUsers: false,
    savedProviders: [],
    imageProvider: "",
    imageModel: "",
    imageBaseUrl: "",
    imageFormat: "openai_images",
    hasImageApiKey: false,
  };
}

function toSavedView(slot: SavedProvider): SavedProviderView {
  return {
    id: slot.id,
    provider: slot.provider,
    model: slot.model,
    baseUrl: slot.baseUrl,
    apiKey: slot.apiKey,
    apiKeyHint: hint(slot.apiKey),
    format: slot.format,
  };
}

function parseProfileJson(raw: string): Record<string, unknown> {
  try {
    const data = JSON.parse(raw || "{}") as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function strField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string"
    ? v.trim()
    : v != null && typeof v !== "object"
      ? String(v).trim()
      : "";
}

function viewFromSources(
  env: Record<string, string>,
  profile: Record<string, unknown>,
  runtimeHint?: AgentRuntime,
): SandboxConfigView {
  // Prefer profile (what xibecode CLI/Telegram setup writes) then daemon/gateway env.
  const apiKey = pick(strField(profile, "apiKey"), apiKeyFromEnv(env));
  const tg = pick(
    env.TELEGRAM_BOT_TOKEN,
    env.XIBECODE_TELEGRAM_BOT_TOKEN,
    strField(profile, "telegramBotToken"),
  );
  const dc = pick(
    env.DISCORD_BOT_TOKEN,
    env.XIBECODE_DISCORD_BOT_TOKEN,
    strField(profile, "discordBotToken"),
  );
  const slackBot = pick(
    env.SLACK_BOT_TOKEN,
    env.XIBECODE_SLACK_BOT_TOKEN,
    strField(profile, "slackBotToken"),
  );
  const slackApp = pick(
    env.SLACK_APP_TOKEN,
    env.XIBECODE_SLACK_APP_TOKEN,
    strField(profile, "slackAppToken"),
  );
  const model = pick(
    strField(profile, "model"),
    env.SUPERAGENT_MODEL,
    env.XIBECODE_MODEL,
  );
  const baseUrl = pick(
    strField(profile, "baseUrl"),
    env.SUPERAGENT_PROVIDER_BASE_URL,
    env.SUPERAGENT_BASE_URL,
    env.XIBECODE_BASE_URL,
    env.OPENAI_BASE_URL,
    env.ANTHROPIC_BASE_URL,
  );
  const inferredRuntime: AgentRuntime =
    strField(profile, "runtime").toLowerCase() === "supercharge" ||
    env.SUPERCHARGE_RUNTIME === "supercharge" ||
    env.SUPERAGENT_RUNTIME === "supercharge"
      ? "supercharge"
      : "xibecode";
  const runtime = runtimeHint || inferredRuntime;
  const provider = pick(
    strField(profile, "provider"),
    env.SUPERAGENT_PROVIDER,
    env.XIBECODE_PROVIDER,
    env.ANTHROPIC_API_KEY ? "anthropic" : "",
    "openai",
  );
  const slackOk = Boolean(slackBot && slackApp);
  const format = normalizeApiWireFormat(
    pick(
      strField(profile, "format"),
      env.SUPERAGENT_PROVIDER_FORMAT,
    ),
    provider,
  );
  const current = slotFromActive({
    provider: provider || "openai",
    apiKey,
    baseUrl,
    model,
    format,
  });
  const saved = upsertSavedProvider(
    parseSavedProviders(profile.savedProviders),
    current || {
      id: provider || "openai",
      provider: provider || "openai",
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      model: model || undefined,
    },
  );
  return {
    runtime,
    provider: provider || "openai",
    model: model || "",
    baseUrl: baseUrl || "",
    hasApiKey: Boolean(apiKey),
    hasTelegramToken: Boolean(tg),
    hasDiscordToken: Boolean(dc),
    hasSlackToken: slackOk,
    apiKey: apiKey || undefined,
    telegramBotToken: tg || undefined,
    discordBotToken: dc || undefined,
    slackBotToken: slackBot || undefined,
    slackAppToken: slackApp || undefined,
    allowAllUsers: env.GATEWAY_ALLOW_ALL_USERS === "true",
    apiKeyHint: hint(apiKey),
    telegramHint: hint(tg),
    discordHint: hint(dc),
    slackHint: slackOk ? hint(slackBot) : undefined,
    savedProviders: saved.map(toSavedView),
    format,
    ...imageFieldsFromSources(env, profile, provider, baseUrl),
  };
}

function imageProfile(profile: Record<string, unknown>): Record<string, unknown> {
  const raw = profile.imageProvider;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function imageFieldsFromSources(
  env: Record<string, string>,
  profile: Record<string, unknown>,
  chatProvider: string,
  chatBaseUrl: string,
): Pick<
  SandboxConfigView,
  | "imageProvider"
  | "imageModel"
  | "imageBaseUrl"
  | "imageFormat"
  | "imageApiKey"
  | "hasImageApiKey"
  | "imageApiKeyHint"
> {
  const img = imageProfile(profile);
  const imageProvider = pick(
    strField(img, "id"),
    strField(img, "provider"),
    env.SUPERAGENT_IMAGE_PROVIDER,
    chatProvider || "pollinations",
  );
  const imageBaseUrl = pick(
    strField(img, "baseUrl"),
    env.SUPERAGENT_IMAGE_BASE_URL,
    chatBaseUrl,
    stockBaseUrl(imageProvider),
  );
  const imageModel = pick(
    strField(img, "model"),
    env.SUPERAGENT_IMAGE_MODEL,
    defaultImageModel(imageProvider),
  );
  const imageFormat = pick(
    strField(img, "format"),
    env.SUPERAGENT_IMAGE_FORMAT,
    imageProviderFormat(imageProvider),
  );
  const imageApiKey = pick(
    strField(img, "apiKey"),
    env.SUPERAGENT_IMAGE_API_KEY,
  );
  return {
    imageProvider,
    imageModel,
    imageBaseUrl,
    imageFormat,
    imageApiKey: imageApiKey || undefined,
    hasImageApiKey: Boolean(imageApiKey),
    imageApiKeyHint: hint(imageApiKey),
  };
}

/** Config currently on the sandbox — full secrets for authenticated owner edit. */
export async function readSandboxConfig(
  sessionId: string,
  sandboxId?: string,
  runtime?: AgentRuntime,
): Promise<SandboxConfigView> {
  try {
    // One shell dump is more reliable than separate file reads (and picks up
    // profile-*.json + both env files that Telegram / CLI setup may write).
    const preferredConfigHome =
      runtime === "supercharge"
        ? "/home/user/.superagent"
        : "/home/user/.xibecode";
    const secondaryConfigHome =
      runtime === "supercharge"
        ? "/home/user/.xibecode"
        : "/home/user/.superagent";
    const dump = await execInSession(
      sessionId,
      `python3 - <<'PY'
import json, os
from pathlib import Path
candidates = [
    Path(os.path.expanduser("~/${preferredConfigHome.split("/").pop()}")),
    Path(os.path.expanduser("~/${secondaryConfigHome.split("/").pop()}")),
    Path("${preferredConfigHome}"),
    Path("${secondaryConfigHome}"),
]
home = next((p for p in candidates if p.is_dir() and any((p / n).is_file() for n in ("daemon.env", "gateway.env", "profile-default.json", "config.json"))), candidates[0])
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
      { timeout: 45, sandboxId, runtime },
    );

    if (dump.stdout?.trim()) {
      try {
        const parsed = JSON.parse(dump.stdout.trim()) as {
          env?: Record<string, string>;
          profile?: Record<string, unknown>;
        };
        return viewFromSources(parsed.env || {}, parsed.profile || {}, runtime);
      } catch {
        /* fall through to file reads */
      }
    }

    // Fallback: direct file reads (older gateway / python missing)
    const configHome =
      runtime === "supercharge"
        ? "/home/user/.superagent"
        : "/home/user/.xibecode";
    const envFile = await readFileInSession(
      sessionId,
      `${configHome}/daemon.env`,
      sandboxId,
      runtime,
    );
    const gatewayEnvFile = await readFileInSession(
      sessionId,
      `${configHome}/gateway.env`,
      sandboxId,
      runtime,
    );
    const profileFile = await readFileInSession(
      sessionId,
      `${configHome}/profile-default.json`,
      sandboxId,
      runtime,
    );
    const env = {
      ...parseEnvFile(gatewayEnvFile.content || ""),
      ...parseEnvFile(envFile.content || ""),
    };
    const profile = parseProfileJson(profileFile.content || "");
    return viewFromSources(env, profile, runtime);
  } catch {
    return emptyConfigView(runtime);
  }
}

/** Inspect the live sandbox image to see which agent stack is installed. */
export async function detectSandboxRuntime(
  sessionId: string,
  sandboxId?: string,
  runtime?: AgentRuntime,
): Promise<AgentRuntime | "unknown"> {
  try {
    const r = await execInSession(
      sessionId,
      [
        "if [ -x /usr/local/bin/supercharge-superagent-server ] || [ -x /usr/local/bin/supercharge ]; then echo supercharge; exit 0; fi",
        "if command -v xibecode >/dev/null 2>&1; then echo xibecode; exit 0; fi",
        "if pgrep -af 'xibecode|supercharge-superagent-server' 2>/dev/null | grep -q supercharge-superagent-server; then echo supercharge; exit 0; fi",
        "if pgrep -af xibecode 2>/dev/null | grep -q xibecode; then echo xibecode; exit 0; fi",
        "echo unknown",
      ].join("\n"),
      { timeout: 30, sandboxId, runtime },
    );
    const line = (r.stdout || "").trim().split("\n").pop()?.trim();
    if (line === "supercharge" || line === "xibecode") return line;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export type ConfigInput = {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  format?: string;
  /** Full list from the editor. Omitted = keep existing + upsert current. */
  savedProviders?: SavedProvider[];
  /** Vectra instance id — used to mint public vision URLs. */
  instanceId?: string;
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
  /**
   * Template wake HTTP (E2B auto-resume doorbell on :8788 — not the bot).
   * When set, hosting starts /opt/vectra/wake-http and Telegram may setWebhook there.
   */
  telegramWebhookUrl?: string;
  telegramWebhookSecret?: string;
  telegramWebhookPort?: number;
  runtime?: AgentRuntime;
  imageProvider?: string;
  imageModel?: string;
  imageBaseUrl?: string;
  imageApiKey?: string;
  imageFormat?: string;
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
  const runtime: AgentRuntime = input.runtime || "xibecode";
  const runtimeHome =
    runtime === "supercharge"
      ? "/home/user/.superagent"
      : "/home/user/.xibecode";

  let existing = await readSandboxConfig(sessionId, sandboxId, runtime);

  // Full profile for merge (preserve unrelated conf keys like plugins, theme, etc.)
  let prevProfile: Record<string, unknown> = {};
  try {
    const pf = await readFileInSession(
      sessionId,
      `${runtimeHome}/profile-default.json`,
      sandboxId,
      runtime,
    );
    prevProfile = parseProfileJson(pf.content || "");
  } catch {
    /* first write */
  }

  const runtimeEnvBodyPrefix =
    runtime === "supercharge" ? "SUPERAGENT" : "XIBECODE";
  const provider =
    (input.provider || existing.provider || "pollinations").replace(
      /[^a-z0-9_-]/gi,
      "",
    ) || "pollinations";
  const model = (input.model ?? existing.model ?? "").trim();
  const baseUrl = (input.baseUrl ?? existing.baseUrl ?? "").trim();
  const sanitizeId = (raw: string, fallback: string) =>
    raw.replace(/[^a-z0-9_-]/gi, "") || fallback;
  const imageProvider = sanitizeId(
    (input.imageProvider || existing.imageProvider || provider).trim(),
    provider,
  );
  const imageBaseUrl = (
    input.imageBaseUrl ??
    existing.imageBaseUrl ??
    stockBaseUrl(imageProvider) ??
    baseUrl
  ).trim();
  const imageModel = (
    input.imageModel ??
    existing.imageModel ??
    defaultImageModel(imageProvider)
  ).trim();
  const imageFormat = (
    input.imageFormat ||
    existing.imageFormat ||
    imageProviderFormat(imageProvider)
  ).trim();

  const merge = input.mergeExisting !== false;
  const apiKey =
    (input.apiKey || "").trim() || (merge ? existing.apiKey || "" : "");
  const telegramBotToken =
    (input.telegramBotToken || "").trim() ||
    (merge ? existing.telegramBotToken || "" : "");
  const discordBotToken =
    (input.discordBotToken || "").trim() ||
    (merge ? existing.discordBotToken || "" : "");
  const slackBotToken =
    (input.slackBotToken || "").trim() ||
    (merge ? existing.slackBotToken || "" : "");
  const slackAppToken =
    (input.slackAppToken || "").trim() ||
    (merge ? existing.slackAppToken || "" : "");
  const imageApiKey =
    (input.imageApiKey || "").trim() ||
    (merge ? existing.imageApiKey || "" : "") ||
    (imageProvider === provider && imageBaseUrl === (baseUrl || stockBaseUrl(provider))
      ? apiKey
      : "");

  if (!apiKey) {
    return {
      ok: false,
      logs: ["API key is required (enter a new key or set one first)."],
      meta: existing,
    };
  }
  if (Boolean(slackBotToken) !== Boolean(slackAppToken)) {
    return {
      ok: false,
      logs: [
        "Slack needs both SLACK_BOT_TOKEN (xoxb-…) and SLACK_APP_TOKEN (xapp-…).",
      ],
      meta: existing,
    };
  }
  const incomingSaved = Array.isArray(input.savedProviders)
    ? parseSavedProviders(input.savedProviders)
    : parseSavedProviders(prevProfile.savedProviders);
  const providerFormat = normalizeApiWireFormat(
    input.format || existing.format,
    provider,
  );
  const currentSlot = slotFromActive({
    provider,
    apiKey,
    baseUrl,
    model,
    format: providerFormat,
  });
  const savedProviders = currentSlot
    ? upsertSavedProvider(incomingSaved, currentSlot)
    : incomingSaved;
  for (const slot of savedProviders) {
    if (slot.apiKey) secrets.push(slot.apiKey);
  }

  secrets.push(
    apiKey,
    telegramBotToken,
    discordBotToken,
    slackBotToken,
    slackAppToken,
    imageApiKey,
  );

  const inboxSecret =
    process.env.XIBECODE_APP_INBOX_SECRET?.trim() ||
    process.env.XIBECODE_GATEWAY_TOKEN?.trim() ||
    "";
  if (inboxSecret) secrets.push(inboxSecret);

  // Prefer pairing (secure) unless tenant opts into open access.
  // If the form omits the flag, keep previous value; brand-new installs default to pairing.
  const openAccess =
    typeof input.allowAllUsers === "boolean"
      ? input.allowAllUsers
      : Boolean(existing.allowAllUsers);

  const channels: string[] = ["app"];
  if (telegramBotToken) channels.push("telegram");
  if (discordBotToken) channels.push("discord");
  if (slackBotToken) channels.push("slack");

  // Template wake HTTP (E2B doorbell on public URL) — separate from the bot long-poll
  const tgWebhookUrl = (input.telegramWebhookUrl || "").trim();
  const tgWebhookSecret = (input.telegramWebhookSecret || "").trim();
  const tgWebhookPort = Math.floor(
    Number(input.telegramWebhookPort) || (tgWebhookUrl ? 8788 : 0),
  );
  const sandboxWakeHttp =
    Boolean(telegramBotToken) && Boolean(tgWebhookUrl) && tgWebhookPort > 0;
  const providerKeyEnv = envKeysForProvider(provider)[0] || "OPENAI_API_KEY";
  const providerBaseUrl = baseUrl || stockBaseUrl(provider);
  const mediaBase = input.instanceId
    ? `${(
        process.env.PUBLIC_BASE_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim() ||
        "https://infra.xibeai.in"
      ).replace(
        /\/$/,
        "",
      )}/api/public/media/${encodeURIComponent(input.instanceId)}`
    : "";
  const channelEnv = [
    telegramBotToken ? `TELEGRAM_BOT_TOKEN=${telegramBotToken}` : "",
    discordBotToken ? `DISCORD_BOT_TOKEN=${discordBotToken}` : "",
    slackBotToken ? `SLACK_BOT_TOKEN=${slackBotToken}` : "",
    slackAppToken ? `SLACK_APP_TOKEN=${slackAppToken}` : "",
    openAccess
      ? `GATEWAY_ALLOW_ALL_USERS=true`
      : `GATEWAY_ALLOW_ALL_USERS=false`,
    ...savedProviders.flatMap((slot) =>
      slot.apiKey
        ? envKeysForProvider(slot.provider).map(
            (key) => `${key}=${slot.apiKey}`,
          )
        : [],
    ),
    ...envKeysForProvider(provider).map((key) => `${key}=${apiKey}`),
    provider === "anthropic" ? `ANTHROPIC_API_KEY=${apiKey}` : "",
    provider === "openai" || !envKeysForProvider(provider).length
      ? `OPENAI_API_KEY=${apiKey}`
      : "",
  ];
  const runtimeEnv =
    runtime === "supercharge"
      ? [
          `SUPERAGENT_PROVIDER=${provider}`,
          `SUPERAGENT_AGENT_BINARY=/usr/local/bin/supercharge`,
          inboxSecret ? `SUPERAGENT_API_TOKEN=${inboxSecret}` : "",
          inboxSecret ? `SUPERAGENT_APP_INBOX_SECRET=${inboxSecret}` : "",
          model ? `SUPERAGENT_MODEL=${model}` : "",
          providerBaseUrl
            ? `SUPERAGENT_PROVIDER_BASE_URL=${providerBaseUrl}`
            : "",
          `SUPERAGENT_PROVIDER_FORMAT=${providerFormat}`,
          `SUPERAGENT_PROVIDER_API_KEY_ENV=${providerKeyEnv}`,
          `SUPERAGENT_PROVIDER_CONFIG_PATH=/home/user/.supercharge/provider-config.toml`,
          imageProvider ? `SUPERAGENT_IMAGE_PROVIDER=${imageProvider}` : "",
          imageModel ? `SUPERAGENT_IMAGE_MODEL=${imageModel}` : "",
          imageBaseUrl ? `SUPERAGENT_IMAGE_BASE_URL=${imageBaseUrl}` : "",
          imageFormat ? `SUPERAGENT_IMAGE_FORMAT=${imageFormat}` : "",
          imageApiKey ? `SUPERAGENT_IMAGE_API_KEY=${imageApiKey}` : "",
          `SUPERAGENT_BIND=0.0.0.0:8790`,
          `SUPERAGENT_DAEMON_WORKDIR=/home/user/workspace`,
          `SUPERAGENT_SHARE_WORKSPACE_ROOT=/home/user/workspace`,
          `SUPERAGENT_MEDIA_ROOT=/home/user/workspace/.superagent-media`,
          `SUPERAGENT_BROWSER_CONTROL_ENABLED=true`,
          `SUPERAGENT_WAKE_PORT=8788`,
          `SUPERAGENT_RUNTIME=supercharge`,
          `SUPERCHARGE_RUNTIME=supercharge`,
          `SUPERCHARGE_RUNTIME_MODE=e2b`,
          `SUPERAGENT_APP_INBOX_PORT=8790`,
          input.instanceId ? `SUPERAGENT_INSTANCE_ID=${input.instanceId}` : "",
          mediaBase ? `SUPERAGENT_PUBLIC_MEDIA_BASE=${mediaBase}` : "",
          sandboxWakeHttp ? `SUPERAGENT_TG_WEBHOOK_URL=${tgWebhookUrl}` : "",
          sandboxWakeHttp && tgWebhookSecret
            ? `SUPERAGENT_TELEGRAM_WEBHOOK_SECRET=${tgWebhookSecret}`
            : "",
        ]
      : [
          `XIBECODE_API_KEY=${apiKey}`,
          `XIBECODE_PROVIDER=${provider}`,
          model ? `XIBECODE_MODEL=${model}` : "",
          baseUrl ? `XIBECODE_BASE_URL=${baseUrl}` : "",
          baseUrl && provider !== "anthropic"
            ? `OPENAI_BASE_URL=${baseUrl}`
            : "",
          `XIBECODE_DAEMON_WORKDIR=/home/user/workspace`,
          `XIBECODE_RUNTIME=xibecode`,
          inboxSecret ? `XIBECODE_APP_INBOX_SECRET=${inboxSecret}` : "",
          inboxSecret ? `XIBECODE_GATEWAY_TOKEN=${inboxSecret}` : "",
          `XIBECODE_APP_INBOX_PORT=8790`,
          `AGENT_BROWSER_STREAM_PORT=9223`,
          `AGENT_BROWSER_STREAM_QUALITY=40`,
          `AGENT_BROWSER_STREAM_MAX_WIDTH=960`,
          `AGENT_BROWSER_STREAM_MAX_HEIGHT=540`,
          input.instanceId ? `XIBECODE_INSTANCE_ID=${input.instanceId}` : "",
          mediaBase ? `XIBECODE_PUBLIC_MEDIA_BASE=${mediaBase}` : "",
        ];
  const envBody =
    [
      ...channelEnv,
      ...runtimeEnv,
      // Template wake HTTP only (does NOT enable bot webhook mode).
      sandboxWakeHttp ? `VECTRA_WAKE_PORT=${tgWebhookPort}` : "",
      sandboxWakeHttp ? `VECTRA_TG_WEBHOOK_URL=${tgWebhookUrl}` : "",
      sandboxWakeHttp ? `TELEGRAM_WEBHOOK_URL=${tgWebhookUrl}` : "",
      sandboxWakeHttp && tgWebhookSecret
        ? `TELEGRAM_WEBHOOK_SECRET=${tgWebhookSecret}`
        : "",
    ]
      .filter((line) => line !== "")
      .join("\n") + "\n";

  // Merge into existing conf profile so we don't wipe unrelated settings.
  const mergedProfile = {
    ...prevProfile,
    provider,
    format: providerFormat,
    ...(model ? { model } : {}),
    ...(baseUrl
      ? { baseUrl }
      : prevProfile.baseUrl
        ? { baseUrl: prevProfile.baseUrl }
        : {}),
    apiKey,
    runtime,
    savedProviders,
    imageProvider: {
      id: imageProvider,
      provider: imageProvider,
      baseUrl: imageBaseUrl,
      model: imageModel,
      format: imageFormat,
      ...(imageApiKey ? { apiKey: imageApiKey } : {}),
    },
  };
  const profileJson = JSON.stringify(mergedProfile, null, 2);
  const tomlQuote = (value: string) => JSON.stringify(value);
  const providerToml = [
    `[model.${tomlQuote(provider)}]`,
    `model = ${tomlQuote(model || provider)}`,
    `name = ${tomlQuote(provider)}`,
    `description = ${tomlQuote(`${provider} provider profile`)}`,
    `base_url = ${tomlQuote(providerBaseUrl)}`,
    `api_base_url = ${tomlQuote(providerBaseUrl)}`,
    `env_key = ${tomlQuote(providerKeyEnv)}`,
    `api_backend = ${tomlQuote(providerFormat)}`,
    `agent_type = ${tomlQuote("supercharge-e2b")}`,
    "context_window = 128000",
    "",
  ].join("\n");

  await execInSession(sessionId, `mkdir -p ${runtimeHome} /home/user/.supercharge`, {
    timeout: 30,
    sandboxId,
    runtime,
  });
  const runtimeEnvBody = envBody;
  const w1 = await writeFileInSession(
    sessionId,
    `${runtimeHome}/daemon.env`,
    runtimeEnvBody,
    sandboxId,
    runtime,
  );
  const w2 = await writeFileInSession(
    sessionId,
    `${runtimeHome}/gateway.env`,
    runtimeEnvBody,
    sandboxId,
    runtime,
  );
  const w3 = await writeFileInSession(
    sessionId,
    `${runtimeHome}/profile-default.json`,
    profileJson,
    sandboxId,
    runtime,
  );
  const imageProviderToml = [
    `[image_provider]`,
    `id = ${tomlQuote(imageProvider)}`,
    `base_url = ${tomlQuote(imageBaseUrl || providerBaseUrl)}`,
    `model = ${tomlQuote(imageModel)}`,
    `format = ${tomlQuote(imageFormat || imageProviderFormat(imageProvider))}`,
    imageApiKey ? `api_key = ${tomlQuote(imageApiKey)}` : "",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const w4 =
    runtime === "supercharge"
      ? await writeFileInSession(
          sessionId,
          "/home/user/.supercharge/provider-config.toml",
          providerToml,
          sandboxId,
          runtime,
        )
      : { success: true, message: "not needed" };
  const w5 =
    runtime === "supercharge"
      ? await writeFileInSession(
          sessionId,
          "/home/user/.supercharge/image-provider.fragment.toml",
          imageProviderToml,
          sandboxId,
          runtime,
        )
      : { success: true, message: "not needed" };
  if (
    w1.success === false ||
    w2.success === false ||
    w3.success === false ||
    w4.success === false ||
    w5.success === false
  ) {
    logs.push(
      redact(
        `WRITE FAILED: daemon.env=${w1.message || w1.success} gateway.env=${w2.message || w2.success} profile=${w3.message || w3.success} providerToml=${w4.message || w4.success} imageToml=${w5.message || w5.success}`,
      ),
    );
    return { ok: false, logs, meta: existing };
  }

  await execInSession(
    sessionId,
    [
      `chmod 600 ${runtimeHome}/daemon.env ${runtimeHome}/gateway.env ${runtimeHome}/profile-default.json /home/user/.supercharge/provider-config.toml /home/user/.supercharge/image-provider.fragment.toml 2>/dev/null; true`,
      runtime === "supercharge"
        ? `python3 -c "from pathlib import Path; import re; frag=Path('/home/user/.supercharge/image-provider.fragment.toml').read_text(); p=Path('/home/user/.supercharge/config.toml'); text=p.read_text() if p.exists() else ''; text=re.sub(r'(?ms)^\\\\[image_provider\\\\][^\\\\[]*', '', text); p.parent.mkdir(parents=True, exist_ok=True); p.write_text((text.rstrip()+chr(10)+chr(10)+frag).strip()+chr(10))"`
        : "true",
    ].join("\n"),
    { timeout: 30, sandboxId, runtime },
  );

  // Verify what actually landed
  const verify = await execInSession(
    sessionId,
    `grep -E "^(${runtimeEnvBodyPrefix}_MODEL|${runtimeEnvBodyPrefix}_BASE_URL|SUPERAGENT_PROVIDER_|GATEWAY_ALLOW_ALL|TELEGRAM_|DISCORD_|SLACK_)" ${runtimeHome}/daemon.env | sed -E "s/(TOKEN|KEY)=.*/\\1=…/"; python3 -c "import json;d=json.load(open('${runtimeHome}/profile-default.json'));print('profile model=',d.get('model'),'provider=',d.get('provider'))"; if [ "${runtime}" = "supercharge" ]; then test -s /home/user/.supercharge/provider-config.toml && echo 'supercharge provider TOML=present'; fi`,
    { timeout: 30, sandboxId, runtime },
  );
  logs.push(
    redact(
      `config saved OK · channels=${channels.join("+") || "none"} · pairing=${openAccess ? "OFF (open access)" : "ON (approve in dashboard)"} · templateWake=${sandboxWakeHttp ? tgWebhookUrl : "off"} · provider=${provider} format=${providerFormat} model=${model || "(none)"} baseUrl=${baseUrl || "(none)"} · image=${imageProvider}/${imageModel || "(none)"}\n${verify.stdout || ""}`,
    ),
  );

  existing = {
    runtime,
    provider,
    model,
    format: providerFormat,
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
    savedProviders: savedProviders.map(toSavedView),
    imageProvider,
    imageModel,
    imageBaseUrl,
    imageFormat,
    imageApiKey: imageApiKey || undefined,
    hasImageApiKey: Boolean(imageApiKey),
    imageApiKeyHint: hint(imageApiKey),
  };
  return { ok: true, logs, meta: existing };
}

export type PairingView = {
  pending: Array<{
    code: string;
    platform: string;
    userId: string;
    chatId: string;
    expiresAt: number;
  }>;
  approved: Array<{
    platform: string;
    userId: string;
    chatId?: string;
    approvedAt: number;
  }>;
};

export async function listPairings(
  sessionId: string,
  sandboxId?: string,
  runtime: AgentRuntime = "xibecode",
): Promise<PairingView> {
  const pairingRoot = runtime === "supercharge" ? ".superagent" : ".xibecode";
  const r = await execInSession(
    sessionId,
    `python3 - <<'PY'
import json, os
paths=[
  os.path.expanduser("~/${pairingRoot}/daemon/pairing.json"),
  os.path.expanduser("~/${pairingRoot}/gateway/pairing.json"),
]
for p in paths:
  if os.path.isfile(p):
    print(open(p).read())
    raise SystemExit(0)
print(json.dumps({"pending":[],"approved":[]}))
PY`,
    { timeout: 30, sandboxId, runtime },
  );
  try {
    return JSON.parse((r.stdout || "").trim() || "{}") as PairingView;
  } catch {
    return { pending: [], approved: [] };
  }
}

export async function approvePairingCode(
  sessionId: string,
  code: string,
  platform = "telegram",
  sandboxId?: string,
  runtime: AgentRuntime = "xibecode",
): Promise<{ ok: boolean; logs: string[] }> {
  const safe = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!safe) return { ok: false, logs: ["Invalid pairing code"] };
  const plat = platform.replace(/[^a-z]/g, "") || "telegram";
  const r = await execInSession(
    sessionId,
    runtime === "supercharge"
      ? `supercharge pair approve ${plat} ${safe} 2>&1; echo EXIT:$?`
      : `xibecode pair approve ${plat} ${safe} 2>&1; echo EXIT:$?`,
    { timeout: 60, sandboxId, runtime },
  );
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const ok = /approved|ok|success/i.test(out) || out.includes("EXIT:0");
  return { ok, logs: [out.slice(0, 800)] };
}

/** First `x.y.z` in CLI / npm / GitHub output (`v1.1.0` → `1.1.0`). */
export function parseSemverCore(text: string): string | null {
  const m = String(text || "")
    .trim()
    .replace(/^v/i, "")
    .match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/** Parse `xibecode -v` / package version from shell output. */
export function parseXibecodeVersion(text: string): string | null {
  return parseSemverCore(text);
}

function isNewerRelease(latest: string | null, current: string | null): boolean {
  if (!latest || !current) return false;
  if (!parseSemverCore(latest) || !parseSemverCore(current)) return false;
  return compareSemverCore(latest, current) > 0;
}

function superchargeUpdateRepo(): string {
  return (
    process.env.SUPERCHARGE_E2B_UPDATE_REPO?.trim() || "iotserver24/supercharge-releases"
  );
}

export function superchargeE2bUpdateBaseUrl(): string {
  return (
    process.env.SUPERCHARGE_E2B_UPDATE_BASE_URL?.trim().replace(/\/+$/, "") ||
    `https://github.com/${superchargeUpdateRepo()}/releases/latest/download`
  );
}

async function fetchSuperchargeE2bLatestVersion(): Promise<string | null> {
  const base = superchargeE2bUpdateBaseUrl();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${base}/e2b-manifest.json`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      const version = parseSemverCore(String(data.version || ""));
      if (version) return version;
    }
  } catch {
    /* fall through to GitHub API */
  } finally {
    clearTimeout(t);
  }
  try {
    const ac2 = new AbortController();
    const t2 = setTimeout(() => ac2.abort(), 8000);
    const res = await fetch(
      `https://api.github.com/repos/${superchargeUpdateRepo()}/releases/latest`,
      {
        signal: ac2.signal,
        headers: { Accept: "application/vnd.github+json" },
      },
    );
    clearTimeout(t2);
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    return parseSemverCore(data.tag_name || "") || null;
  } catch {
    return null;
  }
}

/** In-sandbox install of Supercharge daemon + CLI (existing VMs, no new template). */
export function superchargeE2bInstallScript(): string {
  const base = superchargeE2bUpdateBaseUrl();
  const daemon = `${base}/supercharge-superagent-server-linux-x86_64`;
  const cli = `${base}/supercharge-linux-x86_64`;
  return [
    "set -eu",
    'echo "--- pre version ---"',
    "supercharge --version 2>&1 || true",
    'TMP="$(mktemp -d /tmp/supercharge-e2b-update.XXXXXX)"',
    "trap 'rm -rf \"$TMP\"' EXIT",
    'echo "--- download daemon ---"',
    `curl -fL --retry 3 -o \"$TMP/supercharge-superagent-server\" "${daemon}"`,
    'echo "--- download cli ---"',
    `curl -fL --retry 3 -o \"$TMP/supercharge\" "${cli}"`,
    "chmod +x \"$TMP/supercharge-superagent-server\" \"$TMP/supercharge\"",
    'echo "--- validate binaries on this sandbox ---"',
    '"$TMP/supercharge" --version >"$TMP/version-output" 2>&1 || { cat "$TMP/version-output"; exit 1; }',
    '"$TMP/supercharge" agent daemon --help >/dev/null 2>&1 || { echo "Downloaded CLI does not support agent daemon"; exit 1; }',
    'ldd "$TMP/supercharge-superagent-server" >"$TMP/daemon-libraries" 2>&1 || { cat "$TMP/daemon-libraries"; exit 1; }',
    'if grep -q "not found" "$TMP/daemon-libraries"; then cat "$TMP/daemon-libraries"; exit 1; fi',
    'python3 -c \'import pathlib,re,sys; text=pathlib.Path(sys.argv[1]).read_text(); match=re.search(r"\\b(\\d+\\.\\d+\\.\\d+)\\b",text); sys.exit("CLI did not report a version") if match is None else print(match[1])\' "$TMP/version-output" >"$TMP/version"',
    'echo "--- install ---"',
    // Rename validated binaries instead of truncating executables that may still be running.
    'sudo -n install -m 0755 "$TMP/supercharge-superagent-server" /usr/local/bin/.supercharge-superagent-server-next-$$',
    'sudo -n install -m 0755 "$TMP/supercharge" /usr/local/bin/.supercharge-next-$$',
    'sudo -n mv -f /usr/local/bin/.supercharge-superagent-server-next-$$ /usr/local/bin/supercharge-superagent-server',
    'sudo -n mv -f /usr/local/bin/.supercharge-next-$$ /usr/local/bin/supercharge',
    "sudo -n ln -sfn /usr/local/bin/supercharge /usr/local/bin/sc",
    'sudo -n install -D -m 0644 "$TMP/version" /var/lib/superagent/e2b-version',
    'echo "--- post version ---"',
    "/usr/local/bin/supercharge --version",
    "echo UPDATE_DONE",
  ].join("\n");
}

/** Current CLI version inside the sandbox (+ npm latest from host when possible). */
export async function getCliVersionInfo(
  sessionId: string,
  sandboxId?: string,
  runtime: AgentRuntime = "xibecode",
): Promise<{
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  runtime: AgentRuntime;
  logs: string[];
}> {
  const logs: string[] = [];
  let current: string | null = null;

  const r = await execInSession(
    sessionId,
    [
      "set +e",
      runtime === "supercharge"
        ? 'echo "--- supercharge --version ---"'
        : 'echo "--- xibecode -v ---"',
      runtime === "supercharge"
        ? "supercharge --version 2>&1 || sc --version 2>&1 || true"
        : "xibecode -v 2>&1 || xibecode --version 2>&1 || true",
      'echo "--- which ---"',
      runtime === "supercharge"
        ? "which supercharge 2>/dev/null || which sc 2>/dev/null || true"
        : "which xibecode 2>/dev/null || true",
      "echo VERSION_DONE",
    ].join("\n"),
    { timeout: 60, sandboxId, runtime },
  );
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  logs.push(redactSecrets(out.slice(0, 1200)));
  current = parseSemverCore(out);
  if (runtime === "supercharge") {
    let latest: string | null = null;
    try {
      latest = await fetchSuperchargeE2bLatestVersion();
    } catch (error) {
      logs.push(`latest: ${(error as Error).message}`);
    }
    return {
      current,
      latest,
      updateAvailable: isNewerRelease(latest, current),
      runtime,
      logs,
    };
  }

  let latest: string | null = null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    const res = await fetch("https://registry.npmjs.org/xibecode/latest", {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(t);
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data.version) latest = String(data.version).trim();
    }
  } catch {
    logs.push("npm registry latest: unreachable (host)");
  }

  // Optional: try sandbox-side check if host registry failed
  if (!latest) {
    const r2 = await execInSession(
      sessionId,
      `xibecode update --check --json 2>/dev/null || true`,
      { timeout: 30, sandboxId, runtime },
    );
    const j = `${r2.stdout || ""}`;
    try {
      const parsed = JSON.parse(j) as { latest?: string; current?: string };
      if (parsed.latest) latest = String(parsed.latest);
      if (!current && parsed.current) current = String(parsed.current);
    } catch {
      /* ignore */
    }
  }

  return {
    current,
    latest,
    updateAvailable: isNewerRelease(latest, current),
    runtime,
    logs,
  };
}

/** Semver core compare (positive if a > b). Strips a leading `v`. */
export function compareSemverCore(a: string, b: string): number {
  const na = parseSemverCore(a) || a;
  const nb = parseSemverCore(b) || b;
  const coreA = na
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const coreB = nb
    .split("-")[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
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
  opts?: { sandboxId?: string; runtime?: AgentRuntime; version?: string },
): Promise<{
  ok: boolean;
  from: string | null;
  to: string | null;
  verified: string | null;
  logs: string[];
}> {
  const sandboxId = opts?.sandboxId;
  const runtime = opts?.runtime || "xibecode";
  const logs: string[] = [];

  const shell =
    runtime === "supercharge"
      ? superchargeE2bInstallScript()
      : [
          "set +e",
          'echo "--- pre version ---"',
          "xibecode -v 2>&1 || true",
          'echo "--- install ---"',
          // Global package is root-owned in the template — always prefer passwordless sudo.
          "sudo -n npm install -g xibecode@latest --no-fund --no-audit 2>&1 || sudo npm install -g xibecode@latest --no-fund --no-audit 2>&1 || npm install -g xibecode@latest --no-fund --no-audit 2>&1",
          'echo "--- post version ---"',
          "xibecode -v 2>&1 || true",
          "echo UPDATE_DONE",
        ].join("\n");

  const r = await execInSession(sessionId, shell, {
    timeout: 300,
    sandboxId,
    runtime,
    cwd: "/home/user",
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}\n${r.message || ""}`;
  logs.push(redactSecrets(out.slice(0, 5000)));

  const from = parseXibecodeVersion(out.split("--- pre version ---")[1] || "")
    || String(out.split("--- pre version ---")[1] || "").trim().split("\n").find((l) => l.trim())
    || null;
  const verified = parseXibecodeVersion(out.split("--- post version ---").pop() || "")
    || String(out.split("--- post version ---").pop() || "").trim().split("\n").find((l) => l.trim() && !l.includes("supercharge"))
    || null;

  if (
    runtime === "supercharge" &&
    (r.exitCode !== 0 || r.success === false || !/^UPDATE_DONE$/m.test(out) || !verified)
  ) {
    logs.push("Update validation failed; the daemon was not restarted.");
    return { ok: false, from, to: null, verified: null, logs };
  }

  logs.push("--- restart daemon ---");
  const restart = await restartDaemon(sessionId, sandboxId, runtime);
  logs.push(...restart.logs);

  return {
    ok: Boolean(
      (runtime === "supercharge" ? out.includes("UPDATE_DONE") : verified) &&
      restart.ok,
    ),
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
  runtime: AgentRuntime = "xibecode",
): Promise<{ ok: boolean; logs: string[] }> {
  const runtimeHome =
    runtime === "supercharge"
      ? "/home/user/.superagent"
      : "/home/user/.xibecode";
  const daemonPidFile =
    runtime === "supercharge"
      ? "/tmp/supercharge-daemon.pid"
      : "/tmp/xibecode-daemon.pid";
  const daemonLogFile =
    runtime === "supercharge"
      ? "/tmp/supercharge-daemon.log"
      : "/tmp/xibecode-daemon.log";
  const daemonCommand =
    runtime === "supercharge"
      ? process.env.SUPERCHARGE_SANDBOX_DAEMON_COMMAND?.trim() ||
        "supercharge agent daemon --bind 0.0.0.0:8790"
      : process.env.XIBECODE_SANDBOX_DAEMON_COMMAND?.trim() ||
        "xibecode daemon --workdir /home/user/workspace";
  const daemonMatch =
    runtime === "supercharge"
      ? process.env.SUPERCHARGE_SANDBOX_DAEMON_MATCH?.trim() ||
        "supercharge agent daemon|supercharge-superagent-server|superagent-server"
      : process.env.XIBECODE_SANDBOX_DAEMON_MATCH?.trim() ||
        "node.*xibecode|xibecode/dist";
  const daemonLabel = runtime === "supercharge" ? "supercharge" : "xibecode";
  // Bot stays long-poll. Template wake HTTP (:8788) is a separate process for E2B
  // auto-resume when Telegram (or host) hits the sandbox public URL.
  const setupCmd = [
    "set +e",
    "set -a",
    `[ -f ${runtimeHome}/daemon.env ] && . ${runtimeHome}/daemon.env`,
    `[ -f ${runtimeHome}/gateway.env ] && . ${runtimeHome}/gateway.env`,
    "set +a",
    ...(runtime === "supercharge" ? [
      'export SUPERAGENT_SESSION_STATE=/home/user/.supercharge/state/sessions.json',
      'export SUPERAGENT_BOT_STATE=/home/user/.supercharge/state/bots.json',
      'export SUPERAGENT_BOT_QUEUE_STATE=/home/user/.supercharge/state/bot-queue.json',
      'export SUPERAGENT_BOT_MAINTENANCE_STATE=/home/user/.supercharge/state/bot-maintenance',
      'export SUPERAGENT_JOB_STATE=/home/user/.supercharge/state/jobs.json',
      'export SUPERAGENT_SCHEDULE_STATE=/home/user/.supercharge/state/schedules.json',
      'export SUPERAGENT_CONTROL_STATE=/home/user/.supercharge/state/controls.json',
      'export SUPERAGENT_GATEWAY_STATE=/home/user/.supercharge/state/gateway-state.json',
      'export SUPERAGENT_E2B_SESSION_STATE=/home/user/.supercharge/state/e2b-sessions.json',
      'export SUPERAGENT_PLUGIN_CONTROL=/opt/vectra/plugin-api/control.mjs',
      'export SUPERAGENT_PLUGIN_API_NODE=/opt/vectra/plugin-api/node/bin/node',
      'export SUPERAGENT_PLUGIN_CONTROL_CAPABILITY_FILE=/home/user/.superagent/plugin-control.capability',
    ] : []),
    'export SUPERAGENT_BIND="${SUPERAGENT_BIND:-0.0.0.0:8790}"',
    'export SUPERAGENT_APP_INBOX_PORT="${SUPERAGENT_APP_INBOX_PORT:-${XIBECODE_APP_INBOX_PORT:-8790}}"',
    // Start template wake doorbell first (must be running before pause snapshot)
    "if [ -x /opt/vectra/wake-http/start.sh ]; then",
    "  /opt/vectra/wake-http/start.sh || true",
    '  echo "template wake-http: started (or already up)"',
    "else",
    '  echo "template wake-http: missing /opt/vectra/wake-http (rebuild E2B template)"',
    "fi",
    // Bot long-poll: clear webhook so getUpdates works while running
    'if [ -n "${TELEGRAM_BOT_TOKEN:-}${XIBECODE_TELEGRAM_BOT_TOKEN:-}" ]; then',
    '  TOK="${TELEGRAM_BOT_TOKEN:-$XIBECODE_TELEGRAM_BOT_TOKEN}"',
    '  curl -sS -m 10 -X POST "https://api.telegram.org/bot${TOK}/deleteWebhook" -d "drop_pending_updates=false" >/dev/null 2>&1 || true',
    '  echo "telegram bot: long-poll (webhook cleared while running)"',
    "fi",
    // NEVER pkill -f "xibecode daemon" here: the exec shell cmdline contains that
    // string, so pkill kills *this* restart script (signal: terminated / exit 1).
    `if [ -f ${daemonPidFile} ]; then`,
    `  OLD="$(cat ${daemonPidFile} 2>/dev/null)"`,
    '  if [ -n "$OLD" ]; then kill "$OLD" 2>/dev/null || true; sleep 1; kill -9 "$OLD" 2>/dev/null || true; fi',
    `  rm -f ${daemonPidFile}`,

    "fi",
    // Kill only real daemon node processes; exclude our shell ($$) and pgrep itself
    `for pid in $(pgrep -f "${daemonMatch}" 2>/dev/null || true); do`,
    '  if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then',
    '    case "$(tr "\\0" " " < /proc/$pid/cmdline 2>/dev/null || true)" in',
    '      *daemon*) kill "$pid" 2>/dev/null || true ;;',
    "    esac",
    "  fi",
    "done",
    "sleep 1",
    `nohup ${daemonCommand} >${daemonLogFile} 2>&1 &`,
    `echo $! > ${daemonPidFile}`,

    "OK=0",
    'INBOX="${SUPERAGENT_APP_INBOX_PORT:-${XIBECODE_APP_INBOX_PORT:-8790}}"',
    "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do",
    "  sleep 1",
    '  if curl -sf -m 2 "http://127.0.0.1:${INBOX}/health" >/dev/null 2>&1 || curl -sf -m 2 "http://127.0.0.1:${INBOX}/healthz" >/dev/null 2>&1; then OK=1; break; fi',
    ...(runtime === "supercharge"
      ? [`  if ! kill -0 "$(cat ${daemonPidFile} 2>/dev/null)" 2>/dev/null; then break; fi`]
      : [
          `  if [ -f ${daemonPidFile} ] && kill -0 "$(cat ${daemonPidFile})" 2>/dev/null; then OK=1; break; fi`,
          `  if pgrep -af "${daemonMatch}" 2>/dev/null | grep -vF "pgrep" | grep -q .; then OK=1; break; fi`,
        ]),
    "done",
    `if [ "$OK" = "1" ]; then echo "${daemonLabel} daemon: running"; else echo "${daemonLabel} daemon: not found"; fi`,
    'curl -sS -m 2 "http://127.0.0.1:${INBOX}/health" 2>/dev/null | head -c 200 || curl -sS -m 2 "http://127.0.0.1:${INBOX}/healthz" 2>/dev/null | head -c 200 || true',
    "echo",
    'WP="${VECTRA_WAKE_PORT:-8788}"',
    'if curl -sS -m 2 "http://127.0.0.1:${WP}/health" 2>/dev/null | grep -q ok; then echo "template wake-http: listening :${WP}"; fi',
    'echo "--- daemon pid ---"',
    `cat ${daemonPidFile} 2>/dev/null || true`,
    'echo "--- daemon log ---"',
    `tail -80 ${daemonLogFile} 2>/dev/null || true`,
    'echo "--- processes ---"',
    "ps -o pid,user,comm -C node 2>/dev/null | head -15 || true",
    "echo RESTART_DONE",
  ].join("\n");

  const r = await execInSession(sessionId, setupCmd, {
    timeout: 180,
    sandboxId,
    runtime,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}\n${r.message || ""}`;
  const logs = [
    redactSecrets(
      `restart runtime=${runtime} exit=${r.exitCode ?? "?"} ${out.slice(0, 2500)}`,
    ),
  ];
  const ok = runtime === "supercharge"
    ? r.exitCode === 0 && /^supercharge daemon: running$/m.test(out)
    : out.includes(`${daemonLabel} daemon: running`) ||
      out.includes("RESTART_DONE") ||
      /telegram enabled|discord enabled|slack enabled/i.test(out);
  // Prefer explicit process check; RESTART_DONE alone can mean shell finished after a dead spawn
  if (
    out.includes(`${daemonLabel} daemon: not found`) &&
    !out.includes(`${daemonLabel} daemon: running`)
  ) {
    return { ok: false, logs };
  }
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
    runtime?: AgentRuntime;
    sandboxId?: string;
    telegramWebhookUrl?: string;
    telegramWebhookSecret?: string;
    telegramWebhookPort?: number;
  },
): Promise<{ ok: boolean; logs: string[] }> {
  const w = await writeSandboxConfig(sessionId, {
    ...input,
    runtime: input.runtime || "xibecode",
    mergeExisting: false,
  });
  if (!w.ok) return { ok: false, logs: w.logs };
  const r = await restartDaemon(
    sessionId,
    input.sandboxId,
    input.runtime || "xibecode",
  );
  return { ok: w.ok && r.ok, logs: [...w.logs, ...r.logs] };
}

export function getGatewayUrl(): string {
  return gatewayBase();
}

/** Server-only request helper for control-plane workspace operations. */
export async function gatewaySessionFetch(
  sessionId: string,
  path: string,
  init: RequestInit = {},
  opts?: { sandboxId?: string; runtime?: AgentRuntime },
): Promise<Response> {
  if (opts?.sandboxId) {
    await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime).catch(
      () => undefined,
    );
  }
  const doFetch = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}${path}`, init);
  let res = await doFetch();
  if ((res.status === 404 || res.status === 502) && opts?.sandboxId) {
    await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime);
    res = await doFetch();
  }
  return res;
}

/** Public host for a port inside the sandbox (E2B getHost / preview URL). */
export async function getSandboxPreviewHost(
  sessionId: string,
  port: number,
): Promise<string | null> {
  try {
    const res = await gwFetch(
      `/sessions/${encodeURIComponent(sessionId)}/preview-host?port=${port}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { host?: string };
    return (data.host || "").trim() || null;
  } catch {
    return null;
  }
}

export type SandboxLiveState = {
  sandboxId: string;
  state: "running" | "paused" | "missing" | "unknown" | string;
  resumable: boolean;
  message?: string;
  lifecycle?: { onTimeout?: string; autoResume?: boolean };
};

/**
 * Pull diagnostic logs from the sandbox (daemon stdout + ~/.xibecode daemon logs).
 * Wakes the sandbox if paused so logs can be read after idle.
 */
export async function readSandboxLogs(
  sessionId: string,
  opts?: {
    sandboxId?: string;
    runtime?: AgentRuntime;
    lines?: number;
    source?: "all" | "daemon" | "agent" | "system";
  },
): Promise<{ ok: boolean; text: string; logs: string[]; source: string }> {
  const lines = Math.min(2000, Math.max(50, Math.round(opts?.lines ?? 200)));
  const source = opts?.source || "all";
  const sandboxId = opts?.sandboxId;
  const runtime = opts?.runtime || "xibecode";
  const runtimeHome =
    runtime === "supercharge"
      ? "/home/user/.superagent"
      : "/home/user/.xibecode";
  const runtimeLabel = runtime === "supercharge" ? "supercharge" : "xibecode";
  const runtimeBinary =
    runtime === "supercharge" ? "supercharge --version" : "xibecode -v";
  const runtimePidFile =
    runtime === "supercharge"
      ? "/tmp/supercharge-daemon.pid"
      : "/tmp/xibecode-daemon.pid";
  const runtimeLogFile =
    runtime === "supercharge"
      ? "/tmp/supercharge-daemon.log"
      : "/tmp/xibecode-daemon.log";

  // Tail multiple known log locations (hosting nohup + daemon home + agent).
  const shell = [
    "set +e",
    `N=${lines}`,
    'echo "=== meta ==="',
    'date -u +"utc=%Y-%m-%dT%H:%M:%SZ"',
    "hostname 2>/dev/null || true",
    `${runtimeBinary} 2>&1 || echo "${runtimeLabel}: not found"`,
    'echo "=== processes ==="',
    runtime === "supercharge"
      ? 'pgrep -af "supercharge-superagent-server|superagent-server|node" 2>/dev/null | head -25 || true'
      : 'pgrep -af "xibecode|node" 2>/dev/null | head -25 || true',
    `if [ -f ${runtimePidFile} ]; then echo "pidfile=$(cat ${runtimePidFile} 2>/dev/null)"; fi`,
    source === "system" || source === "all"
      ? [
          `echo "=== ${runtimeLogFile} (nohup) ==="`,
          `if [ -f ${runtimeLogFile} ]; then tail -n "$N" ${runtimeLogFile}; else echo "(missing)"; fi`,
        ].join("\n")
      : "",
    source === "daemon" || source === "all"
      ? [
          `echo "=== ${runtimeHome}/daemon/logs/daemon.log ==="`,
          `for p in "$HOME/${runtimeHome.split("/").pop()}/daemon/logs/daemon.log" ${runtimeHome}/daemon/logs/daemon.log \\`,
          `  "$HOME/${runtimeHome.split("/").pop()}/daemon/logs/daemon-verbose.log" ${runtimeHome}/daemon/logs/daemon-verbose.log; do`,
          '  if [ -f "$p" ]; then echo "--- $p ---"; tail -n "$N" "$p"; fi',
          "done",
          `ls -la "$HOME/${runtimeHome.split("/").pop()}/daemon/logs" ${runtimeHome}/daemon/logs 2>/dev/null | head -40 || true`,
        ].join("\n")
      : "",
    source === "agent" || source === "all"
      ? [
          'echo "=== agent / session logs ==="',
          `for p in "$HOME/${runtimeHome.split("/").pop()}/logs" ${runtimeHome}/logs; do`,
          '  if [ -d "$p" ]; then',
          '    ls -lt "$p" 2>/dev/null | head -15',
          '    find "$p" -type f -name "*.log" 2>/dev/null | head -8 | while read -r f; do',
          '      echo "--- $f ---"; tail -n "$N" "$f"',
          "    done",
          "  fi",
          "done",
          "# profile-scoped daemon logs",
          `find "$HOME/${runtimeHome.split("/").pop()}/daemon/logs" ${runtimeHome}/daemon/logs -type f -name "daemon-*.log" 2>/dev/null | head -6 | while read -r f; do`,
          '  echo "--- $f ---"; tail -n "$N" "$f"',
          "done",
        ].join("\n")
      : "",
    'echo "=== LOGS_DONE ==="',
  ]
    .filter(Boolean)
    .join("\n");

  const r = await execInSession(sessionId, shell, {
    timeout: 90,
    sandboxId,
    runtime,
  });
  const raw = `${r.stdout || ""}\n${r.stderr || ""}\n${r.message || ""}`.trim();
  const text = redactSecrets(raw).slice(0, 120_000);
  const ok = r.success !== false && !r.error && text.includes("LOGS_DONE");
  return {
    ok: ok || Boolean(text.length > 20),
    text,
    logs: [text || r.message || "no log output"],
    source,
  };
}

/** Query live sandbox state (paused still exists and is resumable). */
export async function getSandboxState(
  sandboxId: string,
): Promise<SandboxLiveState> {
  const res = await gwFetch(`/sandboxes/${encodeURIComponent(sandboxId)}`, {
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  let data: Partial<SandboxLiveState> & {
    success?: boolean;
    message?: string;
  } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  return {
    sandboxId,
    state: String(data.state || "unknown"),
    resumable: data.resumable !== false && data.state !== "missing",
    message: data.message,
    lifecycle: data.lifecycle,
  };
}

/** Resume a paused sandbox (and optionally restart xibecode daemon for Telegram). */
export async function wakeSession(
  sessionId: string,
  opts?: {
    sandboxId?: string;
    runtime?: AgentRuntime;
    restartDaemon?: boolean;
  },
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
      await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime);
      logs.push("gateway session ensured");
    } catch (e) {
      logs.push(`ensure session: ${(e as Error).message}`);
      // /wake still carries sandboxId for server-side reattach
    }
  }

  const doWake = () =>
    gwFetch(`/sessions/${encodeURIComponent(sessionId)}/wake`, {
      method: "POST",
      body: JSON.stringify({
        sandboxId: opts?.sandboxId,
        runtime: opts?.runtime,
        restartDaemon,
      }),
    });

  let res = await doWake();
  // Lost session / cold gateway → ensure + retry once
  if ((res.status === 404 || res.status === 502) && opts?.sandboxId) {
    try {
      await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime);
      res = await doWake();
      logs.push("wake retried after reattach");
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
    logs.push(
      "daemon restart reported DAEMON_FAIL — host webhook should stay armed",
    );
  }

  return {
    ok: true,
    state: data.state || "running",
    resumed: data.resumed,
    daemonOk,
    logs,
  };
}

export const APP_INBOX_PORT = 8790;

function appInboxSecret(): string {
  return (
    process.env.XIBECODE_APP_INBOX_SECRET?.trim() ||
    process.env.XIBECODE_GATEWAY_TOKEN?.trim() ||
    ""
  );
}

/** Merge inbox secret into daemon.env without wiping existing tokens. */
export async function bootstrapAppInbox(
  sessionId: string,
  sandboxId?: string,
  instanceId?: string,
  runtime: AgentRuntime = "xibecode",
): Promise<void> {
  const secret = appInboxSecret();
  if (runtime === "supercharge" && (!instanceId || !/^[A-Za-z0-9_-]{1,128}$/.test(instanceId))) {
    throw new Error("Supercharge instance identity is unavailable");
  }
  if (!secret) {
    if (runtime === "supercharge") throw new Error("Sandbox inbox authentication is unavailable");
    return;
  }
  const site = (
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://infra.xibeai.in"
  ).replace(/\/$/, "");
  const mediaBase = instanceId
    ? `${site}/api/public/media/${encodeURIComponent(instanceId)}`
    : "";
  const runtimeHome =
    runtime === "supercharge"
      ? "/home/user/.superagent"
      : "/home/user/.xibecode";
  const keys =
    runtime === "supercharge"
      ? {
          SUPERAGENT_AGENT_BINARY: "/usr/local/bin/supercharge",
          SUPERAGENT_API_TOKEN: secret,
          SUPERAGENT_APP_INBOX_SECRET: secret,
          SUPERAGENT_APP_INBOX_PORT: "8790",
          SUPERAGENT_BIND: "0.0.0.0:8790",
          SUPERAGENT_DAEMON_WORKDIR: "/home/user/workspace",
          SUPERAGENT_SESSION_STATE: "/home/user/.supercharge/state/sessions.json",
          SUPERAGENT_BOT_STATE: "/home/user/.supercharge/state/bots.json",
          SUPERAGENT_BOT_QUEUE_STATE: "/home/user/.supercharge/state/bot-queue.json",
          SUPERAGENT_BOT_MAINTENANCE_STATE: "/home/user/.supercharge/state/bot-maintenance",
          SUPERAGENT_SHARE_WORKSPACE_ROOT: "/home/user/workspace",
          SUPERAGENT_MEDIA_ROOT: "/home/user/workspace/.superagent-media",
          SUPERAGENT_BROWSER_CONTROL_ENABLED: "true",
          SUPERAGENT_WAKE_PORT: "8788",
          SUPERAGENT_RUNTIME: "supercharge",
          SUPERCHARGE_RUNTIME: "supercharge",
          AGENT_BROWSER_STREAM_PORT: "9223",
          AGENT_BROWSER_STREAM_QUALITY: "40",
          AGENT_BROWSER_STREAM_MAX_WIDTH: "960",
          AGENT_BROWSER_STREAM_MAX_HEIGHT: "540",
          ...(mediaBase ? { SUPERAGENT_PUBLIC_MEDIA_BASE: mediaBase } : {}),
          ...(instanceId ? { SUPERAGENT_INSTANCE_ID: instanceId } : {}),
        }
      : {
          XIBECODE_APP_INBOX_SECRET: secret,
          XIBECODE_GATEWAY_TOKEN: secret,
          XIBECODE_APP_INBOX_PORT: "8790",
          XIBECODE_DAEMON_WORKDIR: "/home/user/workspace",
          AGENT_BROWSER_STREAM_PORT: "9223",
          AGENT_BROWSER_STREAM_QUALITY: "40",
          AGENT_BROWSER_STREAM_MAX_WIDTH: "960",
          AGENT_BROWSER_STREAM_MAX_HEIGHT: "540",
          ...(mediaBase ? { XIBECODE_PUBLIC_MEDIA_BASE: mediaBase } : {}),
          ...(instanceId ? { XIBECODE_INSTANCE_ID: instanceId } : {}),
        };
  const py = `
import pathlib
keys = ${JSON.stringify(keys)}
path = pathlib.Path(${JSON.stringify(`${runtimeHome}/daemon.env`)})
path.parent.mkdir(parents=True, exist_ok=True)
if path.is_symlink() or (path.exists() and not path.is_file()):
  raise SystemExit("Sandbox daemon configuration path is invalid")
text = path.read_text() if path.exists() else ""
lines = [ln for ln in text.splitlines() if ln.strip() and ln.split("=", 1)[0] not in keys]
for k, v in keys.items():
  lines.append(f"{k}={v}")
if ${runtime === "supercharge" ? "True" : "False"}:
  import os
  identity = pathlib.Path("/home/user/.superagent/plugin-instance.id")
  if identity.is_symlink() or (identity.exists() and identity.read_text().strip() != keys["SUPERAGENT_INSTANCE_ID"]):
    raise SystemExit("Plugin controller instance identity mismatch")
  if not identity.exists():
    fd = os.open(identity, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
      handle.write(keys["SUPERAGENT_INSTANCE_ID"] + "\\n")
  identity.chmod(0o600)
path.write_text("\\n".join(lines) + "\\n")
path.chmod(0o600)
print("ok")
`.trim();
  const result = await execInSession(sessionId, `python3 - <<'PY'\n${py}\nPY`, {
    timeout: 30,
    sandboxId,
    runtime,
  });
  if (result.exitCode !== 0 || result.success === false || !String(result.stdout || "").includes("ok")) {
    throw new Error("Sandbox instance bootstrap failed; daemon configuration was not confirmed");
  }
}

export function sandboxPublicBase(sandboxId: string, port: number): string {
  const domain =
    process.env.XIBECODE_E2B_PREVIEW_DOMAIN?.trim() ||
    process.env.E2B_DOMAIN?.trim() ||
    "e2b.app";
  return `https://${port}-${sandboxId}.${domain}`;
}

export async function appInboxUrl(
  sessionId: string,
  sandboxId?: string,
  runtime: AgentRuntime = "xibecode",
): Promise<string> {
  if (sandboxId) {
    await ensureGatewaySession(sessionId, sandboxId, runtime).catch(
      () => undefined,
    );
  }
  const host = await getSandboxPreviewHost(sessionId, APP_INBOX_PORT);
  if (host) return host.replace(/\/$/, "");
  if (sandboxId) return sandboxPublicBase(sandboxId, APP_INBOX_PORT);
  throw new Error(
    "App inbox host unavailable. Wake or restart the sandbox and try again; the selected runtime must expose port 8790.",
  );
}

export async function appInboxFetch(
  sessionId: string,
  path: string,
  init: RequestInit = {},
  opts?: { sandboxId?: string; runtime?: AgentRuntime },
): Promise<Response> {
  const base = await appInboxUrl(sessionId, opts?.sandboxId, opts?.runtime);
  const headers = new Headers(init.headers);
  const secret = appInboxSecret();
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

export type SandboxShare = {
  token: string;
  name: string;
  path: string;
  url: string;
  expiresAt?: string;
};

/** Mint a public, capability-scoped download URL from the template share service. */
export async function createSandboxShare(
  sessionId: string,
  path: string,
  opts?: { sandboxId?: string; runtime?: AgentRuntime; name?: string },
): Promise<SandboxShare> {
  if (opts?.sandboxId) {
    await ensureGatewaySession(sessionId, opts.sandboxId, opts.runtime).catch(
      () => undefined,
    );
  }
  const host = await getSandboxPreviewHost(sessionId, 8788);
  if (!host)
    throw new Error(
      "Wake/file-share service is not reachable; wake the sandbox and try again.",
    );
  const secret = appInboxSecret();
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  const res = await fetch(`${host.replace(/\/$/, "")}/share`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path, name: opts?.name }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Partial<SandboxShare> & { ok?: boolean; error?: string } = {};
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok || data.ok === false || !data.url || !data.token) {
    throw new Error(data.error || `Share request failed (${res.status})`);
  }
  return {
    token: String(data.token),
    name: String(data.name || opts?.name || path.split("/").pop() || "file"),
    path: String(data.path || path),
    url: String(data.url),
    expiresAt: data.expiresAt ? String(data.expiresAt) : undefined,
  };
}

/** Start or stop an explicit Supercharge browser handoff in an E2B session. */
export async function setBrowserHandoff(
  sessionId: string,
  action: "start" | "stop",
  handoffId: string,
  minutes = 10,
): Promise<{ success: boolean; handoff?: boolean; expiresAt?: number; message?: string }> {
  const res = await gwFetch(
    `/sessions/${encodeURIComponent(sessionId)}/browser/handoff`,
    { method: "POST", body: JSON.stringify({ action, minutes, handoffId }) },
  );
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    ok?: boolean;
    handoff?: boolean;
    expiresAt?: number;
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.message || data.error || `Browser handoff failed (${res.status})`);
  }
  return {
    success: data.success ?? data.ok ?? true,
    handoff: data.handoff,
    expiresAt: data.expiresAt,
    message: data.message,
  };
}

/** Mint a short-lived, single-use ticket for the persistent gateway noVNC tunnel. */
export async function createBrowserVncTicket(
  sessionId: string,
  handoffId: string,
): Promise<{ ticket: string; expiresInSeconds: number }> {
  const res = await gwFetch(
    `/sessions/${encodeURIComponent(sessionId)}/browser/vnc-ticket`,
    { method: "POST", body: JSON.stringify({ handoffId }) },
  );
  const data = (await res.json().catch(() => ({}))) as {
    ticket?: string;
    expiresInSeconds?: number;
    message?: string;
    error?: string;
  };
  if (!res.ok || !data.ticket) {
    throw new Error(data.message || data.error || "Browser handoff ticket was not issued");
  }
  return { ticket: data.ticket, expiresInSeconds: data.expiresInSeconds || 60 };
}

/** Build the ticket-scoped gateway WebSocket URL used by the noVNC browser client. */
export function browserVncWebSocketUrl(sessionId: string, ticket: string): string {
  const base = gatewayBase().replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${base}/sessions/${encodeURIComponent(sessionId)}/browser/vnc?ticket=${encodeURIComponent(ticket)}`;
}
