import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HOST_DIR, HOST_MAX_SESSIONS, hostStartScript, loadHostBinary, validLabel, validSessionToken } from "../src/vectrabot-host";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** The real script, pointed at a temp dir and port so it can run on any machine. */
function localScript(dir: string, port: number): string {
  // Never let the test stop real processes on the machine running it.
  return "pkill() { :; }\n" + hostStartScript()
    .replaceAll(HOST_DIR, dir)
    .replaceAll("/home/user/workspace", join(dir, "workspace"))
    .replaceAll("/tmp/supercharge-daemon.pid", join(dir, "daemon.pid"))
    .replaceAll(":8790", `:${port}`)
    .replaceAll("0.0.0.0:8790", `127.0.0.1:${port}`);
}

function run(script: string, env: Record<string, string>) {
  return spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 30_000 });
}

test("the start script is valid shell and keeps secrets out of its text", () => {
  const script = hostStartScript();
  assert.equal(spawnSync("bash", ["-n"], { input: script }).status, 0);
  assert.doesNotMatch(script, /Bearer|[A-Za-z0-9_-]{40,}/);
  assert.match(script, /\$VECTRABOT_NEW_SESSION/);
  assert.match(script, /VECTRABOT_HOST_ADDR=0\.0\.0\.0:8790/);
  assert.doesNotMatch(script, /8788/, "the wake doorbell port stays untouched");
});

test("sessions rotate, the host starts once, and a healthy current host is reused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "workspace-host-"));
  const port = await freePort();
  mkdirSync(join(dir, "bin"), { recursive: true });
  // Stand-in host: answers /health like the real one and records its environment.
  const fake = join(dir, "bin", "sandbox-host");
  writeFileSync(fake, `#!/usr/bin/env bash
env | grep '^VECTRABOT_' | sed 's/=.*//' | sort > ${dir}/host-env-names
exec python3 -c 'import http.server,sys
class H(http.server.BaseHTTPRequestHandler):
  def do_GET(self):
    self.send_response(200); self.end_headers(); self.wfile.write(b"{\\"service\\":\\"sandbox-host\\"}")
  def log_message(self,*a): pass
http.server.HTTPServer(("127.0.0.1", ${port}), H).serve_forever()'
`);
  chmodSync(fake, 0o755);
  const script = localScript(dir, port).replaceAll(`${dir}/bin/sandbox-host`, fake);
  const env = (n: number) => ({ VECTRABOT_NEW_SESSION: `${"s".repeat(40)}${n}`, VECTRABOT_NEW_LABEL: `dev${n}`, VECTRABOT_CLOUD_TOKEN: "cloud-token-value", VECTRABOT_WANT_SHA: "abc" });
  try {
    const first = run(script, env(0));
    assert.match(first.stdout, /HOST_STARTED/, first.stdout + first.stderr);
    const second = run(script, env(1));
    assert.match(second.stdout, /HOST_REUSED/, second.stdout + second.stderr);
    for (let i = 2; i < HOST_MAX_SESSIONS + 3; i++) run(script, env(i));
    const lines = readFileSync(join(dir, "sessions"), "utf8").trim().split("\n");
    assert.equal(lines.length, HOST_MAX_SESSIONS);
    assert.equal(lines.at(-1), `${"s".repeat(40)}${HOST_MAX_SESSIONS + 2} dev${HOST_MAX_SESSIONS + 2}`);
    assert.equal(readFileSync(join(dir, "cloud-token"), "utf8"), "cloud-token-value");
    assert.equal((readFileSync(join(dir, "sessions")).length > 0), true);
    assert.deepEqual(readFileSync(join(dir, "host-env-names"), "utf8").trim().split("\n"), [
      "VECTRABOT_CLOUD_TOKEN", "VECTRABOT_HOST_ADDR", "VECTRABOT_PIDFILE", "VECTRABOT_SESSION_FILE", "VECTRABOT_WORKSPACE",
    ]);
    const upgraded = run(script, { ...env(99), VECTRABOT_WANT_SHA: "def" });
    assert.match(upgraded.stdout, /HOST_STARTED/, "a new binary digest restarts the host");
  } finally {
    const pid = readFileSync(join(dir, "host.pid"), "utf8").trim();
    try { process.kill(Number(pid)); } catch { /* already gone */ }
  }
});

test("only generated session tokens and safe labels are accepted", () => {
  assert.equal(validSessionToken("a".repeat(43)), true);
  assert.equal(validSessionToken("short"), false);
  assert.equal(validSessionToken("a".repeat(40) + "' ;rm"), false);
  assert.equal(validLabel("pc; rm -rf"), "pcrm-rf");
  assert.equal(validLabel(undefined), "device");
});

test("the binary must be a Linux executable and match a pinned digest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "workspace-bin-"));
  const elf = Buffer.concat([Buffer.from("\x7fELF", "latin1"), Buffer.alloc(2048, 1)]);
  writeFileSync(join(dir, "ok"), elf);
  writeFileSync(join(dir, "script"), "#!/bin/sh\n".padEnd(2048, "x"));
  const ok = await loadHostBinary({ VECTRABOT_HOST_BINARY: join(dir, "ok") });
  assert.equal(ok.sha256.length, 64);
  await assert.rejects(loadHostBinary({ VECTRABOT_HOST_BINARY: join(dir, "script") }), /Linux executable/);
  await assert.rejects(loadHostBinary({ VECTRABOT_HOST_BINARY: join(dir, "ok"), VECTRABOT_HOST_SHA256: "0".repeat(64) }), /does not match/);
  await assert.rejects(loadHostBinary({ VECTRABOT_HOST_URL: "https://example.invalid/host" }), /SHA256 is required/);
  const fetched = await loadHostBinary(
    { VECTRABOT_HOST_URL: "https://example.invalid/host2", VECTRABOT_HOST_SHA256: ok.sha256 },
    (async () => new Response(elf)) as typeof fetch,
  );
  assert.equal(fetched.sha256, ok.sha256);
  await assert.rejects(loadHostBinary({}), /not configured/);
});
