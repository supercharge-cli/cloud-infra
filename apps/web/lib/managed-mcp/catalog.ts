import catalog from '../../public/managed-mcp/catalog.json';
import echoManifest from '../../public/managed-mcp/echo-1.0.0/plugin.json';

export type CatalogEntry = {
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

export const CATALOG: readonly CatalogEntry[] = Object.freeze(catalog.plugins.map((entry) => {
  const manifest = reviewedManifests[entry.id];
  if (!manifest || manifest.version !== entry.version || manifest.name !== entry.name) {
    throw new Error('Unreviewed Managed MCP catalog entry');
  }
  return { ...entry, source: { ...entry.source, type: 'archive' as const }, manifest };
}));

export function resolveCatalogEntry(id: string, sha256: string): CatalogEntry | null {
  return CATALOG.find((entry) => entry.id === id && entry.source.sha256 === sha256) ?? null;
}
