import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chownSync, chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { pluginRuntimeAssets, pluginRuntimeCommand, pluginRuntimeProgram } from "../src/plugin-runtime-update.js";

const sha = (data: string) => createHash("sha256").update(data).digest("hex");

function fixture(t: { after: (fn: () => void) => void }) {
  const base = mkdtempSync(join(tmpdir(), "plugin-runtime-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, "node/bin"), { recursive: true });
  writeFileSync(join(base, "node/bin/node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  for (const name of ["plugin-api-server-0.1.0.mjs", "plugin-bridge-0.1.0.mjs"]) {
    writeFileSync(join(base, name), "// unchanged service\n");
    writeFileSync(join(base, `${name}.sha256`), `${sha("// unchanged service\n")}\n`);
  }
  const oldControl = "// old controller\n";
  const oldCatalog = JSON.stringify({ schemaVersion: 1, plugins: [{ id: "vectra-echo" }] });
  const control = "// https://api.githubcopilot.com\n";
  const catalog = JSON.stringify({ schemaVersion: 1, plugins: [{ id: "vectra-echo" }, { id: "vectra-github" }] });
  writeFileSync(join(base, "control.mjs"), oldControl);
  writeFileSync(join(base, "catalog.json"), oldCatalog);
  writeFileSync(join(base, "existing-plugin-data"), "kept");
  const assets = ["control.mjs", "catalog.json"].map((name) => {
    const data = name === "control.mjs" ? control : catalog;
    const source = join(base, `source-${name}`);
    writeFileSync(source, data);
    return { name, url: `file://${source}`, sha256: sha(data) };
  });
  const script = pluginRuntimeProgram
    .replace("BASE = pathlib.Path('/opt/vectra/plugin-api')", `BASE = pathlib.Path(${JSON.stringify(base)})`)
    .replace(`ASSETS = ${JSON.stringify(pluginRuntimeAssets)}`, `ASSETS = ${JSON.stringify(assets)}`)
    .replace("NODE = pathlib.Path('/usr/bin/node')", "NODE = BASE / 'node/bin/node'")
    .replace("BUNDLED_NODE_SHA = 'b1cbec894e45a5814b6ab756e1e14f8a76516273197e67e0412b57c1e10d0d9f'", `BUNDLED_NODE_SHA = '${sha("#!/bin/sh\nexit 0\n")}'`)
    .replaceAll("item.st_uid != 0 or item.st_gid != 0", "item.st_uid != os.getuid() or item.st_gid != os.getgid()")
    .replace("os.geteuid() != 0", "False");
  const run = (mode: string) => spawnSync("python3", ["-c", script, mode], { encoding: "utf8" });
  return { base, run, assets, oldControl, oldCatalog, control, catalog };
}

test("immutable pins match locally reviewed release objects and accept only fixed modes", () => {
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const root = execFileSync("git", ["show", "1cb58d9acba36391123381e04238857cff658f63:sandbox/e2b-agent-template/plugin-api-control.mjs"], { cwd });
  const catalog = execFileSync("git", ["-C", "cloud-infra", "show", "4722bd454cfc35d18a2e7c43059e2d8939d672a5:apps/web/public/managed-mcp/catalog.json"], { cwd });
  assert.equal(createHash("sha256").update(root).digest("hex"), pluginRuntimeAssets[0].sha256);
  assert.equal(createHash("sha256").update(catalog).digest("hex"), pluginRuntimeAssets[1].sha256);
  for (const asset of pluginRuntimeAssets) {
    assert.match(asset.url, /^https:\/\/raw\.githubusercontent\.com\/iotserver24\/supercharge-app\/893407e48f125a857ef36a894c74623a0af2a670\/public\/managed-mcp\/runtime-1\//);
  }
  assert.match(pluginRuntimeCommand("update"), /^python3 -c '/);
  assert.doesNotMatch(pluginRuntimeCommand("update"), /workspace|home\/user/);
});

test("stages assets, verifies, preserves unrelated plugin data and supports rollback", (t) => {
  const f = fixture(t);
  const initial = f.run("status");
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(JSON.parse(initial.stdout).ready, false);
  const result = f.run("update");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).updated, true);
  assert.equal(JSON.parse(f.run("status").stdout).ready, true);
  assert.equal(readFileSync(join(f.base, "existing-plugin-data"), "utf8"), "kept");
  assert.equal(f.run("confirm").status, 0);
  assert.equal(existsSync(join(f.base, ".runtime-update-backup/control.mjs")), true);
  assert.equal(f.run("rollback").status, 0);
  assert.equal(readFileSync(join(f.base, "control.mjs"), "utf8"), f.oldControl);
  assert.equal(readFileSync(join(f.base, "catalog.json"), "utf8"), f.oldCatalog);
});

test("fails closed on changed hash, missing download, symlink and failed post-replace health", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.base, "source-control.mjs"), "tampered");
  assert.notEqual(f.run("update").status, 0);
  assert.equal(readFileSync(join(f.base, "control.mjs"), "utf8"), f.oldControl);
  rmSync(join(f.base, "source-control.mjs"));
  assert.notEqual(f.run("update").status, 0);
  writeFileSync(join(f.base, "source-control.mjs"), f.control);
  rmSync(join(f.base, "control.mjs"));
  symlinkSync(join(f.base, "source-control.mjs"), join(f.base, "control.mjs"));
  assert.notEqual(f.run("update").status, 0);
  rmSync(join(f.base, "control.mjs"));
  writeFileSync(join(f.base, "control.mjs"), f.oldControl);
  chmodSync(join(f.base, "control.mjs"), 0o666);
  assert.notEqual(f.run("update").status, 0);
  chmodSync(join(f.base, "control.mjs"), 0o600);
  if (process.getuid?.() === 0) {
    chownSync(join(f.base, "control.mjs"), 1001, 1001);
    assert.notEqual(f.run("update").status, 0);
    chownSync(join(f.base, "control.mjs"), 0, 0);
  }
  writeFileSync(join(f.base, "node/bin/node"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  assert.notEqual(f.run("update").status, 0);
  assert.equal(readFileSync(join(f.base, "control.mjs"), "utf8"), f.oldControl);
  assert.equal(readFileSync(join(f.base, "catalog.json"), "utf8"), f.oldCatalog);
  assert.equal(readFileSync(join(f.base, "existing-plugin-data"), "utf8"), "kept");
});
