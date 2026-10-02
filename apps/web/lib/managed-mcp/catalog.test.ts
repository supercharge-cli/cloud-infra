import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, resolveCatalogEntry } from './catalog';

test('catalog lists pinned reviewed releases without credentials', () => {
  assert.ok(CATALOG.length > 0);
  for (const entry of CATALOG) {
    assert.match(entry.source.url, /^https:\/\/raw\.githubusercontent\.com\/iotserver24\/supercharge-app\/[a-f0-9]{40}\/public\/managed-mcp\//);
    assert.match(entry.source.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(entry.manifest.permissions, ['mcp:stdio']);
    assert.equal(JSON.stringify(entry).includes('apiKey'), false);
    assert.equal(resolveCatalogEntry(entry.id, entry.source.sha256)?.id, entry.id);
    assert.equal(resolveCatalogEntry(entry.id, '0'.repeat(64)), null);
  }
  assert.equal(resolveCatalogEntry('unknown-plugin', '0'.repeat(64)), null);
});
