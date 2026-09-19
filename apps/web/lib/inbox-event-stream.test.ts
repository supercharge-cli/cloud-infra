import assert from "node:assert/strict";
import { test } from "node:test";
import { inboxEventStream } from "./inbox-event-stream";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("SSE closes cleanly before its budget and cancels the idle upstream", async () => {
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"id":123,"type":"text","text":"hello"}\n\n'));
    },
    cancel() { cancelled = true; },
  });
  const reader = inboxEventStream(upstream, new AbortController().signal, 20).getReader();
  assert.match(decoder.decode((await reader.read()).value), /"type":"ready"/);
  assert.match(decoder.decode((await reader.read()).value), /"id":123/);
  assert.equal((await reader.read()).done, true);
  assert.equal(cancelled, true);
});

test("client disconnect cancels the upstream reader", async () => {
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const reader = inboxEventStream(upstream, new AbortController().signal, 60_000).getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(cancelled, true);
});

test("request abort ends an idle SSE connection", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const reader = inboxEventStream(upstream, controller.signal, 60_000).getReader();
  await reader.read();
  controller.abort();
  assert.equal((await reader.read()).done, true);
  assert.equal(cancelled, true);
});

test("an already-aborted request immediately releases the upstream", async () => {
  const controller = new AbortController();
  controller.abort();
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const reader = inboxEventStream(upstream, controller.signal, 60_000).getReader();
  assert.equal((await reader.read()).done, true);
  assert.equal(cancelled, true);
  assert.equal(upstream.locked, false);
});

test("upstream errors propagate without double-closing the response", async () => {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const upstream = new ReadableStream<Uint8Array>({ start(controller) { control = controller; } });
  const reader = inboxEventStream(upstream, new AbortController().signal, 60_000).getReader();
  await reader.read();
  control.error(new Error("upstream failed"));
  await assert.rejects(reader.read(), /upstream failed/);
});
