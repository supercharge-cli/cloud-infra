import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { approvePairingCode, listPairings } from '@/lib/gateway-client';
import { getInstance } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  try {
    const pairing = await listPairings(inst.sessionId, inst.sandboxId);
    return NextResponse.json({ pairing });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  const body = (await req.json()) as { code?: string; platform?: string };
  try {
    const result = await approvePairingCode(
      inst.sessionId,
      String(body.code || ''),
      String(body.platform || 'telegram'),
      inst.sandboxId,
    );
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
