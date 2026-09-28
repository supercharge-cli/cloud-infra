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

test("apply script stops services before unpack and does not stamp", () => {
  const script = systemUpdateScript(
    parseSystemManifest(manifest)!,
    "https://github.com/iotserver24/supercharge-releases/releases/latest/download",
  );
  const stopAt = script.indexOf("--- stop services ---");
  const unpackAt = script.indexOf("--- unpack ---");
  assert.ok(stopAt >= 0 && stopAt < unpackAt);
  assert.match(script, /refusing/);
  assert.match(script, /8788\/health/);
  assert.match(script, /startswith\('\/home\/user'\)/);
  assert.doesNotMatch(script, /system-stamp/);
});
