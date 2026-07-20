import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { wakeSession } from '@/lib/gateway-client';
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
    const result = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: true,
    });
    await updateInstance(user.id, inst.id, {
      status: result.ok ? 'running' : 'error',
      lastError: result.ok ? undefined : (result.message || result.logs.join('\n')).slice(0, 500),
    });
    return NextResponse.json(
      {
        ok: result.ok,
        state: result.state,
        resumed: result.resumed,
        logs: result.logs,
        instance: await getInstance(user.id, inst.id),
      },
      { status: result.ok ? 200 : 502 },
    );
  } catch (e) {
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: (e as Error).message.slice(0, 500),
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
