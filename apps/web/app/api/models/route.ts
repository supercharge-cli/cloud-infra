import { NextResponse } from 'next/server';
import { modelsForProvider } from '@/lib/provider-defaults';
import { fetchPollenCatalog } from '@/lib/pollinations-account';

export const dynamic = 'force-dynamic';

function uniq(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get('provider')?.trim().toLowerCase() || '';
  const curated = modelsForProvider(provider);
  let live: string[] = [];
  if (provider === 'pollinations') {
    try {
      live = (await fetchPollenCatalog())
        .filter((m) => m.category === 'text' || mIsTextish(m.name))
        .map((m) => m.name);
    } catch {
      /* curated only */
    }
  }
  const models = uniq([...live, ...curated]);
  return NextResponse.json({
    provider: provider || 'custom',
    models,
    source: live.length ? 'live' : 'curated',
  });
}

function mIsTextish(name: string): boolean {
  return !/embed|whisper|tts|image|audio|speech|transcri|video|3d/i.test(name);
}
