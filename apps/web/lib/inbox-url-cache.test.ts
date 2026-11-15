import assert from 'node:assert/strict';
import { test } from 'node:test';
const { cachedInboxUrl, invalidateInboxUrl } = await import(new URL('./inbox-url-cache.ts', import.meta.url).href);

test('concurrent calls share a lookup and invalidation causes a fresh lookup', async () => {
  let calls = 0;
  const resolve = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return {url: 'https://inbox', cacheable: true}; };
  assert.deepEqual(await Promise.all([cachedInboxUrl('shared', resolve), cachedInboxUrl('shared', resolve)]), ['https://inbox', 'https://inbox']);
  await cachedInboxUrl('shared', resolve);
  assert.equal(calls, 1);
  invalidateInboxUrl('shared');
  await cachedInboxUrl('shared', resolve);
  assert.equal(calls, 2);
});

test('fallbacks and failed resolutions are not cached', async () => {
  let calls = 0;
  const fallback = async () => { calls++; return {url: 'fallback', cacheable: false}; };
  await cachedInboxUrl('fallback', fallback);
  await cachedInboxUrl('fallback', fallback);
  assert.equal(calls, 2);
  await assert.rejects(cachedInboxUrl('failure', async () => { throw new Error('offline'); }));
  assert.equal(await cachedInboxUrl('failure', fallback), 'fallback');
});
