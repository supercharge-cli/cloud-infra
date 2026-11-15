import assert from 'node:assert/strict';
import { test } from 'node:test';
const { mergePendingMessages } = await import(new URL('./chat-message-merge.ts', import.meta.url).href);

test('polls keep a local message until a new matching direct message arrives', () => {
  const previous = [{ id: 'old', text: 'hello' }, { id: 'pending', text: 'hello', pending: true, baseline: 1 }];
  assert.deepEqual(mergePendingMessages([{ id: 'old', text: 'hello' }], previous, false), previous);
  const remote = [{ id: 'old', text: 'hello' }, { id: 'new', text: 'hello' }];
  assert.deepEqual(mergePendingMessages(remote, previous, false), remote);
});

test('group sends reconcile by request id', () => {
  const pending = [{ id: 'new', text: 'hi', pending: true }];
  assert.deepEqual(mergePendingMessages([], pending, true), pending);
  const remote = [{ id: 'new', text: 'hi' }];
  assert.deepEqual(mergePendingMessages(remote, pending, true), remote);
});
