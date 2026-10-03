import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalog, validateCatalogMetadata } from '../../scripts/validate-managed-mcp-catalog.mjs';

const root = new URL('../../public/managed-mcp/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('echo-1.0.0/plugin.json', root), 'utf8'));
const entry = catalog.plugins[0];

test('optional metadata accepts legacy catalogs and truthful reviewed capabilities', () => {
  const legacy = { ...entry };
  for (const key of ['icon', 'publisher', 'category', 'auth', 'capabilities', 'targets']) delete legacy[key];
  assert.doesNotThrow(() => validateCatalogMetadata(legacy, manifest));
  assert.doesNotThrow(() => validateCatalogMetadata(entry, manifest));
  assert.doesNotThrow(() => validateCatalogMetadata({ auth: 'oauth' }));
  assert.doesNotThrow(() => validateCatalogMetadata({
    icon: `https://raw.githubusercontent.com/iotserver24/supercharge-app/${'a'.repeat(40)}/public/managed-mcp/icons/echo.png`,
  }));
});

test('metadata rejects malformed, unreviewed, or unsupported claims', () => {
  for (const patch of [
    { publisher: '' }, { publisher: 'x'.repeat(121) }, { publisher: 1 }, { publisher: ' Vectra' },
    { category: null }, { category: 'tools\nscript' }, { category: 'x'.repeat(81) },
    { icon: 'https://evil.example/logo.svg' }, { icon: '//evil.example/logo.svg' },
    { icon: '/managed-mcp/icons/../echo.svg' }, { icon: '/managed-mcp/icons/echo.svg?x=1' },
    { icon: 'javascript:alert(1)' }, { icon: '/managed-mcp/icons/%2e%2e.svg' },
    { icon: `https://raw.githubusercontent.com/iotserver24/supercharge-app/main/public/managed-mcp/icons/echo.svg` },
    { auth: 'apiKey' }, { auth: 'oauth' }, { auth: 'secrets' },
    { capabilities: ['mcp', 'skills'] }, { capabilities: ['mcp', 'mcp'] },
    { capabilities: ['ui'] }, { capabilities: 'mcp' }, { capabilities: [] },
    { targets: ['unknown'] }, { targets: [] }, { targets: ['supercharge-e2b', 'supercharge-e2b'] },
  ]) {
    assert.throws(() => validateCatalogMetadata({ ...entry, ...patch }, manifest), JSON.stringify(patch));
  }
});

test('capabilities and secret authentication reflect manifest content', () => {
  assert.doesNotThrow(() => validateCatalogMetadata({
    capabilities: ['mcp', 'skills', 'commands', 'agents', 'hooks'], auth: 'secrets',
  }, {
    ...manifest,
    components: [{ kind: 'skill' }, { kind: 'command' }, { kind: 'agent' }],
    hooks: [{}], userConfig: { token: { sensitive: true } },
  }));
});

test('both shipped catalogs and icons are identical and retain the immutable release', async () => {
  const desktop = new URL('../../../../../supercharge-app/public/managed-mcp/', root);
  assert.deepEqual(await readFile(new URL('catalog.json', root)), await readFile(new URL('catalog.json', desktop)));
  assert.deepEqual(await readFile(new URL('icons/vectra-echo.svg', root)), await readFile(new URL('icons/vectra-echo.svg', desktop)));
  assert.equal(entry.source.sha256, 'a0c6be6c2f292c1a1ecdcc55056147d1dd232b58c76522e77ad44016ee7c0072');
  assert.equal(entry.source.url, 'https://raw.githubusercontent.com/iotserver24/supercharge-app/379e0d2789ac918e327e5ef1fef5cc2991a431a7/public/managed-mcp/vectra-echo-1.0.0.tar.gz');
  assert.equal(await validateCatalog(), 1);
});

test('build gate rejects missing icons, bad digests and changed reviewed source', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'catalog-test-'));
  try {
    await cp(root, temporary, { recursive: true });
    const save = (patch) => writeFile(join(temporary, 'catalog.json'), JSON.stringify({
      ...catalog, plugins: [{ ...entry, ...patch }],
    }));
    await save({ icon: '/managed-mcp/icons/missing.svg' });
    await assert.rejects(validateCatalog(temporary), /ENOENT/);
    await save({ source: { ...entry.source, sha256: '0'.repeat(64) } });
    await assert.rejects(validateCatalog(temporary), /checksum mismatch/);
    await save({});
    await writeFile(join(temporary, 'echo-1.0.0/mcp.mjs'), '// changed source\n');
    await assert.rejects(validateCatalog(temporary), /differs from reviewed source/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
