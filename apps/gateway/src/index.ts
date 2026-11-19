import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { posix as pathPosix } from "node:path";
import { URL } from "node:url";
import { Sandbox } from "e2b";
import { WebSocketServer } from "ws";
import { relayBrowserVnc } from "./browser-vnc.js";
import { runtimeHasWork } from "./runtime-activity.js";
import { cycleRequired, cycleThreshold, sandboxRunStartedAt, runContinuousCycle } from "./continuous-run.js";
import { LifecycleStore, type LifecycleRecord } from "./lifecycle-store.js";
import { pluginRuntimeCommand } from "./plugin-runtime-update.js";
import { githubMcpTokenCommand } from "./github-token-read.js";
import { deleteAfterKill, killWithPreStop, prepareMigration } from "./pre-stop.js";

type SandboxLike = {
  sandboxId?: string;
  sandboxDomain?: string;
  getHost?: (port: number) => string | Promise<string>;
  commands?: {
    run: (
      command: string,
      opts?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  };
  files?: {
    read?: (path: string, opts?: Record<string, unknown>) => Promise<unknown>;
    write?: (
      path: string,
      data: unknown,
      opts?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
  kill?: (opts?: { requestTimeoutMs?: number }) => Promise<void>;
  close?: () => Promise<void>;
  pause?: (opts?: Record<string, unknown>) => Promise<boolean>;
  setTimeout?: (
    timeoutMs: number,
    opts?: Record<string, unknown>,
  ) => Promise<void>;
  connect?: (opts?: Record<string, unknown>) => Promise<SandboxLike>;
  getInfo?: () => Promise<{ state?: string }>;
};

type AgentRuntime = "xibecode" | "supercharge";
type RuntimeProfile = {
  runtime: AgentRuntime;
  label: string;
  template: string;
  daemonCommand: string;
  pidFile: string;
  logFile: string;
  processMatch: string;
};

type SessionRecord = {
  sessionId: string;
  sandbox: SandboxLike;
  sandboxId: string;
  createdAt: number;
  updatedAt: number;
  /** Wall-clock start of the current continuous *running* window (resets after 23h pause/resume). */
  continuousRunStartedAt: number;
  /** How many times we completed a 23h continuous-run reset. */
  cycleCount: number;
  lastCycleResetAt?: number;
  cycleResetting?: boolean;
  cwd?: string;
  strategy: "host_only" | "sandbox_full";
  runtime: AgentRuntime;
  workspaceRoot: string;
  syncStageFile: string;
};

type ExecRequest = {
  command: string;
  cwd?: string;
  input?: string;
  timeout?: number;
  maxOutputChars?: number;
};

type SyncRequest = {
  chunkBase64?: string;
  final?: boolean;
  reset?: boolean;
  workspaceRoot?: string;
};

type FileMutationRequest = {
  path: string;
  content?: string;
};

type MoveRequest = {
  source: string;
  destination: string;
};

const port = Number(process.env.PORT || 8787);
const authToken = process.env.XIBECODE_GATEWAY_TOKEN?.trim() || "";
/**
 * Hosting tier template: 4 vCPU / 8192 MB (see sandbox/e2b-template).
 * Without this, E2B uses the default base image (~2 vCPU) — not what we sell.
 */
const runtimeProfiles: Record<AgentRuntime, RuntimeProfile> = {
  xibecode: {
    runtime: "xibecode",
    label: "XibeCode",
    template:
      process.env.XIBECODE_E2B_TEMPLATE?.trim() || "xibecode-full-sandbox",
    daemonCommand:
      process.env.XIBECODE_SANDBOX_DAEMON_COMMAND?.trim() ||
      "xibecode daemon --workdir /home/user/workspace",
    pidFile:
      process.env.XIBECODE_SANDBOX_DAEMON_PIDFILE?.trim() ||
      "/tmp/xibecode-daemon.pid",
    logFile:
      process.env.XIBECODE_SANDBOX_DAEMON_LOGFILE?.trim() ||
      "/tmp/xibecode-daemon.log",
    processMatch:
      process.env.XIBECODE_SANDBOX_DAEMON_MATCH?.trim() ||
      "node.*xibecode|xibecode/dist",
  },
  supercharge: {
    runtime: "supercharge",
    label: "Supercharge",
    template:
      process.env.SUPERCHARGE_E2B_TEMPLATE?.trim() ||
      "supercharge-daemon-sandbox",
    daemonCommand:
      process.env.SUPERCHARGE_SANDBOX_DAEMON_COMMAND?.trim() ||
      "supercharge agent daemon --bind 0.0.0.0:8790",
    pidFile:
      process.env.SUPERCHARGE_SANDBOX_DAEMON_PIDFILE?.trim() ||
      "/tmp/supercharge-daemon.pid",
    logFile:
      process.env.SUPERCHARGE_SANDBOX_DAEMON_LOGFILE?.trim() ||
      "/tmp/supercharge-daemon.log",
    processMatch:
      process.env.SUPERCHARGE_SANDBOX_DAEMON_MATCH?.trim() ||
      "supercharge agent daemon|supercharge-superagent-server|superagent-server",
  },
};
function normalizeRuntime(value: unknown): AgentRuntime {
  return String(value || "")
    .trim()
    .toLowerCase() === "supercharge"
    ? "supercharge"
    : "xibecode";
}
function runtimeProfile(value: unknown): RuntimeProfile {
  return runtimeProfiles[normalizeRuntime(value)];
}
/**
 * Inactivity window (ms) before lifecycle action.
 * Default 30m (E2B platform default is 5m). After auto-resume, E2B restarts the
 * countdown with max(this value, 5m) — see e2b.dev/docs/sandbox/auto-resume.
 * OpenClaw-style long-running Telegram in-sandbox benefits from a longer idle
 * window so the bot is not freeze/thaw thrashing every few minutes.
 */
const sandboxTimeoutMs = Math.max(
  60_000,
  // Idle before lifecycle pause (default 15m). Override with XIBECODE_E2B_SANDBOX_TIMEOUT_MS.
  // After auto-resume E2B enforces a ≥5m window — see e2b.dev/docs/sandbox/auto-resume
  Number(process.env.XIBECODE_E2B_SANDBOX_TIMEOUT_MS || 15 * 60 * 1000),
);
/**
 * E2B Pro continuous *running* cap is 24h. Pause+resume resets that window.
 * Default 23h so we cycle before the hard limit kills the run.
 * Set XIBECODE_E2B_MAX_CONTINUOUS_MS=0 to disable the 23h cycle (idle pause still works).
 */
const maxContinuousMs = (() => {
  const raw = process.env.XIBECODE_E2B_MAX_CONTINUOUS_MS;
  if (raw === "0" || raw === "off" || raw === "false") return 0;
  const n = Number(raw || 23 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0
    ? cycleThreshold(n)
    : 23 * 60 * 60 * 1000;
})();
/**
 * https://e2b.dev/docs/sandbox/auto-resume
 * Default onTimeout is "kill". We request "pause" (full memory + fs snapshot).
 * An explicit kill override or a provider-enforced kill bypasses guest pre-stop.
 * String form "pause" keeps keepMemory=true (required for autoResume).
 * Do NOT use { action: 'pause', keepMemory: false } — that cannot auto-resume.
 */
const lifecycleOnTimeout =
  process.env.XIBECODE_E2B_ON_TIMEOUT?.trim().toLowerCase() === "kill"
    ? ("kill" as const)
    : ("pause" as const);
/**
 * https://e2b.dev/docs/sandbox/auto-resume
 * autoResume: true → paused sandbox wakes on activity:
 *   - sandbox.commands.run / files.read / files.write
 *   - HTTP to a service inside the sandbox (preview URL)
 * You do not need Sandbox.connect() first when autoResume is on *and* you still
 * hold a live client from create. After gateway restart use connect().
 * Only valid with onTimeout: 'pause' + full memory snapshot.
 */
const lifecycleAutoResume =
  lifecycleOnTimeout === "pause" &&
  process.env.XIBECODE_E2B_AUTO_RESUME?.trim().toLowerCase() !== "false";

/** Exact lifecycle object passed to Sandbox.create (docs shape). */
const sandboxLifecycle =
  lifecycleOnTimeout === "pause"
    ? { onTimeout: "pause" as const, autoResume: lifecycleAutoResume }
    : { onTimeout: "kill" as const, autoResume: false as const };
// Docs use *.e2b.app (https://e2b.dev/docs/network/public-url)
const previewDomain =
  process.env.XIBECODE_E2B_PREVIEW_DOMAIN?.trim() || "e2b.app";
const maxExportBytes =
  Math.max(1, Number(process.env.XIBECODE_EXPORT_MAX_MB || 64)) * 1024 * 1024;
const sessions = new Map<string, SessionRecord>();
const browserVncTickets = new Map<
  string,
  { sessionId: string; handoffId: string; botId: string; expiresAt: number }
>();
const defaultWorkspaceRoot =
  process.env.XIBECODE_SANDBOX_WORKSPACE_ROOT?.trim() || "/home/user/workspace";
const cycleWaiters = new Map<string, Promise<void>>();
const lifecycleStore = new LifecycleStore(process.env.VECTRA_LIFECYCLE_STATE_DIR || "/var/lib/vectra-gateway/lifecycle");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function rememberRun(session: SessionRecord, info: { startedAt?: Date | string; state?: string }, resumedAt?: number): Promise<void> {
  if (session.runtime !== "supercharge") return;
  const result = await lifecycleStore.withLock(session.sandboxId, async () => {
    const existing = await lifecycleStore.read(session.sandboxId);
    if (existing && existing.phase !== "running") return existing;
    const record: LifecycleRecord = existing ?? {
      sandboxId:session.sandboxId, sessionId:session.sessionId, runtime:session.runtime,
      workspaceRoot:session.workspaceRoot, runStartedAt:sandboxRunStartedAt(info) ?? 0,
      cycleCount:0, phase:"running", updatedAt:Date.now(),
    };
    if (!existing || resumedAt !== undefined) {
      record.runStartedAt = resumedAt ?? record.runStartedAt;
      record.updatedAt = Date.now();
      await lifecycleStore.write(record);
    }
    return record;
  });
  const recorded = result.value ?? await lifecycleStore.read(session.sandboxId);
  if (recorded) {
    session.continuousRunStartedAt = recorded.runStartedAt;
    session.cycleCount = recorded.cycleCount;
  }
}

async function refreshMaintenance(session: SessionRecord): Promise<void> {
  const record = await lifecycleStore.read(session.sandboxId);
  if (record && record.phase !== "running") {
    await resetContinuousRunCycle(session, "recover-maintenance");
    const current = await lifecycleStore.read(session.sandboxId);
    if (current?.phase !== "running") throw new Error("Sandbox maintenance is in progress; retry shortly");
  }
}

/**
 * Paths allowed for file tools in sandbox_full.
 * Workspace root is always allowed; also allow the XibeCode home + /tmp so
 * hosting can write daemon.env / profile without shell hacks.
 */
function isAllowedSandboxAbsPath(
  session: SessionRecord,
  normalized: string,
): boolean {
  const root = session.workspaceRoot;
  if (normalized === root || normalized.startsWith(`${root}/`)) return true;
  if (normalized === "/tmp" || normalized.startsWith("/tmp/")) return true;
  // Tenant config / daemon state
  if (
    normalized === "/home/user/.xibecode" ||
    normalized.startsWith("/home/user/.xibecode/")
  ) {
    return true;
  }
  if (normalized === "/home/user" || normalized.startsWith("/home/user/")) {
    // Allow other files under login home (not /home/other)
    return true;
  }
  return false;
}

function resolveSandboxPath(session: SessionRecord, inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) throw new Error("Path cannot be empty");
  const normalized = pathPosix.normalize(trimmed);
  if (normalized.includes("..")) {
    throw new Error(`Path traversal is not allowed: ${inputPath}`);
  }

  if (pathPosix.isAbsolute(normalized)) {
    if (
      session.strategy === "sandbox_full" &&
      !isAllowedSandboxAbsPath(session, normalized)
    ) {
      throw new Error(
        `Absolute path outside sandbox workspace is not allowed: ${inputPath}`,
      );
    }
    return normalized;
  }

  return pathPosix.join(session.workspaceRoot, normalized);
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (!header) return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!authToken) return true;
  return getBearerToken(req) === authToken;
}

function normalizePreviewHost(hostOrUrl: string): string {
  const trimmed = String(hostOrUrl || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

async function resolvePreviewHost(
  session: SessionRecord,
  targetPort: number,
): Promise<string> {
  const getter = session.sandbox.getHost;
  if (typeof getter === "function") {
    const resolved = await getter.call(session.sandbox, targetPort);
    const normalized = normalizePreviewHost(resolved);
    if (normalized) return normalized;
  }
  // Fallback host template for environments where SDK host helpers are unavailable.
  return `https://${targetPort}-${session.sandboxId}.${previewDomain}`;
}

function daemonAuthorizationHeaders(): Record<string, string> {
  const token =
    process.env.XIBECODE_APP_INBOX_SECRET?.trim() ||
    process.env.XIBECODE_GATEWAY_TOKEN?.trim() ||
    "";
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function superchargeDaemonFetch(
  session: SessionRecord,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (session.runtime !== "supercharge") {
    throw new Error("Browser handoff is available only for Supercharge sessions");
  }
  const base = await resolvePreviewHost(session, 8790);
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(daemonAuthorizationHeaders())) {
    headers.set(name, value);
  }
  return fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, headers });
}

function findSession(id: string): SessionRecord | undefined {
  const direct = sessions.get(id);
  if (direct) return direct;
  return Array.from(sessions.values()).find(
    (session) => session.sandboxId === id,
  );
}

function issueBrowserVncTicket(sessionId: string, handoffId: string, botId: string): string {
  for (const [key, record] of browserVncTickets) if (record.expiresAt <= Date.now()) browserVncTickets.delete(key);
  if (browserVncTickets.size >= 4096) throw new Error("Too many outstanding desktop tickets");
  const ticket = randomBytes(32).toString("base64url");
  browserVncTickets.set(ticket, { sessionId, handoffId, botId, expiresAt: Date.now() + 60_000 });
  return ticket;
}

function consumeBrowserVncTicket(ticket: string, sessionId: string): { handoffId: string; botId: string } | undefined {
  const record = browserVncTickets.get(ticket);
  browserVncTickets.delete(ticket);
  return record && record.sessionId === sessionId && record.expiresAt > Date.now()
    ? { handoffId: record.handoffId, botId: record.botId } : undefined;
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

/**
 * Before the E2B 24h continuous-run hard limit: pause (full memory+fs), then connect
 * to resume. That resets the continuous window so long agent sessions can keep going.
 */
async function resetContinuousRunCycle(session: SessionRecord, reason: string): Promise<void> {
  const sandboxId = session.sandboxId;
  const existing = cycleWaiters.get(sandboxId);
  if (existing) { await existing; return; }
  const job = (async () => {
    session.cycleResetting = true;
    try {
      const result = await runContinuousCycle(lifecycleStore, {
        sandboxId, sessionId:session.sessionId, runtime:session.runtime, workspaceRoot:session.workspaceRoot,
      }, {
        info: () => Sandbox.getInfo(sandboxId, { requestTimeoutMs: 30_000 }),
        pause: () => Sandbox.pause(sandboxId, { requestTimeoutMs: 120_000 }),
        connect: async () => { session.sandbox = await Sandbox.connect(sandboxId, {
          timeoutMs: sandboxTimeoutMs, requestTimeoutMs:120_000,
        }) as unknown as SandboxLike; },
        refreshTimeout: () => Sandbox.setTimeout(sandboxId, sandboxTimeoutMs, { requestTimeoutMs:30_000 }),
        maintenance: async (action) => {
          const response = await superchargeDaemonFetch(session, "/v1/app/maintenance", {
            method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action}),
            signal:AbortSignal.timeout(action === "interrupt" ? 120_000 : 15_000),
          });
          if (!response.ok) throw new Error(`Daemon maintenance ${action} failed (HTTP ${response.status})`);
          const data = await response.json() as {ok?:boolean; busy?:boolean};
          if (data.ok !== true) throw new Error(`Daemon did not acknowledge ${action}`);
          return data;
        },
      }, {thresholdMs:maxContinuousMs || 23 * 60 * 60_000});
      if (result) {
        session.continuousRunStartedAt = result.runStartedAt;
        session.cycleCount = result.cycleCount;
        session.lastCycleResetAt = Date.now();
        console.log(`[vectra-gateway] cycle ${result.cycleCount} confirmed sandbox=${sandboxId} (${reason})`);
      }
    } finally {
      session.cycleResetting = false;
      cycleWaiters.delete(sandboxId);
    }
  })();
  cycleWaiters.set(sandboxId, job);
  await job;
}

/**
 * Ensure sandbox is running before any op.
 *
 * https://e2b.dev/docs/sandbox/auto-resume
 * - Create with lifecycle { onTimeout: 'pause', autoResume: true }
 * - Activity (commands.run, files.*, HTTP into sandbox) wakes paused VMs
 * - No connect() needed first when autoResume is true AND client is still live
 * - After gateway restart (no client) → Sandbox.connect()
 * - setTimeout() only while running (paused → "not found")
 * - After resume, call setTimeout() so the idle window is our configured value
 *   (E2B restarts countdown; min applied server-side is 5m)
 *
 * Telegram long-poll *inside* a paused VM cannot generate that activity.
 * Host must issue an SDK op (wake/exec) — OpenClaw-style channel runtime then
 * needs a restart because frozen TCP to api.telegram.org is stale after thaw.
 */
async function reconnectSandbox(
  session: SessionRecord,
  reason: string,
): Promise<void> {
  // connect() resumes if paused; timeoutMs is the new idle window after resume.
  // requestTimeoutMs: memory restore can exceed the default 60s handshake.
  const before = await Sandbox.getInfo(session.sandboxId);
  const resumedAt = before.state === "paused" ? Date.now() : undefined;
  const connected = await Sandbox.connect(session.sandboxId, {
    timeoutMs: Math.max(sandboxTimeoutMs, 120_000),
    requestTimeoutMs: 120_000,
  });
  session.sandbox = connected as unknown as SandboxLike;
  session.updatedAt = Date.now();
  // Docs: change timeout after resume via setTimeout()
  await refreshSandboxTimeout(session);
  const info = await Sandbox.getInfo(session.sandboxId);
  await rememberRun(session, info, resumedAt);
  await refreshMaintenance(session);
  if (info.state !== "running") throw new Error(`Sandbox resume not confirmed (${info.state})`);
  console.log(
    `[xibecode-e2b-gateway] reconnected sandbox=${session.sandboxId} via Sandbox.connect (${reason})`,
  );
}

/** setTimeout only works while running; paused → "Sandbox not found". */
async function refreshSandboxTimeout(session: SessionRecord): Promise<void> {
  try {
    if (typeof session.sandbox.setTimeout === "function") {
      await session.sandbox.setTimeout(sandboxTimeoutMs);
    } else {
      await Sandbox.setTimeout(session.sandboxId, sandboxTimeoutMs);
    }
  } catch (err) {
    console.warn(
      `[xibecode-e2b-gateway] setTimeout failed sandbox=${session.sandboxId}: ${(err as Error).message}`,
    );
  }
}

function isResumeRelatedError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("paused") ||
    m.includes("not running") ||
    m.includes("sandbox is not") ||
    m.includes("unavailable") ||
    m.includes("connection") ||
    m.includes("econnreset") ||
    m.includes("socket") ||
    m.includes("timeout") ||
    m.includes("404") ||
    m.includes("not found") ||
    m.includes("dead") ||
    m.includes("killed")
  );
}

/**
 * SDK activity that counts for auto-resume (docs list commands.run / files.*).
 * Prefer a trivial command — same idea as the docs' files.read after pause.
 */
async function probeWithSdkActivity(
  session: SessionRecord,
  timeoutMs: number,
): Promise<void> {
  if (!session.sandbox?.commands?.run) {
    throw new Error("no live sandbox client (commands.run missing)");
  }
  await session.sandbox.commands.run("true", { timeoutMs });
}

async function ensureSandboxRunning(session: SessionRecord): Promise<{
  state: string;
  resumed: boolean;
}> {
  let state = "unknown";
  let resumed = false;
  let sandboxAutoResume = lifecycleAutoResume;
  await cycleWaiters.get(session.sandboxId);
  let infoForRunStart: { startedAt?: Date | string; state?: string } = {};

  try {
    const info = await Sandbox.getInfo(session.sandboxId);
    infoForRunStart = info;
    state = String((info as { state?: string }).state || "unknown");
    const life = (
      info as { lifecycle?: { onTimeout?: string; autoResume?: boolean } }
    ).lifecycle;
    if (typeof life?.autoResume === "boolean") {
      sandboxAutoResume = life.autoResume;
    }
    if (
      life?.onTimeout &&
      life.onTimeout !== "pause" &&
      lifecycleOnTimeout === "pause"
    ) {
      console.warn(
        `[xibecode-e2b-gateway] sandbox=${session.sandboxId} lifecycle.onTimeout=${life.onTimeout} (wanted pause)`,
      );
    }
    if (lifecycleAutoResume && life && life.autoResume === false) {
      console.warn(
        `[xibecode-e2b-gateway] sandbox=${session.sandboxId} autoResume=false on E2B side — wake will use connect()`,
      );
    }
  } catch (err) {
    console.warn(
      `[xibecode-e2b-gateway] getInfo failed sandbox=${session.sandboxId}: ${(err as Error).message}`,
    );
    state = "unknown";
  }

  if (state === "running") {
    await rememberRun(session, infoForRunStart);
    await refreshMaintenance(session);
    // Probe first (also covers mid-pause race). setTimeout only after probe succeeds.
    try {
      await probeWithSdkActivity(session, 30_000);
      await refreshSandboxTimeout(session);
      session.updatedAt = Date.now();
      return { state: "running", resumed: false };
    } catch (err) {
      console.warn(
        `[xibecode-e2b-gateway] running-handle stale sandbox=${session.sandboxId}: ${(err as Error).message} — reconnecting`,
      );
      await reconnectSandbox(session, "stale running handle");
      resumed = true;
      session.updatedAt = Date.now();
      return { state: "running", resumed };
    }
  }

  // Paused / unknown
  // 1) Official auto-resume: next SDK op wakes when autoResume=true + live client
  //    (docs: "You do not need to call Sandbox.connect() first")
  if (
    state === "paused" &&
    sandboxAutoResume &&
    session.sandbox?.commands?.run
  ) {
    try {
      const resumedAt = Date.now();
      await probeWithSdkActivity(session, 90_000);
      await refreshSandboxTimeout(session);
      const resumedInfo = await Sandbox.getInfo(session.sandboxId);
      if (resumedInfo.state !== "running") throw new Error(`Auto-resume not confirmed (${resumedInfo.state})`);
      await rememberRun(session, resumedInfo, resumedAt);
      await refreshMaintenance(session);
      session.updatedAt = Date.now();
      console.log(
        `[xibecode-e2b-gateway] auto-resumed sandbox=${session.sandboxId} via commands.run (lifecycle.autoResume)`,
      );
      return { state: "running", resumed: true };
    } catch (err) {
      console.warn(
        `[xibecode-e2b-gateway] auto-resume via commands.run failed sandbox=${session.sandboxId}: ${(err as Error).message} — connect()`,
      );
    }
  }

  // 2) Explicit resume (docs: if autoResume is falsy, use Sandbox.connect;
  //    also required after gateway restart when the create-time client is gone)
  try {
    await reconnectSandbox(session, `state=${state}`);
    resumed = true;
    state = "running";
  } catch (err) {
    throw new Error(
      `Sandbox ${session.sandboxId} unavailable (killed or missing?). ${(err as Error).message}`,
    );
  }

  session.updatedAt = Date.now();
  return { state, resumed };
}

/** Extend idle TTL + enforce 23h continuous-run reset if needed. */
async function touchSession(session: SessionRecord): Promise<void> {
  await ensureSandboxRunning(session);

  if (session.runtime === "supercharge" && maxContinuousMs > 0) {
    const info = await Sandbox.getInfo(session.sandboxId);
    if (cycleRequired(info, maxContinuousMs, Date.now(), session.continuousRunStartedAt)) {
      await resetContinuousRunCycle(session, `>=${maxContinuousMs}ms`);
    }
  }
}

const SANDBOX_SIZES = new Set(["2:4096", "4:8192", "8:8192", "16:16384"]);

function sandboxSize(cpuCount?: number, memoryMB?: number): { cpuCount: number; memoryMB: number } | undefined {
  if (!cpuCount && !memoryMB) return undefined;
  const key = `${cpuCount}:${memoryMB}`;
  if (!SANDBOX_SIZES.has(key)) {
    throw new Error(`Unsupported sandbox size ${cpuCount} vCPU / ${memoryMB} MiB`);
  }
  return { cpuCount: cpuCount as number, memoryMB: memoryMB as number };
}

async function createSession(input: {
  sessionId?: string;
  cwd?: string;
  strategy?: string;
  workspaceRoot?: string;
  runtime?: AgentRuntime | string;
  cpuCount?: number;
  memoryMB?: number;
  /** Re-attach an existing E2B sandbox after gateway restart (hosting recovery). */
  sandboxId?: string;
}): Promise<SessionRecord> {
  const sessionId = input.sessionId?.trim() || randomUUID();
  const existing = sessions.get(sessionId);
  if (existing) {
    await touchSession(existing);
    return existing;
  }

  // Reconnect by sandbox id if another session row already holds it
  const wantSandbox = input.sandboxId?.trim();
  if (wantSandbox) {
    const bySb = Array.from(sessions.values()).find(
      (s) => s.sandboxId === wantSandbox,
    );
    if (bySb) {
      await touchSession(bySb);
      return bySb;
    }
  }

  const runtime = normalizeRuntime(input.runtime);
  const profile = runtimeProfile(runtime);
  let sandbox: SandboxLike;
  let sandboxId: string;
  let actualStartedAt: number | null = null;

  if (wantSandbox) {
    const prior = await Sandbox.getInfo(wantSandbox);
    actualStartedAt = prior.state === "paused" ? Date.now() : null;
    // Re-attach existing VM (filesystem + optional paused memory).
    // connect() resumes if paused; timeoutMs becomes the post-resume idle window.
    sandbox = (await Sandbox.connect(wantSandbox, {
      timeoutMs: sandboxTimeoutMs,
      requestTimeoutMs: 120_000,
    })) as unknown as SandboxLike;
    sandboxId = sandbox.sandboxId || wantSandbox;
    console.log(
      `[agent-gateway] reattached runtime=${runtime} sandbox=${sandboxId} as session=${sessionId}`,
    );
    // connect already resumes; still pin idle timeout to our configured window
  } else {
    // Exact docs shape: https://e2b.dev/docs/sandbox/auto-resume
    //   lifecycle: { onTimeout: 'pause', autoResume: true }
    // Default onTimeout is 'kill' — without lifecycle, idle sandboxes die permanently.
    const size = sandboxSize(input.cpuCount, input.memoryMB);
    sandbox = (await Sandbox.create({
      template: profile.template,
      timeoutMs: sandboxTimeoutMs,
      lifecycle: sandboxLifecycle,
      ...(size ? { cpuCount: size.cpuCount, memoryMB: size.memoryMB } : {}),
    })) as unknown as SandboxLike;
    sandboxId = sandbox.sandboxId || randomUUID();
    try {
      const info = (await Sandbox.getInfo(sandboxId)) as {
        cpuCount?: number;
        memoryMB?: number;
        state?: string;
        lifecycle?: { onTimeout?: string; autoResume?: boolean };
      };
      console.log(
        `[agent-gateway] created runtime=${runtime} sandbox=${sandboxId} template=${profile.template}` +
          ` state=${info.state ?? "?"} cpu=${info.cpuCount ?? "?"} memMB=${info.memoryMB ?? "?"}` +
          ` lifecycle.onTimeout=${info.lifecycle?.onTimeout ?? sandboxLifecycle.onTimeout}` +
          ` autoResume=${info.lifecycle?.autoResume ?? sandboxLifecycle.autoResume}`,
      );
      if (
        lifecycleOnTimeout === "pause" &&
        info.lifecycle?.onTimeout === "kill"
      ) {
        console.error(
          `[xibecode-e2b-gateway] WARNING: requested onTimeout=pause but sandbox reports kill — check E2B plan supports auto-pause`,
        );
      }
      if (
        lifecycleAutoResume &&
        info.lifecycle &&
        info.lifecycle.autoResume !== true
      ) {
        console.error(
          `[xibecode-e2b-gateway] WARNING: requested autoResume=true but sandbox reports ${info.lifecycle.autoResume}`,
        );
      }
    } catch {
      console.log(
        `[agent-gateway] created runtime=${runtime} sandbox=${sandboxId} template=${profile.template} lifecycle=${JSON.stringify(sandboxLifecycle)}`,
      );
    }
  }

  const strategy =
    input.strategy?.trim() === "sandbox_full" ? "sandbox_full" : "host_only";
  const requestedWorkspaceRoot =
    input.workspaceRoot?.trim() || input.cwd?.trim() || defaultWorkspaceRoot;
  const now = Date.now();
  const session: SessionRecord = {
    sessionId,
    sandbox,
    sandboxId,
    createdAt: now,
    updatedAt: now,
    continuousRunStartedAt: now,
    cycleCount: 0,
    cwd: strategy === "host_only" ? input.cwd?.trim() || undefined : undefined,
    strategy,
    runtime,
    workspaceRoot: requestedWorkspaceRoot,
    syncStageFile: `/tmp/xibecode-sync-${sessionId}.b64`,
  };
  if (runtime === "supercharge") {
    const info = await Sandbox.getInfo(sandboxId);
    await rememberRun(session, info, actualStartedAt ?? undefined);
    const expected = sandboxSize(input.cpuCount, input.memoryMB);
    if (expected && (info.cpuCount !== expected.cpuCount || info.memoryMB !== expected.memoryMB)) {
      console.warn(`[vectra-gateway] resource mismatch sandbox=${sandboxId}: ${info.cpuCount} vCPU / ${info.memoryMB} MiB (expected ${expected.cpuCount}/${expected.memoryMB})`);
    }
  }
  sessions.set(sessionId, session);

  // After connect/create the sandbox is running — pin idle TTL (docs: setTimeout after resume).
  await refreshSandboxTimeout(session);

  if (strategy === "sandbox_full") {
    try {
      // SDK activity (also proves auto-resume path works for new clients)
      const mk = await sandbox.commands?.run(
        `mkdir -p ${shQuote(requestedWorkspaceRoot)}`,
        {
          cwd: "/tmp",
          timeoutMs: 60_000,
        },
      );
      if (mk && (mk as any).exitCode && (mk as any).exitCode !== 0) {
        console.warn(
          `[xibecode-e2b-gateway] mkdir workspace failed (${(mk as any).exitCode}): ${String((mk as any).stderr ?? "")}`,
        );
      }
    } catch (e) {
      console.warn(
        `[xibecode-e2b-gateway] mkdir workspace error: ${(e as Error).message}`,
      );
    }
  }

  if (runtime === "supercharge") await refreshMaintenance(session);
  return session;
}

async function runInSession(
  session: SessionRecord,
  input: ExecRequest,
): Promise<Record<string, unknown>> {
  await touchSession(session);
  const timeoutMs = Math.max(1, Number(input.timeout || 120)) * 1000;
  let cwd = input.cwd || session.cwd || session.workspaceRoot || "/home/user";
  if (
    session.strategy === "sandbox_full" &&
    cwd &&
    !pathPosix.isAbsolute(cwd)
  ) {
    cwd = pathPosix.join(session.workspaceRoot, pathPosix.normalize(cwd));
  }
  if (
    session.strategy === "sandbox_full" &&
    pathPosix.isAbsolute(cwd) &&
    !isAllowedSandboxAbsPath(session, pathPosix.normalize(cwd))
  ) {
    return {
      success: false,
      error: true,
      message: `[invalid_argument] cwd '${cwd}' is outside sandbox workspace`,
      stdout: "",
      stderr: `[invalid_argument] cwd '${cwd}' is outside sandbox workspace`,
      exitCode: 2,
      timedOut: false,
      platform: "cloud",
      sandboxId: session.sandboxId,
      strategy: session.strategy,
      workspaceRoot: session.workspaceRoot,
    };
  }

  const runOnce = async () => {
    const result = await session.sandbox.commands?.run(input.command, {
      cwd,
      timeoutMs,
      stdin: input.input,
    });
    const stdout = String((result as any)?.stdout ?? "");
    const stderr = String((result as any)?.stderr ?? "");
    const exitCodeRaw = (result as any)?.exitCode;
    const exitCode = typeof exitCodeRaw === "number" ? exitCodeRaw : 0;
    session.updatedAt = Date.now();
    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
      timedOut: false,
      platform: "cloud",
      sandboxId: session.sandboxId,
      strategy: session.strategy,
      workspaceRoot: session.workspaceRoot,
      resumed: false as boolean | undefined,
    };
  };

  try {
    return await runOnce();
  } catch (err: any) {
    const msg = String(err?.message || err || "command failed");
    // Non-zero exit from the shell is not a resume problem — surface as-is
    const exitMatch = msg.match(/exit status (\d+)/i);
    if (exitMatch) {
      session.updatedAt = Date.now();
      return {
        success: false,
        error: true,
        message: msg,
        stdout: String(err?.stdout ?? ""),
        stderr: String(err?.stderr ?? msg),
        exitCode: Number(exitMatch[1]),
        timedOut: false,
        platform: "cloud",
        sandboxId: session.sandboxId,
        strategy: session.strategy,
        workspaceRoot: session.workspaceRoot,
      };
    }

    // Stale handle / still paused → reconnect once and retry the real command
    if (isResumeRelatedError(msg)) {
      console.warn(
        `[xibecode-e2b-gateway] exec failed (likely paused/stale) sandbox=${session.sandboxId}: ${msg} — reconnect+retry`,
      );
      try {
        await reconnectSandbox(session, "exec retry after failure");
        const retried = await runOnce();
        retried.resumed = true;
        return retried;
      } catch (retryErr: any) {
        const rmsg = String(retryErr?.message || retryErr || "retry failed");
        const rExit = rmsg.match(/exit status (\d+)/i);
        session.updatedAt = Date.now();
        return {
          success: false,
          error: true,
          message: rmsg,
          stdout: String(retryErr?.stdout ?? ""),
          stderr: String(retryErr?.stderr ?? rmsg),
          exitCode: rExit ? Number(rExit[1]) : 1,
          timedOut: /timeout/i.test(rmsg),
          platform: "cloud",
          sandboxId: session.sandboxId,
          strategy: session.strategy,
          workspaceRoot: session.workspaceRoot,
        };
      }
    }

    session.updatedAt = Date.now();
    return {
      success: false,
      error: true,
      message: msg,
      stdout: String(err?.stdout ?? ""),
      stderr: String(err?.stderr ?? msg),
      exitCode: 1,
      timedOut: /timeout/i.test(msg),
      platform: "cloud",
      sandboxId: session.sandboxId,
      strategy: session.strategy,
      workspaceRoot: session.workspaceRoot,
    };
  }
}

async function syncWorkspaceChunk(
  session: SessionRecord,
  request: SyncRequest,
): Promise<Record<string, unknown>> {
  const reset = Boolean(request.reset);
  const final = Boolean(request.final);
  const chunkBase64 = request.chunkBase64 || "";

  if (request.workspaceRoot?.trim()) {
    session.workspaceRoot = request.workspaceRoot.trim();
  }

  if (reset) {
    await runInSession(session, {
      command: `rm -f ${shQuote(session.syncStageFile)}`,
      cwd: "/tmp",
      timeout: 30,
    });
  }

  if (chunkBase64.length > 0) {
    const appendCommand = `mkdir -p /tmp && printf '%s' ${shQuote(chunkBase64)} >> ${shQuote(session.syncStageFile)}`;
    const appendResult = await runInSession(session, {
      command: appendCommand,
      cwd: "/tmp",
      timeout: 60,
    });
    if (!appendResult.success) return appendResult;
  }

  if (final) {
    const extractCommand =
      `mkdir -p ${shQuote(session.workspaceRoot)} && ` +
      `base64 -d ${shQuote(session.syncStageFile)} | tar -xzf - -C ${shQuote(session.workspaceRoot)} && ` +
      `rm -f ${shQuote(session.syncStageFile)}`;
    const extractResult = await runInSession(session, {
      command: extractCommand,
      cwd: "/tmp",
      timeout: 300,
    });
    if (!extractResult.success) return extractResult;
  }

  session.updatedAt = Date.now();
  return {
    success: true,
    sessionId: session.sessionId,
    final,
    workspaceRoot: session.workspaceRoot,
    strategy: session.strategy,
  };
}

async function exportWorkspaceArchiveInSession(
  session: SessionRecord,
): Promise<
  | { ok: true; bytes: number; archive: Buffer }
  | { ok: false; statusCode: number; message: string; bytes?: number }
> {
  const archivePath = `/tmp/xibecode-export-${session.sessionId}.tgz`;
  const command =
    `set -e; ` +
    `rm -f ${shQuote(archivePath)}; ` +
    `tar -czf ${shQuote(archivePath)} -C ${shQuote(session.workspaceRoot)} .; ` +
    `size=$(wc -c < ${shQuote(archivePath)} | tr -d ' '); ` +
    `if [ "$size" -gt "${maxExportBytes}" ]; then ` +
    `echo "__XIBECODE_EXPORT_TOO_LARGE__:$size"; ` +
    `rm -f ${shQuote(archivePath)}; ` +
    `exit 9; ` +
    `fi; ` +
    `printf '%s' "$size"; echo "__XIBECODE_SPLIT__"; ` +
    `base64 -w0 ${shQuote(archivePath)}; ` +
    `rm -f ${shQuote(archivePath)}`;
  const result = await runInSession(session, {
    command,
    cwd: "/tmp",
    timeout: 600,
  });
  const stdout = String(result.stdout || "");
  if (!result.success) {
    const marker = stdout.match(/__XIBECODE_EXPORT_TOO_LARGE__:(\d+)/);
    if (marker) {
      return {
        ok: false,
        statusCode: 413,
        message: `Sandbox export exceeds XIBECODE_EXPORT_MAX_MB (${Math.ceil(Number(marker[1]) / (1024 * 1024))}MB)`,
        bytes: Number(marker[1]),
      };
    }
    return {
      ok: false,
      statusCode: 400,
      message: `Failed to export workspace: ${String(result.stderr || result.message || "unknown error")}`,
    };
  }
  const [bytesPart, encodedPart] = stdout.split("__XIBECODE_SPLIT__");
  if (!encodedPart) {
    return {
      ok: false,
      statusCode: 500,
      message: "Sandbox export missing archive payload",
    };
  }
  const bytes = Number((bytesPart || "").trim()) || 0;
  const archive = Buffer.from(encodedPart.trim(), "base64");
  if (!archive.length) {
    return {
      ok: false,
      statusCode: 500,
      message: "Sandbox export produced an empty archive",
    };
  }
  return { ok: true, bytes, archive };
}

async function readFileInSession(
  session: SessionRecord,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<Record<string, unknown>> {
  const targetPath = resolveSandboxPath(session, filePath);
  const start =
    typeof startLine === "number"
      ? Math.max(1, Math.floor(startLine))
      : undefined;
  const end =
    typeof endLine === "number" ? Math.max(1, Math.floor(endLine)) : undefined;
  const contentCommand =
    start && end
      ? `sed -n '${start},${end}p' ${shQuote(targetPath)} | base64 -w0`
      : `base64 -w0 ${shQuote(targetPath)}`;
  const command =
    `if [ ! -f ${shQuote(targetPath)} ]; then echo "__XIBECODE_NOT_FILE__"; exit 3; fi; ` +
    `wc -l < ${shQuote(targetPath)} | tr -d ' ' && echo "__XIBECODE_SPLIT__" && ${contentCommand}`;
  const result = await runInSession(session, {
    command,
    cwd: session.workspaceRoot,
    timeout: 60,
  });
  if (!result.success) {
    return {
      error: true,
      success: false,
      message: `Failed to read ${filePath}: ${String(result.stderr || result.message || "unknown error")}`,
    };
  }
  const raw = String(result.stdout || "");
  if (raw.includes("__XIBECODE_NOT_FILE__")) {
    return { error: true, success: false, message: `Not a file: ${filePath}` };
  }
  const [linesPart, encodedPart] = raw.split("__XIBECODE_SPLIT__");
  const totalLines = Number((linesPart || "").trim()) || 0;
  const content = Buffer.from((encodedPart || "").trim(), "base64").toString(
    "utf8",
  );
  if (start && end) {
    return {
      success: true,
      path: filePath,
      content,
      lines: end - start + 1,
      total_lines: totalLines,
      partial: true,
    };
  }
  return {
    success: true,
    path: filePath,
    content,
    lines: totalLines,
    size: content.length,
  };
}

async function writeFileInSession(
  session: SessionRecord,
  filePath: string,
  content: string,
): Promise<Record<string, unknown>> {
  const targetPath = resolveSandboxPath(session, filePath);
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const command =
    `mkdir -p ${shQuote(pathPosix.dirname(targetPath))} && ` +
    `printf '%s' ${shQuote(encoded)} | base64 -d > ${shQuote(targetPath)}`;
  const result = await runInSession(session, {
    command,
    cwd: session.workspaceRoot,
    timeout: 120,
  });
  if (!result.success) {
    return {
      error: true,
      success: false,
      message: `Failed to write ${filePath}: ${String(result.stderr || result.message || "unknown error")}`,
    };
  }
  return {
    success: true,
    path: filePath,
    lines: content.split("\n").length,
    size: content.length,
  };
}

async function deleteFileInSession(
  session: SessionRecord,
  filePath: string,
): Promise<Record<string, unknown>> {
  const targetPath = resolveSandboxPath(session, filePath);
  const result = await runInSession(session, {
    command: `rm -rf ${shQuote(targetPath)}`,
    cwd: session.workspaceRoot,
    timeout: 60,
  });
  if (!result.success) {
    return {
      error: true,
      success: false,
      message: `Failed to delete ${filePath}: ${String(result.stderr || result.message || "unknown error")}`,
    };
  }
  return { success: true, path: filePath };
}

async function listDirectoryInSession(
  session: SessionRecord,
  dirPath: string,
): Promise<Record<string, unknown>> {
  const targetPath = resolveSandboxPath(session, dirPath || ".");
  const command =
    `if [ ! -d ${shQuote(targetPath)} ]; then echo "__XIBECODE_NOT_DIR__"; exit 3; fi; ` +
    `for item in ${shQuote(targetPath)}/*; do ` +
    `if [ ! -e "$item" ]; then continue; fi; ` +
    `name=$(basename "$item"); ` +
    `if [ -d "$item" ]; then type="directory"; else type="file"; fi; ` +
    `size=$(wc -c < "$item" 2>/dev/null || echo 0); ` +
    `printf '%s\t%s\t%s\n' "$name" "$type" "$size"; ` +
    `done`;
  const result = await runInSession(session, {
    command,
    cwd: session.workspaceRoot,
    timeout: 60,
  });
  if (!result.success) {
    const stderr = String(result.stderr || result.message || "unknown error");
    if (stderr.includes("__XIBECODE_NOT_DIR__")) {
      return {
        error: true,
        success: false,
        message: `Not a directory: ${dirPath}`,
      };
    }
    return {
      error: true,
      success: false,
      message: `Failed to list directory ${dirPath}: ${stderr}`,
    };
  }
  const entries = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, type, size] = line.split("\t");
      return {
        name,
        type: type === "directory" ? "directory" : "file",
        size: Number(size || "0") || 0,
      };
    });
  return {
    success: true,
    path: dirPath,
    entries,
    count: entries.length,
  };
}

const MIGRATE_ARCHIVE = "/tmp/vectra-migrate.tgz";
const MIGRATE_MAX_BYTES = 200 * 1024 * 1024;

function migratePackCommand(): string {
  return [
    "set -e",
    `rm -f ${shQuote(MIGRATE_ARCHIVE)}`,
    "mkdir -p /home/user/workspace /home/user/.xibecode /home/user/.superagent /home/user/.supercharge",
    `tar -C /home/user -czf ${shQuote(MIGRATE_ARCHIVE)}`,
    "  --exclude='workspace/node_modules'",
    "  --exclude='workspace/**/node_modules'",
    "  --exclude='workspace/.next'",
    "  --exclude='workspace/dist'",
    "  --exclude='workspace/build'",
    "  --exclude='workspace/.turbo'",
    "  --exclude='workspace/.cache'",
    "  --exclude='workspace/**/.venv'",
    "  --exclude='workspace/**/__pycache__'",
    "  --exclude='.xibecode/file-history'",
    "  --exclude='.superagent/file-history'",
    "  --exclude='.superagent/lifecycle'",
    "  workspace .xibecode .superagent .supercharge",
    `wc -c < ${shQuote(MIGRATE_ARCHIVE)} | tr -d ' '`,
  ].join(" ");
}

async function readSandboxBytes(
  sandbox: SandboxLike,
  absPath: string,
): Promise<Buffer> {
  if (sandbox.files?.read) {
    const raw = await sandbox.files.read(absPath, { format: "bytes" });
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    if (typeof raw === "string") return Buffer.from(raw, "base64");
  }
  throw new Error("sandbox files.read is unavailable");
}

async function writeSandboxBytes(
  sandbox: SandboxLike,
  absPath: string,
  data: Buffer,
): Promise<void> {
  if (sandbox.files?.write) {
    await sandbox.files.write(absPath, data);
    return;
  }
  throw new Error("sandbox files.write is unavailable");
}

async function copyArchiveChunked(
  oldSession: SessionRecord,
  newSandbox: SandboxLike,
): Promise<number> {
  const listed = await runInSession(oldSession, {
    command: `split -b 1200000 ${shQuote(MIGRATE_ARCHIVE)} /tmp/vectra-mig-part- && ls /tmp/vectra-mig-part-* | wc -l`,
    cwd: "/tmp",
    timeout: 180,
  });
  if (!listed.success) {
    throw new Error(
      `Could not split migrate archive: ${String(listed.stderr || listed.message || "")}`,
    );
  }
  const parts = Number(String(listed.stdout || "").trim()) || 0;
  if (parts < 1) throw new Error("Migrate archive split produced no parts");
  let bytes = 0;
  await newSandbox.commands?.run(
    `rm -f ${shQuote(MIGRATE_ARCHIVE)} /tmp/vectra-mig-part-*`,
    {
      cwd: "/tmp",
      timeoutMs: 30_000,
    },
  );
  for (let i = 0; i < parts; i++) {
    const suffix =
      String.fromCharCode(97 + Math.floor(i / 26)) +
      String.fromCharCode(97 + (i % 26));
    // split default suffix: aa, ab, ...
    const partName = `/tmp/vectra-mig-part-${suffix}`;
    const encoded = await runInSession(oldSession, {
      command: `base64 -w0 ${shQuote(partName)}`,
      cwd: "/tmp",
      timeout: 120,
    });
    if (!encoded.success) {
      throw new Error(`Failed to read migrate part ${partName}`);
    }
    const b64 = String(encoded.stdout || "").trim();
    bytes += Buffer.from(b64, "base64").length;
    const wr = await newSandbox.commands?.run(
      `printf '%s' ${shQuote(b64)} | base64 -d >> ${shQuote(MIGRATE_ARCHIVE)}`,
      { cwd: "/tmp", timeoutMs: 120_000 },
    );
    const exitCode =
      typeof (wr as any)?.exitCode === "number" ? (wr as any).exitCode : 0;
    if (exitCode !== 0) {
      throw new Error(
        `Failed to write migrate part ${partName} on new sandbox`,
      );
    }
  }
  return bytes;
}

/**
 * Spin a new template sandbox and move workspace + ~/.xibecode (API keys,
 * chat transcripts, pairing) onto it. Skips node_modules / build caches.
 * Same gateway session id — only the VM changes.
 */
async function recreateSandboxInSession(session: SessionRecord): Promise<{
  ok: true;
  sessionId: string;
  oldSandboxId: string;
  sandboxId: string;
  template: string;
  bytes: number;
  logs: string[];
}> {
  const logs: string[] = [];
  const profile = runtimeProfile(session.runtime);
  const oldSandboxId = session.sandboxId;
  await touchSession(session);

  logs.push(
    `packing workspace + ${profile.label} runtime config (skip node_modules)`,
  );
  // Flush old-VM handlers before the final archive is assembled.
  const packed = await prepareMigration(
    session.sandbox,
    session.runtime,
    () => runInSession(session, {
      command: migratePackCommand(),
      cwd: "/tmp",
      timeout: 300,
    }),
    (message) => logs.push(message),
  );
  if (!packed.success) {
    throw new Error(
      `Failed to pack sandbox: ${String(packed.stderr || packed.message || "")}`,
    );
  }
  const bytes = Number(String(packed.stdout || "").trim()) || 0;
  if (bytes <= 0) throw new Error("Migrate archive is empty");
  if (bytes > MIGRATE_MAX_BYTES) {
    throw new Error(
      `Migrate archive is ${Math.ceil(bytes / (1024 * 1024))}MB (max ${Math.ceil(MIGRATE_MAX_BYTES / (1024 * 1024))}MB). Remove large artifacts and retry.`,
    );
  }
  logs.push(`packed ${Math.ceil(bytes / 1024)}KB`);

  logs.push(
    `creating ${profile.label} sandbox from template ${profile.template}`,
  );
  const created = (await Sandbox.create({
    template: profile.template,
    timeoutMs: sandboxTimeoutMs,
    lifecycle: sandboxLifecycle,
  })) as unknown as SandboxLike;
  const newSandboxId = created.sandboxId || randomUUID();
  logs.push(`new sandbox ${newSandboxId}`);

  try {
    try {
      const buf = await readSandboxBytes(session.sandbox, MIGRATE_ARCHIVE);
      await writeSandboxBytes(created, MIGRATE_ARCHIVE, buf);
      logs.push("copied archive via files API");
    } catch (err) {
      logs.push(
        `files API copy failed (${(err as Error).message}) — chunked fallback`,
      );
      await copyArchiveChunked(session, created);
      logs.push("copied archive in chunks");
    }

    const extracted = await created.commands?.run(
      [
        "set -e",
        "mkdir -p /home/user/workspace /home/user/.xibecode /home/user/.superagent /home/user/.supercharge",
        `tar -C /home/user -xzf ${shQuote(MIGRATE_ARCHIVE)}`,
        "chown -R user:user /home/user/workspace /home/user/.xibecode /home/user/.superagent /home/user/.supercharge 2>/dev/null || true",
        `rm -f ${shQuote(MIGRATE_ARCHIVE)}`,
        "test -d /home/user/workspace",
        "test -d /home/user/.xibecode && test -d /home/user/.superagent && test -d /home/user/.supercharge",
        "echo EXTRACT_OK",
      ].join("; "),
      { cwd: "/tmp", timeoutMs: 300_000 },
    );
    const extractOut = `${String((extracted as any)?.stdout || "")}\n${String((extracted as any)?.stderr || "")}`;
    if (!extractOut.includes("EXTRACT_OK")) {
      throw new Error(
        `Failed to extract on new sandbox: ${extractOut.slice(0, 400)}`,
      );
    }
    logs.push("extracted workspace + keys/chat");
  } catch (err) {
    try {
      await killWithPreStop(created, session.runtime, (message) => logs.push(message));
    } catch {
      /* ignore */
    }
    throw err;
  }

  const oldSandbox = session.sandbox;
  session.sandbox = created;
  session.sandboxId = newSandboxId;
  session.updatedAt = Date.now();
  session.continuousRunStartedAt = Date.now();
  if (session.runtime === "supercharge") {
    await rememberRun(session, await Sandbox.getInfo(newSandboxId), session.continuousRunStartedAt);
    try {
      await lifecycleStore.remove(oldSandboxId);
    } catch (err) {
      logs.push(`old sandbox lifecycle cleanup failed: ${(err as Error).message}`);
    }
  }
  logs.push("session now points at new sandbox");

  try {
    if (!oldSandbox.kill) throw new Error("E2B provider kill is unavailable");
    await oldSandbox.kill();
    logs.push(`killed old sandbox ${oldSandboxId}`);
  } catch (err) {
    logs.push(`old sandbox kill failed: ${(err as Error).message}`);
  }

  return {
    ok: true,
    sessionId: session.sessionId,
    oldSandboxId,
    sandboxId: newSandboxId,
    template: profile.template,
    bytes,
    logs,
  };
}

async function closeSession(session: SessionRecord): Promise<void> {
  await deleteAfterKill(
    session.sandbox,
    session.runtime,
    async () => {
      if (session.runtime === "supercharge") {
        try {
          await lifecycleStore.remove(session.sandboxId);
        } catch (err) {
          console.warn(`[xibecode-e2b-gateway] lifecycle cleanup failed for ${session.sandboxId}:`, err);
        }
      }
      sessions.delete(session.sessionId);
    },
    (message) => console.warn(message),
  );
}

const pluginRuntimeLocks = new Set<string>();

async function pinnedPluginRuntime(session: SessionRecord, mode: "status" | "update" | "rollback" | "confirm"): Promise<Record<string, unknown>> {
  if (!session.sandbox.commands?.run) throw new Error("E2B command control is unavailable");
  if (mode === "status" || mode === "update") {
    const preflight = await session.sandbox.commands.run("test -d /opt/vectra/plugin-api", { user: "root", cwd: "/", timeoutMs: 10_000 });
    if (preflight.exitCode !== 0) {
      if (mode === "status") return { ready: false, supported: false };
      throw new Error("This VM image has no Plugin API runtime; in-place update is unavailable for this image");
    }
  }
  const result = await session.sandbox.commands.run(pluginRuntimeCommand(mode), {
    user: "root",
    cwd: "/opt/vectra/plugin-api",
    timeoutMs: mode === "update" ? 120_000 : 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`Pinned runtime ${mode} failed; no unverified update was confirmed`);
  const data = JSON.parse(String(result.stdout || "")) as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid E2B runtime response");
  return data;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || `localhost:${port}`}`,
    );

    // Public health for orchestrators (Coolify, Docker HEALTHCHECK). No secrets in body.
    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        success: true,
        service: "vectra-gateway",
        sessions: sessions.size,
        hasE2BKey: Boolean(process.env.E2B_API_KEY),
        authRequired: Boolean(authToken),
        capabilities: { browserVncTicketRelay: true },
        lifecycle: {
          onTimeout: lifecycleOnTimeout,
          autoResume: lifecycleAutoResume,
          inactivityTimeoutMs: sandboxTimeoutMs,
          maxContinuousMs,
          maxContinuousHours:
            maxContinuousMs > 0
              ? Math.round((maxContinuousMs / 3_600_000) * 100) / 100
              : 0,
        },
      });
      return;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, {
        success: false,
        error: true,
        message: "Unauthorized",
      });
      return;
    }

    const githubTokenMatch = url.pathname.match(/^\/sessions\/([^/]+)\/github-mcp-token$/);
    if (method === "POST" && githubTokenMatch) {
      if (!authToken) { sendJson(res, 503, { error: "Authenticated gateway token required" }); return; }
      const session = sessions.get(decodeURIComponent(githubTokenMatch[1] || ""));
      if (!session || session.runtime !== "supercharge") { sendJson(res, 404, { error: "Supercharge session not found" }); return; }
      const body = await readJson<{ sandboxId?: unknown; botId?: unknown }>(req);
      if (!body || Object.keys(body).some((key) => key !== "sandboxId" && key !== "botId") ||
          body.sandboxId !== session.sandboxId || body.botId !== "github") {
        sendJson(res, 400, { error: "Current VM and GitHub bot are required" }); return;
      }
      try {
        await touchSession(session);
        if (!session.sandbox.commands?.run) throw new Error('E2B command control unavailable');
        const result = await session.sandbox.commands.run(githubMcpTokenCommand(), {
          user: "root", cwd: "/opt/vectra/plugin-api", timeoutMs: 15_000,
        });
        if (result.exitCode !== 0) { sendJson(res, 404, { error: "GitHub MCP credential unavailable" }); return; }
        const output = JSON.parse(String(result.stdout || "")) as { token?: unknown };
        if (typeof output.token !== "string" || !output.token || output.token.length > 8192) throw new Error("Invalid credential result");
        sendJson(res, 200, { token: output.token, sandboxId: session.sandboxId });
      } catch {
        sendJson(res, 502, { error: "GitHub MCP credential could not be retrieved" });
      }
      return;
    }

    const pluginRuntimeMatch = url.pathname.match(/^\/sessions\/([^/]+)\/plugin-runtime$/);
    if (pluginRuntimeMatch && (method === "GET" || method === "POST")) {
      if (!authToken) {
        sendJson(res, 503, { error: "Authenticated gateway token required" });
        return;
      }
      const session = sessions.get(decodeURIComponent(pluginRuntimeMatch[1] || ""));
      if (!session || session.runtime !== "supercharge") {
        sendJson(res, 404, { error: "Supercharge session not found" });
        return;
      }
      let botId = "";
      if (method === "POST") {
        if (Number(req.headers["content-length"] || 0) > 256) {
          sendJson(res, 413, { error: "Plugin runtime request too large" });
          return;
        }
        const body = await readJson<{ sandboxId?: unknown; botId?: unknown }>(req);
        if (!body || Object.keys(body).some((key) => key !== "sandboxId" && key !== "botId") ||
            body.sandboxId !== session.sandboxId || typeof body.botId !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(body.botId)) {
          sendJson(res, 400, { error: "Sandbox generation and bot are required" });
          return;
        }
        botId = body.botId;
      }
      if (pluginRuntimeLocks.has(session.sandboxId)) {
        sendJson(res, 409, { error: "Plugin runtime update is already in progress" });
        return;
      }
      pluginRuntimeLocks.add(session.sandboxId);
      try {
        await touchSession(session);
        const before = session.sandboxId;
        const result = await pinnedPluginRuntime(session, method === "GET" ? "status" : "update");
        if (method === "POST" && result.updated === true) {
          try {
            const health = await superchargeDaemonFetch(session, "/health", { signal: AbortSignal.timeout(10_000) });
            if (!health.ok) throw new Error("Daemon health check failed");
            const status = await superchargeDaemonFetch(session, `/v1/app/bots/${encodeURIComponent(botId)}/plugin-api`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "status" }), signal: AbortSignal.timeout(30_000),
            });
            const data = await status.json() as { service?: { allowedMcpOrigins?: string[] }; inventory?: { plugins?: unknown[] } };
            if (!status.ok || !Array.isArray(data.inventory?.plugins) ||
                !data.service?.allowedMcpOrigins?.includes("https://api.githubcopilot.com")) {
              throw new Error("Plugin API health or GitHub allowlist check failed");
            }
            await pinnedPluginRuntime(session, "confirm");
          } catch {
            await pinnedPluginRuntime(session, "rollback");
            throw new Error("Plugin API health check failed; previous controller and catalog restored");
          }
        }
        if (session.sandboxId !== before) throw new Error("Sandbox identity changed unexpectedly");
        sendJson(res, 200, { success: true, sandboxId: before, ...result });
      } catch (error) {
        sendJson(res, 502, { error: (error as Error).message.slice(0, 240) });
      } finally {
        pluginRuntimeLocks.delete(session.sandboxId);
      }
      return;
    }

    const browserHandoffMatch = url.pathname.match(
      /^\/sessions\/([^/]+)\/browser\/handoff$/,
    );
    if (method === "POST" && browserHandoffMatch) {
      const sessionId = decodeURIComponent(browserHandoffMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, { success: false, error: true, message: "Session not found" });
        return;
      }
      if (session.runtime !== "supercharge") {
        sendJson(res, 404, { success: false, error: true, message: "Browser handoff is available only for Supercharge sessions" });
        return;
      }
      const body = await readJson<{ action?: unknown; minutes?: unknown; handoffId?: string; botId?: string }>(req);
      const action = String(body.action || "").trim().toLowerCase();
      if (action !== "start" && action !== "stop") {
        sendJson(res, 400, { success: false, error: true, message: "action must be start or stop" });
        return;
      }
      const minutes = Math.min(Math.max(Number(body.minutes) || 10, 1), 30);
      try {
        const upstream = await superchargeDaemonFetch(session, "/v1/computer/handoff", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ action, minutes, handoffId: body.handoffId, botId: body.botId || "main" }),
        });
        const text = await upstream.text();
        sendJson(res, upstream.status, text ? JSON.parse(text) : { success: upstream.ok });
      } catch (error) {
        sendJson(res, 502, { success: false, error: true, message: (error as Error).message });
      }
      return;
    }

    const browserTicketMatch = url.pathname.match(
      /^\/sessions\/([^/]+)\/browser\/vnc-ticket$/,
    );
    if (method === "POST" && browserTicketMatch) {
      const sessionId = decodeURIComponent(browserTicketMatch[1] || "");
      const session = findSession(sessionId);
      if (!session || session.runtime !== "supercharge") {
        sendJson(res, 404, { success: false, error: true, message: "Supercharge session not found" });
        return;
      }
      const body = await readJson<{ handoffId?: unknown; botId?: unknown }>(req);
      if (typeof body.handoffId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(body.handoffId)) {
        sendJson(res, 400, { error: "A current handoffId is required" }); return;
      }
      const botId = body.botId == null ? "main" : body.botId;
      if (typeof botId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(botId)) {
        sendJson(res, 400, { error: "Invalid botId" }); return;
      }
      try {
        const status = await superchargeDaemonFetch(session, `/v1/computer/status?botId=${encodeURIComponent(botId)}`);
        const state = await status.json() as { handoff?: boolean; handoffId?: string; botId?: string; expiresAt?: number; handoffProtocol?: number };
        if (!status.ok || state.handoff !== true || state.handoffId !== body.handoffId || (state.botId || "main") !== botId || (state.expiresAt || 0) <= Date.now() || (state.handoffProtocol || 0) < 2) {
          sendJson(res, 409, { error: "Take control using an updated E2B desktop before opening VNC" }); return;
        }
        const ticket = issueBrowserVncTicket(session.sessionId, body.handoffId, botId);
        sendJson(res, 200, { success: true, ticket, botId, handoffId: body.handoffId, expiresInSeconds: 60, sessionId: session.sessionId });
      } catch (error) {
        sendJson(res, 502, { success: false, error: true, message: (error as Error).message });
      }
      return;
    }

    // Live E2B state by sandbox id (works even if gateway session map is empty / sandbox paused)
    const sandboxStateMatch = url.pathname.match(
      /^\/sandboxes\/([^/]+)(?:\/state)?$/,
    );
    if (method === "GET" && sandboxStateMatch) {
      const sandboxId = decodeURIComponent(sandboxStateMatch[1] || "").trim();
      if (!sandboxId) {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing sandboxId",
        });
        return;
      }
      try {
        const info = (await Sandbox.getInfo(sandboxId)) as {
          state?: string;
          sandboxId?: string;
          templateId?: string;
          cpuCount?: number;
          memoryMB?: number;
          lifecycle?: { onTimeout?: string; autoResume?: boolean };
        };
        const state = String(info.state || "unknown");
        sendJson(res, 200, {
          success: true,
          sandboxId: info.sandboxId || sandboxId,
          state,
          // paused sandboxes remain owned/resumable — not deleted
          resumable: state === "paused" || state === "running",
          templateId: info.templateId,
          cpuCount: info.cpuCount,
          memoryMB: info.memoryMB,
          lifecycle: info.lifecycle,
        });
      } catch (e) {
        const msg = (e as Error).message || String(e);
        // Not found / killed — still return structured body so dashboard can show "gone"
        sendJson(res, 200, {
          success: true,
          sandboxId,
          state: "missing",
          resumable: false,
          message: msg.slice(0, 300),
        });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/sessions") {
      const data = Array.from(sessions.values()).map((session) => ({
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
        strategy: session.strategy,
        runtime: session.runtime,
        template: runtimeProfile(session.runtime).template,
        cwd: session.cwd,
        workspaceRoot: session.workspaceRoot,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        continuousRunStartedAt: session.continuousRunStartedAt,
        continuousRunAgeMs: Date.now() - session.continuousRunStartedAt,
        cycleCount: session.cycleCount,
        lastCycleResetAt: session.lastCycleResetAt,
      }));
      sendJson(res, 200, { success: true, sessions: data });
      return;
    }

    const bySandboxMatch = url.pathname.match(
      /^\/sessions\/by-sandbox\/([^/]+)$/,
    );
    if (method === "GET" && bySandboxMatch) {
      const requestedSandboxId = decodeURIComponent(
        bySandboxMatch[1] || "",
      ).trim();
      if (!requestedSandboxId) {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing sandboxId path parameter",
        });
        return;
      }
      const session = Array.from(sessions.values()).find(
        (s) => s.sandboxId === requestedSandboxId,
      );
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Sandbox not found: ${requestedSandboxId}`,
        });
        return;
      }
      session.updatedAt = Date.now();
      await touchSession(session);
      sendJson(res, 200, {
        success: true,
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
        strategy: session.strategy,
        runtime: session.runtime,
        template: runtimeProfile(session.runtime).template,
        cwd: session.cwd,
        workspaceRoot: session.workspaceRoot,
        continuousRunStartedAt: session.continuousRunStartedAt,
        cycleCount: session.cycleCount,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/sessions") {
      const body = await readJson<{
        sessionId?: string;
        cwd?: string;
        strategy?: string;
        runtime?: AgentRuntime | string;
        workspaceRoot?: string;
        sandboxId?: string;
        cpuCount?: number;
        memoryMB?: number;
      }>(req);
      const session = await createSession(body);
      sendJson(res, 200, {
        success: true,
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
        strategy: session.strategy,
        runtime: session.runtime,
        template: runtimeProfile(session.runtime).template,
        cwd: session.cwd,
        workspaceRoot: session.workspaceRoot,
        continuousRunStartedAt: session.continuousRunStartedAt,
        cycleCount: session.cycleCount,
        lifecycle: {
          onTimeout: lifecycleOnTimeout,
          autoResume: lifecycleAutoResume,
          inactivityTimeoutMs: sandboxTimeoutMs,
          maxContinuousMs,
        },
      });
      return;
    }

    // Explicit wake/resume (dashboard button, ops, after idle pause)
    const wakeMatch = url.pathname.match(/^\/sessions\/([^/]+)\/wake$/);
    if (method === "POST" && wakeMatch) {
      const sessionId = decodeURIComponent(wakeMatch[1] || "");
      let session = sessions.get(sessionId);
      const body = await readJson<{
        sandboxId?: string;
        runtime?: AgentRuntime | string;
        restartDaemon?: boolean;
      }>(req).catch(
        () =>
          ({}) as {
            sandboxId?: string;
            runtime?: AgentRuntime | string;
            restartDaemon?: boolean;
          },
      );
      if (!session && body.sandboxId) {
        session = await createSession({
          sessionId,
          sandboxId: body.sandboxId,
          strategy: "sandbox_full",
          runtime: body.runtime,
        });
      }
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId} (pass sandboxId to reattach)`,
        });
        return;
      }
      try {
        const status = await ensureSandboxRunning(session);
        let daemon: { ok?: boolean; logs?: string[] } | undefined;
        const profile = runtimeProfile(session.runtime);
        const runtimeHome =
          session.runtime === "supercharge"
            ? "/home/user/.superagent"
            : "/home/user/.xibecode";
        if (body.restartDaemon) {
          // After long pause, frozen TCP (Telegram long-poll) is stale — restart daemon.
          // Poll until process is up (resume can take a few seconds for envd/npm).
          const r = await runInSession(session, {
            command: [
              "set +e",
              "set -a",
              `[ -f ${runtimeHome}/daemon.env ] && . ${runtimeHome}/daemon.env`,
              `[ -f ${runtimeHome}/gateway.env ] && . ${runtimeHome}/gateway.env`,
              "set +a",
              ...(session.runtime === "supercharge" ? [
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
              // Template wake HTTP (doorbell) + bot long-poll (separate)
              "if [ -x /opt/vectra/wake-http/start.sh ]; then /opt/vectra/wake-http/start.sh || true; fi",
              'if [ -n "${TELEGRAM_BOT_TOKEN:-}${XIBECODE_TELEGRAM_BOT_TOKEN:-}${SUPERAGENT_TELEGRAM_BOT_TOKEN:-}" ]; then',
              '  TOK="${TELEGRAM_BOT_TOKEN:-${XIBECODE_TELEGRAM_BOT_TOKEN:-${SUPERAGENT_TELEGRAM_BOT_TOKEN:-}}}"',
              '  curl -sS -m 10 -X POST "https://api.telegram.org/bot${TOK}/deleteWebhook" -d "drop_pending_updates=false" >/dev/null 2>&1 || true',
              "fi",
              // Stop only the configured sandbox daemon. The pidfile avoids matching
              // the restart shell itself; the optional pattern handles legacy templates.
              `if [ -f ${shQuote(profile.pidFile)} ]; then`,
              `  OLD="$(cat ${shQuote(profile.pidFile)} 2>/dev/null)"`,
              '  if [ -n "$OLD" ]; then kill "$OLD" 2>/dev/null || true; sleep 1; kill -9 "$OLD" 2>/dev/null || true; fi',
              `  rm -f ${shQuote(profile.pidFile)}`,
              "fi",
              `for pid in $(pgrep -f ${shQuote(profile.processMatch)} 2>/dev/null || true); do`,
              '  if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then',
              '    case "$(tr "\\0" " " < /proc/$pid/cmdline 2>/dev/null || true)" in',
              '      *daemon*) kill "$pid" 2>/dev/null || true ;;',
              "    esac",
              "  fi",
              "done",
              "sleep 1",
              `nohup ${profile.daemonCommand} >${shQuote(profile.logFile)} 2>&1 &`,
              `echo $! > ${shQuote(profile.pidFile)}`,
              "OK=0",
              'INBOX="${SUPERAGENT_APP_INBOX_PORT:-${XIBECODE_APP_INBOX_PORT:-8790}}"',
              "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do",
              "  sleep 1",
              '  if curl -sf -m 2 "http://127.0.0.1:${INBOX}/health" >/dev/null 2>&1 || curl -sf -m 2 "http://127.0.0.1:${INBOX}/healthz" >/dev/null 2>&1; then OK=1; break; fi',
              ...(session.runtime === "supercharge"
                ? [`  if ! kill -0 "$(cat ${shQuote(profile.pidFile)} 2>/dev/null)" 2>/dev/null; then break; fi`]
                : [
                    `  if [ -f ${shQuote(profile.pidFile)} ] && kill -0 "$(cat ${shQuote(profile.pidFile)})" 2>/dev/null; then OK=1; break; fi`,
                    `  if pgrep -af ${shQuote(profile.processMatch)} 2>/dev/null | grep -vF "pgrep" | grep -q .; then OK=1; break; fi`,
                  ]),
              "done",
              'if [ "$OK" = "1" ]; then echo DAEMON_OK; else echo DAEMON_FAIL; fi',
              'curl -sS -m 2 "http://127.0.0.1:${INBOX}/health" 2>/dev/null | head -c 200 || curl -sS -m 2 "http://127.0.0.1:${INBOX}/healthz" 2>/dev/null | head -c 200 || true',
              "echo",
              'WP="${SUPERAGENT_WAKE_PORT:-${VECTRA_WAKE_PORT:-8788}}"',
              'curl -sS -m 2 "http://127.0.0.1:${WP}/health" 2>/dev/null | head -c 200 || true',
              "echo",
              'echo "--- daemon pid ---"',
              `cat ${shQuote(profile.pidFile)} 2>/dev/null || true`,
              'echo "--- daemon log (tail) ---"',
              `tail -50 ${shQuote(profile.logFile)} 2>/dev/null || true`,
            ].join("\n"),
            timeout: 120,
          });
          const out = `${r.stdout || ""}\n${r.stderr || ""}`;
          daemon = {
            ok: out.includes("DAEMON_OK"),
            logs: [out.slice(0, 2000)],
          };
        }
        sendJson(res, 200, {
          success: true,
          sessionId: session.sessionId,
          sandboxId: session.sandboxId,
          state: status.state,
          resumed: status.resumed,
          daemon,
        });
      } catch (e) {
        sendJson(res, 502, {
          success: false,
          error: true,
          message: (e as Error).message,
        });
      }
      return;
    }

    const execMatch = url.pathname.match(/^\/sessions\/([^/]+)\/exec$/);
    if (method === "POST" && execMatch) {
      const sessionId = decodeURIComponent(execMatch[1] || "");
      const body = await readJson<ExecRequest & { sandboxId?: string }>(req);
      if (!body.command || typeof body.command !== "string") {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required field: command",
        });
        return;
      }
      // Same reattach path as /wake — session map is memory-only after gateway restart
      let session = sessions.get(sessionId);
      if (!session && body.sandboxId) {
        try {
          session = await createSession({
            sessionId,
            sandboxId: String(body.sandboxId),
            strategy: "sandbox_full",
          });
        } catch (e) {
          sendJson(res, 502, {
            success: false,
            error: true,
            message: `reattach failed: ${(e as Error).message}`,
          });
          return;
        }
      }
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId} (pass sandboxId to reattach)`,
        });
        return;
      }
      try {
        const result = await runInSession(session, body);
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 502, {
          success: false,
          error: true,
          message: (e as Error).message,
          exitCode: 1,
        });
      }
      return;
    }

    const syncMatch = url.pathname.match(/^\/sessions\/([^/]+)\/sync$/);
    if (method === "POST" && syncMatch) {
      const sessionId = decodeURIComponent(syncMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const body = await readJson<SyncRequest>(req);
      const result = await syncWorkspaceChunk(session, body);
      sendJson(res, 200, result);
      return;
    }

    const previewMatch = url.pathname.match(
      /^\/sessions\/([^/]+)\/preview-host$/,
    );
    if (method === "GET" && previewMatch) {
      const sessionId = decodeURIComponent(previewMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const requestedPort = Number(url.searchParams.get("port") || "3000");
      if (
        !Number.isFinite(requestedPort) ||
        requestedPort < 1 ||
        requestedPort > 65535
      ) {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Invalid port. Use 1-65535.",
        });
        return;
      }
      const host = await resolvePreviewHost(session, Math.floor(requestedPort));
      sendJson(res, 200, {
        success: true,
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
        port: Math.floor(requestedPort),
        host,
      });
      return;
    }

    const fileMatch = url.pathname.match(/^\/sessions\/([^/]+)\/file$/);
    if (fileMatch && method === "GET") {
      const sessionId = decodeURIComponent(fileMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const queryPath = url.searchParams.get("path");
      if (!queryPath) {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required query parameter: path",
        });
        return;
      }
      const startLine = Number(url.searchParams.get("start_line") || "");
      const endLine = Number(url.searchParams.get("end_line") || "");
      const result = await readFileInSession(
        session,
        queryPath,
        Number.isFinite(startLine) ? startLine : undefined,
        Number.isFinite(endLine) ? endLine : undefined,
      );
      sendJson(res, result.success === false ? 400 : 200, result);
      return;
    }

    if (fileMatch && method === "PUT") {
      const sessionId = decodeURIComponent(fileMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const body = await readJson<FileMutationRequest>(req);
      if (!body.path || typeof body.path !== "string") {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required field: path",
        });
        return;
      }
      if (typeof body.content !== "string") {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required field: content",
        });
        return;
      }
      const result = await writeFileInSession(session, body.path, body.content);
      sendJson(res, result.success === false ? 400 : 200, result);
      return;
    }

    if (fileMatch && method === "DELETE") {
      const sessionId = decodeURIComponent(fileMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const body = await readJson<FileMutationRequest>(req);
      if (!body.path || typeof body.path !== "string") {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required field: path",
        });
        return;
      }
      const result = await deleteFileInSession(session, body.path);
      sendJson(res, result.success === false ? 400 : 200, result);
      return;
    }

    const listMatch = url.pathname.match(/^\/sessions\/([^/]+)\/list$/);
    if (method === "GET" && listMatch) {
      const sessionId = decodeURIComponent(listMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const queryPath = url.searchParams.get("path") || ".";
      const result = await listDirectoryInSession(session, queryPath);
      sendJson(res, result.success === false ? 400 : 200, result);
      return;
    }

    const directoryMatch = url.pathname.match(
      /^\/sessions\/([^/]+)\/directory$/,
    );
    if (method === "POST" && directoryMatch) {
      const sessionId = decodeURIComponent(directoryMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const body = await readJson<FileMutationRequest>(req);
      if (!body.path || typeof body.path !== "string") {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required field: path",
        });
        return;
      }
      const targetPath = resolveSandboxPath(session, body.path);
      const result = await runInSession(session, {
        command: `mkdir -p ${shQuote(targetPath)}`,
        cwd: session.workspaceRoot,
        timeout: 60,
      });
      sendJson(
        res,
        result.success ? 200 : 400,
        result.success ? { success: true, path: body.path } : result,
      );
      return;
    }

    const moveMatch = url.pathname.match(/^\/sessions\/([^/]+)\/move$/);
    if (method === "POST" && moveMatch) {
      const sessionId = decodeURIComponent(moveMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const body = await readJson<MoveRequest>(req);
      if (
        !body.source ||
        typeof body.source !== "string" ||
        !body.destination ||
        typeof body.destination !== "string"
      ) {
        sendJson(res, 400, {
          success: false,
          error: true,
          message: "Missing required fields: source, destination",
        });
        return;
      }
      const source = resolveSandboxPath(session, body.source);
      const destination = resolveSandboxPath(session, body.destination);
      const result = await runInSession(session, {
        command: `mkdir -p ${shQuote(pathPosix.dirname(destination))} && mv ${shQuote(source)} ${shQuote(destination)}`,
        cwd: session.workspaceRoot,
        timeout: 60,
      });
      sendJson(
        res,
        result.success ? 200 : 400,
        result.success
          ? {
              success: true,
              source: body.source,
              destination: body.destination,
            }
          : result,
      );
      return;
    }

    const exportMatch = url.pathname.match(/^\/sessions\/([^/]+)\/export$/);
    if (method === "GET" && exportMatch) {
      const sessionId = decodeURIComponent(exportMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      const exported = await exportWorkspaceArchiveInSession(session);
      if (!exported.ok) {
        sendJson(res, exported.statusCode, {
          success: false,
          error: true,
          message: exported.message,
          bytes: exported.bytes,
          maxBytes: maxExportBytes,
          maxMb: Math.ceil(maxExportBytes / (1024 * 1024)),
        });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Length", String(exported.archive.length));
      const runtimeLabel =
        session.runtime === "supercharge" ? "supercharge" : "xibecode";
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${runtimeLabel}-sandbox-${session.sandboxId}.tar.gz"`,
      );
      res.setHeader("X-Agent-Runtime", session.runtime);
      res.setHeader("X-XibeCode-Sandbox-Id", session.sandboxId);
      res.setHeader("X-XibeCode-Workspace-Root", session.workspaceRoot);
      res.end(exported.archive);
      return;
    }

    const recreateMatch = url.pathname.match(/^\/sessions\/([^/]+)\/recreate$/);
    if (method === "POST" && recreateMatch) {
      const sessionId = decodeURIComponent(recreateMatch[1] || "");
      const body = await readJson<{
        sandboxId?: string;
        runtime?: AgentRuntime | string;
      }>(req).catch(
        () => ({}) as { sandboxId?: string; runtime?: AgentRuntime | string },
      );
      let session = sessions.get(sessionId);
      if (!session && body.sandboxId) {
        session = await createSession({
          sessionId,
          sandboxId: body.sandboxId,
          strategy: "sandbox_full",
          runtime: body.runtime,
        });
      }
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      try {
        const result = await recreateSandboxInSession(session);
        sendJson(res, 200, { success: true, ...result });
      } catch (err) {
        sendJson(res, 500, {
          success: false,
          error: true,
          message: (err as Error).message || "Recreate failed",
          sessionId,
          sandboxId: session.sandboxId,
        });
      }
      return;
    }

    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (method === "DELETE" && sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1] || "");
      const session = sessions.get(sessionId);
      if (!session) {
        sendJson(res, 404, {
          success: false,
          error: true,
          message: `Session not found: ${sessionId}`,
        });
        return;
      }
      await closeSession(session);
      sendJson(res, 200, { success: true, sessionId });
      return;
    }

    sendJson(res, 404, {
      success: false,
      error: true,
      message: `Not found: ${method} ${url.pathname}`,
    });
  } catch (error: any) {
    sendJson(res, 500, {
      success: false,
      error: true,
      message: error?.message || "Internal server error",
    });
  }
});

const browserVncServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${port}`}`);
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/browser\/vnc$/);
    const sessionId = match ? decodeURIComponent(match[1] || "") : "";
    const ticket = url.searchParams.get("ticket") || "";
    const session = findSession(sessionId);
    const target = session ? consumeBrowserVncTicket(ticket, session.sessionId) : undefined;
    if (!session || session.runtime !== "supercharge" || !target) {
      socket.destroy();
      return;
    }
    browserVncServer.handleUpgrade(req, socket, head, (client) => {
      void relayBrowserVnc(client, {
        resolveDaemonBase: () => resolvePreviewHost(session, 8790),
        headers: daemonAuthorizationHeaders(),
        handoffId: target.handoffId,
        botId: target.botId,
        allowLegacyBearer: false,
        onError: (message) => console.warn(`[browser-vnc] ${message}`),
      });
    });
  } catch {
    socket.destroy();
  }
});

async function recoverLifecycleSessions(): Promise<void> {
  for (const record of await lifecycleStore.list()) {
    if (record.runtime !== "supercharge" || sessions.has(record.sessionId)) continue;
    try {
      const info = await Sandbox.getInfo(record.sandboxId);
      if (info.state === "paused" && record.phase === "running") continue;
      await createSession({ sessionId:record.sessionId, sandboxId:record.sandboxId,
        workspaceRoot:record.workspaceRoot, strategy:"sandbox_full", runtime:"supercharge" });
    } catch (error) {
      console.warn(`[vectra-gateway] lifecycle recovery ${record.sandboxId}: ${(error as Error).message}`);
    }
  }
}

void recoverLifecycleSessions().catch((error) => console.error("Lifecycle recovery unavailable", error));
setInterval(() => {
  void recoverLifecycleSessions().catch((error) => console.error("Lifecycle recovery unavailable", error));
}, 60_000).unref?.();

const activityChecks = new Set<string>();
setInterval(() => {
  for (const session of sessions.values()) {
    if (session.runtime !== "supercharge" || session.cycleResetting || activityChecks.has(session.sessionId)) continue;
    activityChecks.add(session.sessionId);
    void (async () => {
      // A health request can auto-resume a paused VM; inspect lifecycle without waking it first.
      const info = await Sandbox.getInfo(session.sandboxId);
      if (info.state !== "running") return;
      const response = await superchargeDaemonFetch(session, "/v1/status", {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok && runtimeHasWork(await response.json())) {
        await refreshSandboxTimeout(session);
      }
    })().catch((error) => {
      console.warn(`[vectra-gateway] activity check failed sandbox=${session.sandboxId}: ${(error as Error).message}`);
    }).finally(() => activityChecks.delete(session.sessionId));
  }
}, Math.min(30_000, Math.max(5_000, Math.floor(sandboxTimeoutMs / 3)))).unref?.();

// Proactive 23h continuous-run check even if traffic is sparse
if (maxContinuousMs > 0) {
  const tickMs = Math.min(
    5 * 60 * 1000,
    Math.max(30_000, Math.floor(maxContinuousMs / 48)),
  );
  setInterval(() => {
    for (const session of sessions.values()) {
      if (session.runtime !== "supercharge" || session.cycleResetting) continue;
      void (async () => {
        const info = await Sandbox.getInfo(session.sandboxId);
        const record = await lifecycleStore.read(session.sandboxId);
        if (record?.phase !== "running" || cycleRequired(info, maxContinuousMs, Date.now(), record?.runStartedAt)) {
          await resetContinuousRunCycle(session, "background-tick");
        }
      })().catch((err) => {
        console.error(
          `[xibecode-e2b-gateway] background cycle failed session=${session.sessionId}:`,
          (err as Error)?.message || err,
        );
      });
    }
  }, tickMs).unref?.();
}

server.listen(port, "0.0.0.0", () => {
  console.log(`[xibecode-e2b-gateway] listening on http://0.0.0.0:${port}`);
  console.log(
    `[xibecode-e2b-gateway] lifecycle onTimeout=${lifecycleOnTimeout} autoResume=${lifecycleAutoResume} inactivityMs=${sandboxTimeoutMs} maxContinuousMs=${maxContinuousMs}`,
  );
  if (lifecycleOnTimeout === "kill") {
    console.warn("[xibecode-e2b-gateway] E2B onTimeout=kill bypasses gateway pre-stop; use onTimeout=pause for Supercharge if preservation is required.");
  }
  if (!process.env.E2B_API_KEY) {
    console.warn("[xibecode-e2b-gateway] Warning: E2B_API_KEY is not set yet.");
  }
  if (!authToken) {
    console.warn(
      "[xibecode-e2b-gateway] Warning: XIBECODE_GATEWAY_TOKEN is empty; auth is disabled.",
    );
  }
});
