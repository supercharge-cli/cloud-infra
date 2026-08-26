import { NextResponse } from 'next/server';
import {
  catalogModel,
  mergeCatalogModels,
  modelsForProviderDetailed,
  type CatalogModel,
} from '@/lib/provider-defaults';
import { fetchPollenCatalog } from '@/lib/pollinations-account';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get('provider')?.trim().toLowerCase() || '';
  const curated = modelsForProviderDetailed(provider);
  let live: CatalogModel[] = [];
  if (provider === 'pollinations') {
    try {
      live = (await fetchPollenCatalog())
        .filter((m) => m.category === 'text' || mIsTextish(m.name))
        .map((m) => catalogModel(m.name, m.title))
        .filter((m): m is CatalogModel => Boolean(m));
    } catch {
      /* curated only */
    }
  }
  const models = mergeCatalogModels(live, curated);
  return NextResponse.json({
    provider: provider || 'custom',
    models,
    source: live.length ? 'live' : 'curated',
  });
}

function mIsTextish(name: string): boolean {
  return !/embed|whisper|tts|image|audio|speech|transcri|video|3d/i.test(name);
}
