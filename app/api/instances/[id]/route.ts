import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { destroyGatewaySession } from '@/lib/gateway-client';
import { deleteInstance, getInstance } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const instance = await getInstance(user.id, id);
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  return NextResponse.json({ instance });
}

export async function DELETE(_req: Request, ctx: Ctx) {
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
    await destroyGatewaySession(inst.sessionId);
  } catch (e) {
    console.warn('[vectra-cloud] destroy gateway session:', (e as Error).message);
  }
  await deleteInstance(user.id, inst.id);
  return NextResponse.json({ ok: true });
}
