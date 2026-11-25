import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachDecision,
  hashSandboxSession,
  issueSandboxSession,
  sandboxSessionInstall,
} from "../src/sandbox-attach.ts";

test("session token is stored as a hash and stays out of the install command", () => {
  const issued = issueSandboxSession();
  assert.equal(hashSandboxSession(issued.token), issued.hash);
  assert.notEqual(issued.hash, issued.token);
  const install = sandboxSessionInstall();
  assert.equal(install.command.includes(issued.token), false);
  assert.match(install.command, /cat > \/home\/user\/\.vectrabot-session/);
});

test("attach is only for a loaded supercharge sandbox", () => {
  assert.equal(attachDecision({ runtime: "xibecode", token: "t", url: "https://h" }).status, 404);
  assert.equal(attachDecision({ runtime: "supercharge" }).status, 409);
  const ok = attachDecision({ runtime: "supercharge", token: "t", url: "https://host" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { url: "https://host", token: "t", port: 8788 });
});
