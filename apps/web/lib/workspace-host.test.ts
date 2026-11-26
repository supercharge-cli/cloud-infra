import assert from "node:assert/strict";
import { test } from "node:test";
// Loaded by URL so plain `node --test` (type stripping, no resolver) can run this file.
const { attachWorkspace, readSandboxState, writeSandboxState, deviceLabel } = (await import(
  new URL("./workspace-host.ts", import.meta.url).href
)) as typeof import("./workspace-host");
const { corsHeaders, isAppRoute } = (await import(new URL("./app-cors.ts", import.meta.url).href)) as typeof import("./app-cors");

const inst = { id: "inst-1", sessionId: "sess-1", sandboxId: "sbx-1", runtime: "supercharge", status: "paused" };

test("attach wakes first, then starts the host with a fresh session for this device", async () => {
  const calls: string[] = [];
  const result = await attachWorkspace(inst, { device: "pc; rm" }, {
    wake: async () => { calls.push("wake"); return { ok: true }; },
    startHost: async (_i, session, label) => { calls.push(`host:${label}:${session.length}`); return { url: "https://8790-sbx-1.e2b.app/" }; },
    markRunning: async () => { calls.push("running"); },
  });
  assert.deepEqual(calls, ["wake", "host:pcrm:43", "running"]);
  assert.equal(result.status, 200);
  assert.equal(result.body.url, "https://8790-sbx-1.e2b.app");
  assert.match(String(result.body.token), /^[A-Za-z0-9_-]{43}$/);
  const again = await attachWorkspace(inst, {}, { wake: async () => ({ ok: true }), startHost: async () => ({ url: "u" }), markRunning: async () => {} });
  assert.notEqual(again.body.token, result.body.token, "every attach mints its own session");
});

test("attach refuses old engines and does not start a host when wake fails", async () => {
  const never = async () => { throw new Error("must not start"); };
  const old = await attachWorkspace({ ...inst, runtime: "xibecode" }, {}, { wake: never, startHost: never, markRunning: never });
  assert.equal(old.status, 409);
  const asleep = await attachWorkspace(inst, {}, { wake: async () => ({ ok: false, message: "E2B said no" }), startHost: never, markRunning: never });
  assert.equal(asleep.status, 502);
  assert.equal(asleep.body.error, "E2B said no");
});

function fakeHost() {
  const seen: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetchHost = async (path: string, init?: RequestInit) => {
    seen.push({ path, method: init?.method || "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/v1/agents" && (init?.method || "GET") === "GET") return Response.json({ agents: [{ id: "main", name: "Chief" }] });
    if (path === "/v1/settings" && (init?.method || "GET") === "GET") return Response.json({ engine: "supercharge", previewPort: 3000 });
    return Response.json({ agent: { id: "x" }, previewPort: 5173 });
  };
  return { seen, fetchHost };
}

test("sandbox-state reads agents and settings together", async () => {
  const { fetchHost } = fakeHost();
  const result = await readSandboxState(fetchHost);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.agents, [{ id: "main", name: "Chief" }]);
  assert.equal((result.body.settings as { previewPort: number }).previewPort, 3000);
  const down = await readSandboxState(async () => new Response("{}", { status: 401 }));
  assert.equal(down.status, 409);
});

test("sandbox-state unwraps { agent } for the host and copies only known fields", async () => {
  const { seen, fetchHost } = fakeHost();
  const saved = await writeSandboxState(fetchHost, { agent: { id: "github", name: " GitHub ", engine: "supercharge", admin: true } });
  assert.equal(saved.status, 200);
  assert.deepEqual(seen.at(-1), { path: "/v1/agents", method: "PUT", body: { id: "github", name: "GitHub", instructions: "", engine: "supercharge" } });
  assert.equal((await writeSandboxState(fetchHost, { agent: { id: "x", name: "X", engine: "claude" } })).status, 400);
  assert.equal((await writeSandboxState(fetchHost, { agent: { id: "../x", name: "X" } })).status, 400);
  const settings = await writeSandboxState(fetchHost, { settings: { previewPort: 5173, workspaceRoot: "/" } });
  assert.equal(settings.status, 200);
  assert.deepEqual(seen.at(-1)?.body, { previewPort: 5173, desktopUrl: "" });
  assert.equal((await writeSandboxState(fetchHost, { settings: { previewPort: 0 } })).status, 400);
  assert.equal((await writeSandboxState(fetchHost, {})).status, 400);
  assert.equal(deviceLabel(42), "device");
});

test("CORS answers only listed origins on the app's routes, without credentials", () => {
  const prod = { NODE_ENV: "production", VECTRABOT_APP_ORIGINS: "https://app.example.com, javascript:alert(1)" };
  const ok = corsHeaders("/api/instances/abc/attach", "https://app.example.com", prod);
  assert.equal(ok?.["access-control-allow-origin"], "https://app.example.com");
  assert.equal(ok?.["access-control-allow-credentials"], undefined);
  assert.equal(corsHeaders("/api/instances/abc/attach", "https://evil.example.com", prod), null);
  assert.equal(corsHeaders("/api/billing/create-order", "https://app.example.com", prod), null);
  assert.equal(corsHeaders("/api/instances/abc/attach", "http://localhost:4173", prod), null, "dev origins are off in production");
  assert.ok(corsHeaders("/api/instances/abc/attach", "http://localhost:4173", { NODE_ENV: "development" }));
  assert.equal(corsHeaders("/api/instances/abc/attach", null, prod), null);
  assert.equal(isAppRoute("/api/instances/abc/computer/vnc-ticket"), true);
  assert.equal(isAppRoute("/api/instances/abc/exec"), false);
});
