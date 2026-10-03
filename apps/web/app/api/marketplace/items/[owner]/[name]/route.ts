import { NextResponse } from 'next/server';
import { getSkillMdItem } from '@/lib/marketplace/skillmd';

type Context = { params: Promise<{ owner: string; name: string }> };

export async function GET(_request: Request, context: Context) {
  const { owner, name } = await context.params;
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,120}$/.test(name)) {
    return NextResponse.json({ error: 'SKILLMD_ITEM_NOT_FOUND: invalid SkillMD item identifier' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getSkillMdItem(owner, name), {
      headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=900' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SKILLMD_ITEM_NOT_FOUND: SkillMD item is unavailable';
    return NextResponse.json({ error: message }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}
