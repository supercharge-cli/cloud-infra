import { createHash } from 'node:crypto';
import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public/managed-mcp');
const capabilities = ['mcp', 'skills', 'commands', 'agents', 'hooks'];
const targets = ['supercharge-e2b', 'supercharge-desktop'];
const localIcon = /^\/managed-mcp\/icons\/[a-z][a-z0-9-]*\.(svg|png|webp)$/;
const pinnedIcon = /^https:\/\/raw\.githubusercontent\.com\/iotserver24\/supercharge-app\/[a-f0-9]{40}\/public(\/managed-mcp\/icons\/[a-z][a-z0-9-]*\.(?:svg|png|webp))$/;

function optionalList(entry, key, allowed) {
  if (entry[key] === undefined) return;
  const values = entry[key];
  if (!Array.isArray(values) || !values.length || values.length > allowed.length ||
      new Set(values).size !== values.length || values.some((value) => !allowed.includes(value))) {
    throw new Error(`Invalid catalog ${key}`);
  }
}

export function validateCatalogMetadata(entry, manifest) {
  for (const [key, limit] of [['publisher', 120], ['category', 80]]) {
    if (entry[key] !== undefined && (typeof entry[key] !== 'string' || !entry[key].trim() ||
        entry[key] !== entry[key].trim() || entry[key].length > limit || /\p{Cc}/u.test(entry[key]))) {
      throw new Error(`Invalid catalog ${key}`);
    }
  }
  if (entry.icon !== undefined && (typeof entry.icon !== 'string' ||
      (!localIcon.test(entry.icon) && !pinnedIcon.test(entry.icon)))) {
    throw new Error('Catalog icon must be a bundled or pinned first-party asset');
  }
  if (entry.auth !== undefined && !['none', 'oauth', 'secrets'].includes(entry.auth)) {
    throw new Error('Invalid catalog auth');
  }
  optionalList(entry, 'capabilities', capabilities);
  optionalList(entry, 'targets', targets);
  if (!manifest) return;
  const actual = [];
  if (Object.keys(manifest.mcpServers).length) actual.push('mcp');
  for (const [kind, capability] of [['skill', 'skills'], ['command', 'commands'], ['agent', 'agents']]) {
    if (manifest.components.some((component) => component.kind === kind)) actual.push(capability);
  }
  if (manifest.hooks.length) actual.push('hooks');
  if (entry.capabilities !== undefined && [...entry.capabilities].sort().join(',') !== actual.sort().join(',')) {
    throw new Error('Catalog capabilities and reviewed manifest differ');
  }
  // OAuth releases require a separate provider adapter; sensitive fields use write-only configuration.
  const auth = Object.values(manifest.userConfig).some((field) => field.sensitive) ? 'secrets' : 'none';
  if (entry.auth !== undefined && entry.auth !== auth) {
    throw new Error('Catalog auth is unsupported by the reviewed release');
  }
}

export async function validateCatalog(root = defaultRoot) {
  const catalog = JSON.parse(await readFile(join(root, 'catalog.json'), 'utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.plugins) || !catalog.plugins.length) {
    throw new Error('Managed MCP catalog must contain reviewed entries');
  }
  const ids = new Set();
  for (const entry of catalog.plugins) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Duplicate or invalid catalog ID');
    ids.add(entry.id);
    if (typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(entry.version) ||
        typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 200 ||
        typeof entry.description !== 'string' || !entry.description.trim() || entry.description.length > 4096) throw new Error('Invalid catalog metadata');
    validateCatalogMetadata(entry);
    if (entry.icon !== undefined) {
      const icon = pinnedIcon.exec(entry.icon)?.[1] ?? entry.icon;
      const info = await lstat(join(root, icon.slice('/managed-mcp/'.length)));
      if (!info.isFile() || info.size > 256 * 1024) throw new Error('Catalog icon must be a reviewed regular asset under 256 KiB');
    }
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
    const expectedFiles = entry.id === 'vectra-echo' ? 'mcp.mjs,plugin.json' : 'plugin.json';
    if (!['vectra-echo', 'vectra-github'].includes(entry.id) || files.join(',') !== expectedFiles ||
        (entry.id === 'vectra-echo' && !(await stat(join(release, 'mcp.mjs'))).isFile())) {
      throw new Error('Reviewed release has unexpected files');
    }
    const manifest = JSON.parse(await readFile(join(release, 'plugin.json'), 'utf8'));
    if (manifest.id !== entry.id || manifest.name !== entry.name || manifest.version !== entry.version || manifest.description !== entry.description || manifest.schemaVersion !== 1 || manifest.apiVersion !== '1' || manifest.components.length || manifest.hooks.length) {
      throw new Error('Catalog metadata and reviewed manifest differ');
    }
    if (entry.id === 'vectra-echo' && (manifest.permissions.join(',') !== 'mcp:stdio' || Object.keys(manifest.mcpServers).join(',') !== 'echo' || manifest.mcpServers.echo.command !== 'node' || manifest.mcpServers.echo.args.join(',') !== '${PLUGIN_ROOT}/mcp.mjs' || Object.keys(manifest.mcpServers.echo.env).length || Object.keys(manifest.userConfig).length)) {
      throw new Error('Echo release differs from its reviewed manifest');
    }
    if (entry.id === 'vectra-github' && (manifest.permissions.join(',') !== 'mcp:http' || Object.keys(manifest.mcpServers).join(',') !== 'github' || manifest.mcpServers.github.transport !== 'http' || manifest.mcpServers.github.url !== 'https://api.githubcopilot.com/mcp/' || Object.keys(manifest.mcpServers.github.headers).join(',') !== 'Authorization' || manifest.mcpServers.github.headers.Authorization !== 'Bearer ${config.github-token}' || Object.keys(manifest.userConfig).join(',') !== 'github-token' || manifest.userConfig['github-token'].required !== true || manifest.userConfig['github-token'].sensitive !== true)) {
      throw new Error('GitHub release differs from its reviewed manifest');
    }
    validateCatalogMetadata(entry, manifest);
    const paths = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n').sort();
    if (paths.join(',') !== expectedFiles) throw new Error('Catalog archive includes unreviewed files');
    for (const file of files) {
      if (!execFileSync('tar', ['-xOzf', path, file]).equals(await readFile(join(release, file)))) {
        throw new Error('Catalog archive differs from reviewed source');
      }
    }
  }
  return catalog.plugins.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Validated ${await validateCatalog()} curated Managed MCP release(s)`);
}
