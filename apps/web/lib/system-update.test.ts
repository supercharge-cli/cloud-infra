import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSystemManifest, systemUpdateScript } from "./system-bundle";

const manifest = {
  version: "1.4.0",
  notes: ["Wake server keeps shared links after resume."],
  archive: "sandbox-system-1.4.0.tar.gz",
  paths: ["/opt/vectra/wake-http/"],
  commands: ["apt-get install -y agent-browser"],
};

test("manifest rejects user home and surprise shell", () => {
  assert.equal(parseSystemManifest(manifest)?.version, "1.4.0");
  assert.equal(
    parseSystemManifest({ ...manifest, paths: ["/home/user/workspace/"] }),
    null,
  );
  assert.equal(
    parseSystemManifest({ ...manifest, commands: ["rm -rf /; true"] }),
    null,
  );
});

test("desktop bundles require an opt-in marker, checksum and no install commands", () => {
  const desktop = {
    ...manifest,
    archive: "sandbox-desktop-1.4.0.tar.gz",
    commands: [],
    desktopProtocol: 1,
    requiresOptIn: true,
    sha256: "f".repeat(64),
  };
  assert.equal(parseSystemManifest(desktop)?.desktopProtocol, 1);
  assert.equal(parseSystemManifest({ ...desktop, requiresOptIn: false }), null);
  assert.equal(parseSystemManifest({ ...desktop, sha256: "invalid" }), null);
  assert.equal(parseSystemManifest({ ...desktop, commands: ["true"] }), null);
  assert.equal(parseSystemManifest({ ...manifest, desktopProtocol: 1 }), null);
  const script = systemUpdateScript(parseSystemManifest(desktop)!, "https://example.test");
  assert.match(script, /Missing desktop dependency/);
  assert.match(script, /legacy browser requires an explicit desktop migration/i);
  assert.match(script, /sha256sum -c/);
});

test("apply script stops services before unpack and does not stamp", () => {
  const script = systemUpdateScript(
    parseSystemManifest(manifest)!,
    "https://github.com/iotserver24/supercharge-releases/releases/latest/download",
  );
  const stopAt = script.indexOf("--- stop services ---");
  const unpackAt = script.indexOf("--- unpack ---");
  assert.ok(stopAt >= 0 && stopAt < unpackAt);
  assert.ok(script.indexOf('--- download ---') < stopAt);
  assert.ok(script.indexOf('--- check paths ---') < stopAt);
  assert.match(script, /\/tmp\/supercharge-browser\/pid/);
  assert.doesNotMatch(script, /kill -9/);
  assert.match(script, /refusing/);
  assert.match(script, /8788\/health/);
  assert.match(script, /startswith\('\/home\/user'\)/);
  assert.doesNotMatch(script, /system-stamp/);
});
