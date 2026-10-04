import { NextResponse } from 'next/server';
import { listSkillMd } from '@/lib/marketplace/skillmd';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get('limit') ?? 48);
  const offset = Number(params.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 48 || !Number.isInteger(offset) || offset < 0 || offset > 1000) {
    return NextResponse.json({ error: 'Invalid SkillMD page.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ source: 'skillmd', ...await listSkillMd(limit, offset) }, {
      headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SKILLMD_LIST_FAILED: SkillMD is unavailable';
    return NextResponse.json({ error: message }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
