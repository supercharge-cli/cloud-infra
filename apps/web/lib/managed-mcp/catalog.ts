import catalog from '../../public/managed-mcp/catalog.json';
import echoManifest from '../../public/managed-mcp/echo-1.0.0/plugin.json';

export type CatalogAuth = 'none' | 'oauth' | 'secrets';
export type CatalogCapability = 'mcp' | 'skills' | 'commands' | 'agents' | 'hooks';
export type CatalogTarget = 'supercharge-e2b' | 'supercharge-desktop';

export type CatalogMetadata = {
  icon?: string;
  publisher?: string;
  category?: string;
  auth?: CatalogAuth;
  capabilities?: CatalogCapability[];
  targets?: CatalogTarget[];
};

export type CatalogEntry = CatalogMetadata & {
  releaseDigest: string;
  id: string;
  name: string;
  version: string;
  description: string;
  source: { type: 'archive'; url: string; sha256: string };
  manifest: {
    permissions: string[];
    mcpServers: Record<string, { transport: string; command?: string; url?: string }>;
    userConfig: Record<string, { required?: boolean; sensitive?: boolean }>;
  };
};

const reviewedManifests: Record<string, typeof echoManifest> = { [echoManifest.id]: echoManifest };
const reviewedReleaseDigests: Record<string, string> = {
  'vectra-echo@1.0.0': 'e1288de348eab757a0c5f0dd4580a371d02850470abfc0466af067b672f9081a',
};

export const CATALOG: readonly CatalogEntry[] = Object.freeze(catalog.plugins.map((entry) => {
  const manifest = reviewedManifests[entry.id];
  const releaseDigest = reviewedReleaseDigests[`${entry.id}@${entry.version}`];
  if (!manifest || !releaseDigest || manifest.version !== entry.version || manifest.name !== entry.name) {
    throw new Error('Unreviewed Managed MCP catalog entry');
  }
  // The build gate validates optional marketplace metadata against the reviewed release.
  return { ...entry, source: { ...entry.source, type: 'archive' }, manifest, releaseDigest } as CatalogEntry;
}));

export function resolveCatalogEntry(id: string, sha256: string): CatalogEntry | null {
  return CATALOG.find((entry) => entry.id === id && entry.source.sha256 === sha256) ?? null;
}
