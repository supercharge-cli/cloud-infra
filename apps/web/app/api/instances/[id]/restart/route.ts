import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { restartDaemon } from '@/lib/gateway-client';
import { getInstance, updateInstance } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
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
    const result = await restartDaemon(inst.sessionId, inst.sandboxId);
    const instance = await updateInstance(user.id, inst.id, {
      status: result.ok ? 'running' : 'error',
      lastError: result.ok ? undefined : result.logs.join('\n').slice(0, 500),
      aiConfigured: result.ok || inst.aiConfigured,
      telegramConfigured: result.ok || inst.telegramConfigured,
    });
    return NextResponse.json({ ok: result.ok, logs: result.logs, instance });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
