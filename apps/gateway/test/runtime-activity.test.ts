import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeHasWork } from "../src/runtime-activity";

test("active foreground turns keep the sandbox awake", () => {
  assert.equal(runtimeHasWork({ turn: { busy: true } }), true);
});

test("a preview keeps running without a foreground turn or connected phone", () => {
  assert.equal(runtimeHasWork({ turn: { busy: false }, backgroundTasks: [{ status: "running" }] }), true);
});

test("idle, failed, and unknown runtimes do not defeat automatic pause", () => {
  for (const status of [null, {}, { turn: { busy: false } }, { backgroundTasks: [{ status: "completed" }] }]) {
    assert.equal(runtimeHasWork(status), false);
  }
});
