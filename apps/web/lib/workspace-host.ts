/**
 * Workspace host: the process on a Supercharge sandbox's app port that the
 * phone and PC apps talk to directly. This module holds the attach flow and
 * the sandbox-state shape, with I/O injected so it can be tested alone.
 */
import { randomBytes } from "node:crypto";

export type AttachInstance = {
  id: string;
  sessionId: string;
  sandboxId?: string;
  runtime?: string;
  status?: string;
};

export type AttachDeps = {
  wake: (inst: AttachInstance) => Promise<{ ok: boolean; message?: string; state?: string }>;
  startHost: (inst: AttachInstance, session: string, label: string) => Promise<{ url: string }>;
  markRunning: (inst: AttachInstance) => Promise<void>;
  newSession?: () => string;
};

export type RouteResult = { status: number; body: Record<string, unknown> };

export function newHostSession(): string {
  return randomBytes(32).toString("base64url");
}

export function deviceLabel(value: unknown): string {
  return (typeof value === "string" ? value : "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 32) || "device";
}

/** Wake the sandbox, start the host with a new device session, and hand both back. */
export async function attachWorkspace(inst: AttachInstance, body: { device?: unknown }, deps: AttachDeps): Promise<RouteResult> {
  if ((inst.runtime || "xibecode") !== "supercharge") {
    return { status: 409, body: { error: "This workspace runs an older engine. Recreate it to use the app.", code: "RUNTIME_UNSUPPORTED" } };
  }
  const woke = await deps.wake(inst);
  if (!woke.ok) {
    return { status: 502, body: { error: woke.message || "The sandbox did not wake", state: woke.state || null } };
  }
  const session = (deps.newSession || newHostSession)();
  const host = await deps.startHost(inst, session, deviceLabel(body.device));
  await deps.markRunning(inst);
  return {
    status: 200,
    body: { url: host.url.replace(/\/$/, ""), token: session, sandboxId: inst.sandboxId || null, instanceId: inst.id, engine: "supercharge" },
  };
}

export type HostFetch = (path: string, init?: RequestInit) => Promise<Response>;

async function hostJson(fetchHost: HostFetch, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetchHost(path, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** GET: agents and settings in one object. */
export async function readSandboxState(fetchHost: HostFetch): Promise<RouteResult> {
  const [agents, settings] = await Promise.all([hostJson(fetchHost, "/v1/agents"), hostJson(fetchHost, "/v1/settings")]);
  if (!agents.ok || !settings.ok) {
    const failed = agents.ok ? settings : agents;
    return { status: failed.status === 401 || failed.status === 404 ? 409 : 502, body: { error: "Open the workspace on a device first so its host is running" } };
  }
  return { status: 200, body: { engine: "supercharge", agents: Array.isArray(agents.data.agents) ? agents.data.agents : [], settings: settings.data } };
}

const AGENT_ID = /^[a-z0-9-]{1,64}$/;

/**
 * PUT: `{ agent: {...} }` saves one agent, `{ settings: {...} }` saves settings.
 * Fields are copied explicitly so clients cannot smuggle unknown keys through.
 */
export async function writeSandboxState(fetchHost: HostFetch, body: unknown): Promise<RouteResult> {
  const input = (body && typeof body === "object" ? body : {}) as { agent?: unknown; settings?: unknown };
  const json = { "content-type": "application/json", accept: "application/json" };
  if (input.agent && typeof input.agent === "object") {
    const agent = input.agent as Record<string, unknown>;
    if (agent.engine != null && agent.engine !== "supercharge") {
      return { status: 400, body: { error: "only the supercharge engine is allowed" } };
    }
    const id = typeof agent.id === "string" ? agent.id : "";
    const name = typeof agent.name === "string" ? agent.name.trim() : "";
    if (!AGENT_ID.test(id) || !name || name.length > 80) {
      return { status: 400, body: { error: "agent id and name are required" } };
    }
    const instructions = typeof agent.instructions === "string" ? agent.instructions.slice(0, 20_000) : "";
    const saved = await hostJson(fetchHost, "/v1/agents", { method: "PUT", headers: json, body: JSON.stringify({ id, name, instructions, engine: "supercharge" }) });
    return { status: saved.ok ? 200 : saved.status === 400 ? 400 : 502, body: saved.ok ? { ok: true, ...saved.data } : { error: String(saved.data.error || "agent was not saved") } };
  }
  if (input.settings && typeof input.settings === "object") {
    const settings = input.settings as Record<string, unknown>;
    const previewPort = Number(settings.previewPort);
    if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
      return { status: 400, body: { error: "preview port is invalid" } };
    }
    const desktopUrl = typeof settings.desktopUrl === "string" ? settings.desktopUrl.slice(0, 500) : "";
    const saved = await hostJson(fetchHost, "/v1/settings", { method: "PUT", headers: json, body: JSON.stringify({ previewPort, desktopUrl }) });
    return { status: saved.ok ? 200 : saved.status === 400 ? 400 : 502, body: saved.ok ? { ok: true, settings: saved.data } : { error: String(saved.data.error || "settings were not saved") } };
  }
  return { status: 400, body: { error: "send { agent } or { settings }" } };
}
