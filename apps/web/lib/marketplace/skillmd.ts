import { createHash } from 'node:crypto';

const API_BASE = 'https://api.skillmd.com';
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;

export type SkillMdItem = {
  id: string;
  pluginId: string;
  source: 'skillmd';
  itemType: 'skill' | 'plugin';
  owner: string;
  name: string;
  description?: string;
  category?: string;
  agents: string[];
  verified?: boolean;
  rawUrl?: string;
  bundleUrl?: string;
  sourceRepo?: string;
  license?: string;
  commitSha?: string;
  lastSyncedAt?: string;
  files?: Array<{ path: string; sizeBytes?: number; isScript?: boolean }>;
  sourceUrl: string;
  installable: boolean;
  installError?: 'SKILLMD_UNSUPPORTED_ARTIFACT';
};

type ApiItem = {
  slug?: unknown;
  type?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  agents?: unknown;
  verified?: unknown;
  raw_url?: unknown;
  bundle_url?: unknown;
  source_repo?: unknown;
  license?: unknown;
  commit_sha?: unknown;
  last_synced_at?: unknown;
  files?: unknown;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function itemFromApi(value: ApiItem): SkillMdItem | null {
  const slug = text(value.slug);
  const [owner, ...nameParts] = slug?.split('/') ?? [];
  const name = nameParts.join('/');
  if (!owner || !name || owner === '.' || owner === '..' || name === '.' || name === '..' || !/^[A-Za-z0-9_.-]{1,80}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,120}$/.test(name)) return null;
  const itemType = value.type === 'single' ? 'skill' : value.type === 'pack' ? 'plugin' : null;
  if (!itemType) return null;
  const rawUrl = text(value.raw_url);
  const bundleUrl = text(value.bundle_url);
  const artifact = (url: string | undefined, suffix: string) => url === `${API_BASE}/api/skills/${owner}/${name}/${suffix}`;
  const installable = artifact(bundleUrl, 'bundle');
  const files = Array.isArray(value.files) ? value.files.flatMap((file) => {
    if (!file || typeof file !== 'object') return [];
    const entry = file as { path?: unknown; size_bytes?: unknown; is_script?: unknown };
    const path = text(entry.path);
    return path ? [{ path, sizeBytes: typeof entry.size_bytes === 'number' ? entry.size_bytes : undefined, isScript: entry.is_script === 1 || entry.is_script === true }] : [];
  }) : undefined;
  return {
    id: `skillmd:${slug}`,
    pluginId: `skillmd-${createHash('sha256').update(`${owner}/${name}`).digest('hex').slice(0, 24)}`,
    source: 'skillmd',
    itemType,
    owner,
    name,
    description: text(value.description),
    category: text(value.category),
    agents: Array.isArray(value.agents) ? value.agents.filter((agent): agent is string => typeof agent === 'string') : text(value.agents)?.split(',').map((agent) => agent.trim()).filter(Boolean) ?? [],
    verified: typeof value.verified === 'boolean' ? value.verified : undefined,
    rawUrl: artifact(rawUrl, 'raw') ? rawUrl : undefined,
    bundleUrl: installable ? bundleUrl : undefined,
    sourceRepo: text(value.source_repo),
    license: text(value.license),
    commitSha: text(value.commit_sha),
    lastSyncedAt: text(value.last_synced_at),
    files,
    sourceUrl: `https://skillmd.com/skills/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    installable,
    ...(!installable ? { installError: 'SKILLMD_UNSUPPORTED_ARTIFACT' as const } : {}),
  };
}

async function getJson(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, { signal: controller.signal, headers: { accept: 'application/json' }, next: { revalidate: 120 } });
    if (!response.ok) throw new Error(`SKILLMD_SEARCH_FAILED: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_RESPONSE_BYTES) throw new Error('SKILLMD_INVALID_RESPONSE: response is too large');
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error('SKILLMD_INVALID_RESPONSE: response is too large');
    try { return JSON.parse(body); } catch { throw new Error('SKILLMD_INVALID_RESPONSE: invalid JSON'); }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SKILLMD_')) throw error;
    throw new Error('SKILLMD_SEARCH_FAILED: SkillMD is temporarily unavailable');
  } finally { clearTimeout(timer); }
}

export async function searchSkillMd(query: string): Promise<SkillMdItem[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const payload = await getJson(`/v1/search?q=${encodeURIComponent(normalized)}&limit=48`) as { items?: unknown };
  if (!Array.isArray(payload.items)) throw new Error('SKILLMD_INVALID_RESPONSE: search items are missing');
  return payload.items.map((item) => itemFromApi(item as ApiItem)).filter((item): item is SkillMdItem => !!item);
}

export async function listSkillMd(limit: number, offset: number): Promise<{ items: SkillMdItem[]; nextOffset: number | null }> {
  const payload = await getJson(`/v1/skills?limit=${limit}&offset=${offset}`) as { items?: unknown };
  if (!Array.isArray(payload.items)) throw new Error('SKILLMD_INVALID_RESPONSE: listing items are missing');
  const items = payload.items.map((item) => itemFromApi(item as ApiItem)).filter((item): item is SkillMdItem => !!item);
  const nextOffset = payload.items.length === limit && offset + limit <= 1000 ? offset + limit : null;
  return { items, nextOffset };
}

export async function getSkillMdItem(owner: string, name: string): Promise<SkillMdItem> {
  const payload = await getJson(`/v1/skills/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`) as ApiItem;
  const item = itemFromApi({ ...payload, slug: `${owner}/${name}` });
  if (!item) throw new Error('SKILLMD_ITEM_NOT_FOUND: SkillMD item is invalid or unavailable');
  return item;
}
