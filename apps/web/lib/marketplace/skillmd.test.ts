import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { getSkillMdItem, searchSkillMd } from './skillmd';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('search keeps a bundle distinct from a single skill', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [
    { slug: 'acme/guide', type: 'single', title: 'Guide' },
    { slug: 'acme/pack', type: 'pack', title: 'Pack' },
    { slug: '../bad', type: 'single' },
  ] }));
  const items = await searchSkillMd('guide');
  assert.deepEqual(items.map((item) => item.itemType), ['skill', 'plugin']);
  assert.equal(items[1]?.installable, false);
  assert.equal(items[0]?.pluginId, `skillmd-${createHash('sha256').update('acme/guide').digest('hex').slice(0, 24)}`);
});

test('detail requires the canonical complete bundle URL before allowing install', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ slug: 'acme/guide', type: 'pack',
    bundle_url: 'https://api.skillmd.com/api/skills/acme/guide/bundle',
    raw_url: 'https://api.skillmd.com/api/skills/acme/guide/raw',
    files: [{ path: 'scripts/help.py', size_bytes: 10, is_script: 1 }],
  }));
  const item = await getSkillMdItem('acme', 'guide');
  assert.equal(item.installable, true);
  assert.deepEqual(item.files, [{ path: 'scripts/help.py', sizeBytes: 10, isScript: true }]);
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'pack', bundle_url: 'https://example.com/unsafe.zip' }));
  const unsupported = await getSkillMdItem('acme', 'guide');
  assert.equal(unsupported.installable, false);
});
