import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import ts from "typescript";

function gatewayRestartCommand(runtime: "supercharge" | "xibecode") {
  const source = ts.createSourceFile(
    "index.ts",
    readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let command = "";
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "command") {
      const expression = node.initializer.getText(source);
      if (expression.includes("echo DAEMON_OK")) command = expression;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(command, "gateway wake script must be found");
  return new Function("session", "profile", "runtimeHome", "shQuote", `return (${command});`)(
    { runtime },
    { pidFile: "/nonexistent/test-daemon.pid", logFile: "/tmp/test-daemon.log", daemonCommand: "false", processMatch: "supercharge" },
    "/nonexistent",
    (value: string) => `'${value}'`,
  ) as string;
}

for (const runtime of ["supercharge", "xibecode"] as const) {
  test(`${runtime} gateway restart script remains valid shell`, () => {
    const result = spawnSync("bash", ["-n"], { input: gatewayRestartCommand(runtime), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
}

test("a matching process and live PID cannot make an unhealthy Supercharge inbox ready", () => {
  const command = gatewayRestartCommand("supercharge");
  const readiness = command.slice(command.indexOf("OK=0"), command.indexOf('curl -sS -m 2'));
  const result = spawnSync("bash", ["-c", [
    "sleep() { :; }",
    "curl() { return 22; }",
    "kill() { return 0; }",
    "pgrep() { printf '12345 supercharge agent daemon\\n'; }",
    readiness,
  ].join("\n")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DAEMON_FAIL$/m);
  assert.doesNotMatch(result.stdout, /^DAEMON_OK$/m);
});

test("Supercharge readiness accepts a healthz-only daemon", () => {
  const command = gatewayRestartCommand("supercharge");
  const readiness = command.slice(command.indexOf("OK=0"), command.indexOf('curl -sS -m 2'));
  const result = spawnSync("bash", ["-c", [
    "sleep() { :; }",
    'curl() { case "$*" in *healthz*) return 0 ;; *) return 22 ;; esac; }',
    "kill() { return 0; }",
    readiness,
  ].join("\n")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^DAEMON_OK$/m);
});
