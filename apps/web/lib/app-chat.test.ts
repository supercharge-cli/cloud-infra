import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function inboxFunctions(dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL("./app-chat.ts", import.meta.url), "utf8");
  const fragment = source.slice(source.indexOf("const HEALTH_TTL_MS"));
  const { outputText } = ts.transpileModule(fragment.replaceAll("export async function", "async function"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  return new Function(...Object.keys(dependencies), `${outputText}\nreturn { ensureInbox, proxyInbox };`)(...Object.values(dependencies)) as {
    ensureInbox: (instance: Record<string, string>) => Promise<void>;
    proxyInbox: (instance: Record<string, string>, path: string) => Promise<Response>;
  };
}

const instance = { id: "test-instance", sandboxId: "test-sandbox", sessionId: "test-session", runtime: "supercharge" };

test("a healthz-only inbox handles consecutive checks without bootstrap or restart", async () => {
  const paths: string[] = [];
  const { ensureInbox } = inboxFunctions({
    appInboxFetch: async (_session: string, path: string) => {
      paths.push(path);
      return new Response(null, { status: path === "/healthz" ? 200 : 404 });
    },
    bootstrapAppInbox: () => { throw new Error("healthy daemon must not be bootstrapped"); },
    wakeSession: () => { throw new Error("healthy daemon must not be restarted"); },
  });
  await ensureInbox(instance);
  await ensureInbox(instance);
  assert.deepEqual(paths, ["/health", "/healthz"]);
});

test("a failed inbox request invalidates cached health without retrying the request", async () => {
  const paths: string[] = [];
  const { proxyInbox } = inboxFunctions({
    appInboxFetch: async (_session: string, path: string) => {
      paths.push(path);
      return new Response(null, { status: path === '/health' ? 200 : 502 });
    },
    bootstrapAppInbox: () => { throw new Error('unexpected bootstrap'); },
    wakeSession: () => { throw new Error('unexpected wake'); },
  });
  await proxyInbox(instance, '/message');
  await proxyInbox(instance, '/message');
  assert.deepEqual(paths, ['/health', '/message', '/health', '/message']);
});

test("resume reuses a healthy frozen daemon without restarting its work", async () => {
  let resumed = false;
  const { ensureInbox } = inboxFunctions({
    appInboxFetch: async () => new Response(null, { status: resumed ? 200 : 502 }),
    bootstrapAppInbox: () => { throw new Error("resumed daemon must not be bootstrapped"); },
    wakeSession: async (_session: string, options: { restartDaemon: boolean }) => {
      assert.equal(options.restartDaemon, false);
      resumed = true;
      return { ok: true };
    },
  });
  await ensureInbox(instance);
});

test("failed daemon startup is surfaced immediately instead of another health retry loop", async () => {
  let checks = 0;
  let bootstraps = 0;
  const { ensureInbox } = inboxFunctions({
    appInboxFetch: async () => { checks += 1; return new Response(null, { status: 502 }); },
    bootstrapAppInbox: async () => { bootstraps += 1; },
    wakeSession: async () => ({ ok: true, state: "running", daemonOk: false, logs: [] }),
    console: { error() {} },
  });
  await assert.rejects(ensureInbox(instance), /daemon failed to start/);
  assert.equal(checks, 4);
  assert.equal(bootstraps, 1);
});
