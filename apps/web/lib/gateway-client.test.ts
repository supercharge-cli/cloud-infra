import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  getCliVersionInfo,
  restartDaemon,
  superchargeE2bInstallScript,
  updateCliInSandbox,
} from "./gateway-client";

async function installFixture(options: {
  incompatibleCli?: boolean;
  incompatibleDaemon?: boolean;
  downloadFailure?: boolean;
}) {
  const root = await mkdtemp(join(tmpdir(), "supercharge-update-test-"));
  const bin = join(root, "bin");
  const installed = join(root, "installed");
  const state = join(root, "state");
  const assets = join(root, "assets");
  await Promise.all([bin, installed, state, assets].map((path) => mkdir(path)));
  const script = async (path: string, text: string) => {
    await writeFile(path, `#!/bin/bash\n${text}\n`, { mode: 0o755 });
  };
  await script(join(installed, "supercharge"), "echo 'supercharge 1.3.8'");
  await writeFile(join(installed, "supercharge-superagent-server"), "old daemon");
  await writeFile(join(state, "e2b-version"), "1.3.8\n");
  await script(
    join(assets, "supercharge"),
    options.incompatibleCli
      ? "echo 'GLIBC_2.43 not found' >&2; exit 1"
      : "if [ \"$1\" = '--version' ]; then echo 'supercharge 1.3.16'; else exit 0; fi",
  );
  await writeFile(join(assets, "supercharge-superagent-server"), "new daemon");
  await script(join(bin, "sudo"), 'if [ "$1" = "-n" ]; then shift; fi; exec "$@"');
  await script(
    join(bin, "curl"),
    options.downloadFailure
      ? "exit 22"
      : `while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; dest="$1"; fi
  shift
done
cp "$ASSETS/$(basename "$dest")" "$dest"`,
  );
  await script(
    join(bin, "ldd"),
    options.incompatibleDaemon
      ? "echo 'libc.so.6: GLIBC_2.43 not found'; exit 0"
      : "echo 'libc.so.6 => /lib/libc.so.6'",
  );
  const shell = superchargeE2bInstallScript()
    .replaceAll("/usr/local/bin", installed)
    .replaceAll("/var/lib/superagent", state);
  const result = spawnSync("bash", ["-c", shell], {
    env: { ...process.env, PATH: `${bin}:${installed}:/usr/bin:/bin`, ASSETS: assets },
    encoding: "utf8",
  });
  return { root, installed, state, result };
}

for (const [name, options] of [
  ["incompatible CLI", { incompatibleCli: true }],
  ["incompatible daemon libraries", { incompatibleDaemon: true }],
  ["failed download", { downloadFailure: true }],
] as const) {
  test(`update preserves installed files after ${name}`, async () => {
    const fixture = await installFixture(options);
    try {
      assert.notEqual(fixture.result.status, 0);
      assert.doesNotMatch(fixture.result.stdout, /^UPDATE_DONE$/m);
      assert.equal(await readFile(join(fixture.installed, "supercharge-superagent-server"), "utf8"), "old daemon");
      assert.match(await readFile(join(fixture.installed, "supercharge"), "utf8"), /1\.3\.8/);
      assert.equal(await readFile(join(fixture.state, "e2b-version"), "utf8"), "1.3.8\n");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test("validated update records the executable version and succeeds", async () => {
  const fixture = await installFixture({});
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.match(fixture.result.stdout, /^UPDATE_DONE$/m);
    assert.equal(await readFile(join(fixture.state, "e2b-version"), "utf8"), "1.3.16\n");
    assert.equal(await readFile(join(fixture.installed, "supercharge-superagent-server"), "utf8"), "new daemon");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed update does not request a daemon restart even with a completion marker", async (t) => {
  const commands: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    commands.push(body.command);
    return Response.json({
      success: false,
      exitCode: 1,
      stdout: "--- pre version ---\nsupercharge 1.3.8\n--- post version ---\nsupercharge 1.3.16\nUPDATE_DONE\n",
      stderr: "GLIBC_2.43 not found",
    });
  });
  const result = await updateCliInSandbox("test-session", { runtime: "supercharge" });
  assert.equal(result.ok, false);
  assert.equal(result.verified, null);
  assert.equal(commands.length, 1);
  assert.doesNotMatch(commands[0], /nohup/);
});

test("restart requires inbox health and cannot succeed from a process or completion marker", async (t) => {
  let command = "";
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    command = JSON.parse(String(init?.body || "{}")).command;
    return Response.json({ success: true, exitCode: 0, stdout: "RESTART_DONE\n" });
  });
  const result = await restartDaemon("test-session", undefined, "supercharge");
  assert.equal(result.ok, false);
  const readiness = command.split("OK=0")[1].split('if [ "$OK"')[0];
  assert.match(readiness, /\/healthz/);
  assert.doesNotMatch(readiness, /pgrep/);
  assert.doesNotMatch(readiness, /kill -0[^\n]*OK=1/);
});

test("a broken CLI is not reported as installed from the old image version stamp", async (t) => {
  let execCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown) => {
    if (String(url).includes("/exec")) {
      execCalls += 1;
      return Response.json({ success: true, exitCode: 0, stdout: "GLIBC_2.43 not found\nVERSION_DONE\n" });
    }
    return Response.json({ version: "1.3.16" });
  });
  const result = await getCliVersionInfo("test-session", undefined, "supercharge");
  assert.equal(result.current, null);
  assert.equal(execCalls, 1);
});
