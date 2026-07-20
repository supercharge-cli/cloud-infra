import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { destroyGatewaySession, getSandboxState } from '@/lib/gateway-client';
import {
  deleteInstance,
  getInstance,
  publicInstance,
  updateInstance,
} from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  let instance = await getInstance(user.id, id);
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  let liveState: string | undefined;
  let resumable = true;
  if (instance.sandboxId && instance.status !== 'destroyed') {
    try {
      const live = await getSandboxState(instance.sandboxId);
      liveState = live.state;
      resumable = live.resumable;
      if (live.state === 'paused' || live.state === 'running') {
        instance =
          (await updateInstance(user.id, id, {
            status: live.state,
            lastError: live.state === 'paused' ? undefined : instance.lastError,
          })) || instance;
      } else if (live.state === 'missing') {
        instance =
          (await updateInstance(user.id, id, {
            status: 'error',
            lastError: (live.message || 'Sandbox missing on the cloud provider').slice(0, 500),
          })) || instance;
      }
    } catch {
      liveState = 'unknown';
    }
  }

  return NextResponse.json({
    instance: {
      ...publicInstance(instance),
      liveState: liveState || instance.status,
      resumable,
    },
  });
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
  // Soft-delete so list stays clean; row kept for audit then removed
  await updateInstance(user.id, id, { status: 'destroyed' });
  await deleteInstance(user.id, inst.id);
  return NextResponse.json({ ok: true });
}
