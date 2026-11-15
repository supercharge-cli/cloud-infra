// Preview-host resolution makes multiple gateway calls. Share an in-flight
// lookup and briefly reuse confirmed hosts within each server process.
const ttlMs = 30_000;
const entries = new Map<string, { expires: number; promise: Promise<{ url: string; cacheable: boolean }> }>();

export async function cachedInboxUrl(key: string, resolve: () => Promise<{ url: string; cacheable: boolean }>): Promise<string> {
  const existing = entries.get(key);
  if (existing && existing.expires > Date.now()) return (await existing.promise).url;
  if (entries.size >= 500) entries.clear();
  const entry = { expires: Number.POSITIVE_INFINITY, promise: Promise.resolve({ url: '', cacheable: false }) };
  entry.promise = resolve().then((result) => {
    if (entries.get(key) === entry) {
      if (result.cacheable) entry.expires = Date.now() + ttlMs;
      else entries.delete(key);
    }
    return result;
  }).catch((error) => {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  });
  entries.set(key, entry);
  return (await entry.promise).url;
}

export function invalidateInboxUrl(key: string): void {
  entries.delete(key);
}
