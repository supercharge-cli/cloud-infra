import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, resolveCatalogEntry } from './catalog';

test('catalog lists pinned reviewed releases without credentials', () => {
  assert.ok(CATALOG.length > 0);
  for (const entry of CATALOG) {
    assert.match(entry.source.url, /^https:\/\/raw\.githubusercontent\.com\/iotserver24\/supercharge-app\/[a-f0-9]{40}\/public\/managed-mcp\//);
    assert.match(entry.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.releaseDigest, 'e1288de348eab757a0c5f0dd4580a371d02850470abfc0466af067b672f9081a');
    assert.deepEqual(entry.manifest.permissions, ['mcp:stdio']);
    assert.equal(entry.icon, '/managed-mcp/icons/vectra-echo.svg');
    assert.equal(entry.publisher, 'Vectra');
    assert.equal(entry.category, 'Developer tools');
    assert.equal(entry.auth, 'none');
    assert.deepEqual(entry.capabilities, ['mcp']);
    assert.deepEqual(entry.targets, ['supercharge-e2b', 'supercharge-desktop']);
    assert.equal(JSON.stringify(entry).includes('apiKey'), false);
    assert.equal(resolveCatalogEntry(entry.id, entry.source.sha256)?.id, entry.id);
    assert.equal(resolveCatalogEntry(entry.id, '0'.repeat(64)), null);
  }
  assert.equal(resolveCatalogEntry('unknown-plugin', '0'.repeat(64)), null);
});
