import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../public/managed-mcp');
const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins) || !catalog.plugins.length) {
  throw new Error('Managed MCP catalog must contain reviewed entries');
}
const ids = new Set();
for (const entry of catalog.plugins) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Duplicate or invalid catalog ID');
  ids.add(entry.id);
  if (!/^\d+\.\d+\.\d+$/.test(entry.version) || !entry.name || entry.description.length > 4096) throw new Error('Invalid catalog metadata');
  const path = join(root, `${entry.id}-${entry.version}.tar.gz`);
  const url = new URL(entry.source.url);
  if (entry.source.type !== 'archive' || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(`/${entry.id}-${entry.version}.tar.gz`)) {
    throw new Error('Catalog must pin a first-party HTTPS archive');
  }
  if (url.origin !== 'https://raw.githubusercontent.com' ||
      !/^\/iotserver24\/supercharge-app\/[a-f0-9]{40}\/public\/managed-mcp\/[a-z][a-z0-9-]*-\d+\.\d+\.\d+\.tar\.gz$/.test(url.pathname) ||
      !/^[a-f0-9]{64}$/.test(entry.source.sha256)) throw new Error('Catalog source is not pinned');
  const bytes = await readFile(path);
  if (bytes.length > 16 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== entry.source.sha256) throw new Error('Catalog archive checksum mismatch');
  const release = join(root, `${entry.id.replace(/^vectra-/, '')}-${entry.version}`);
  const files = (await readdir(release)).sort();
  if (files.join(',') !== 'mcp.mjs,plugin.json' || !(await stat(join(release, 'mcp.mjs'))).isFile()) throw new Error('Reviewed release has unexpected files');
  const manifest = JSON.parse(await readFile(join(release, 'plugin.json'), 'utf8'));
  if (manifest.id !== entry.id || manifest.name !== entry.name || manifest.version !== entry.version || manifest.description !== entry.description || manifest.schemaVersion !== 1 || manifest.apiVersion !== '1' || manifest.permissions.join(',') !== 'mcp:stdio' || Object.keys(manifest.mcpServers).join(',') !== 'echo' || manifest.mcpServers.echo.command !== 'node' || manifest.mcpServers.echo.args.join(',') !== '${PLUGIN_ROOT}/mcp.mjs' || Object.keys(manifest.mcpServers.echo.env).length || manifest.components.length || manifest.hooks.length || Object.keys(manifest.userConfig).length) throw new Error('Catalog metadata and reviewed manifest differ');
  const paths = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n').sort();
  if (paths.join(',') !== 'mcp.mjs,plugin.json') throw new Error('Catalog archive includes unreviewed files');
}
console.log(`Validated ${catalog.plugins.length} curated Managed MCP release(s)`);
