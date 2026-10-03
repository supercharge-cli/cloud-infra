import { NextResponse } from 'next/server';
import { searchSkillMd } from '@/lib/marketplace/skillmd';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ error: 'Search query must be between 2 and 100 characters.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ source: 'skillmd', items: await searchSkillMd(query) }, {
      headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SKILLMD_SEARCH_FAILED: SkillMD is unavailable';
    const status = message.startsWith('SKILLMD_ITEM_NOT_FOUND') ? 404 : 502;
    return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
