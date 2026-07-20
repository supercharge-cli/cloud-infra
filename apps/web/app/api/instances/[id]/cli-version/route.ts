import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getPlan, hasInstanceAccess } from '@/lib/billing';
import { getCliVersionInfo } from '@/lib/gateway-client';
import { getInstance } from '@/lib/store';

export const maxDuration = 120;

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
  if (inst.status === 'destroyed') {
    return NextResponse.json({ error: 'Instance destroyed' }, { status: 410 });
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: 'Subscription expired',
        message: `Renew to check CLI version (₹${plan.priceInr} / $${plan.priceUsd}).`,
        code: 'PAYMENT_REQUIRED',
      },
      { status: 402 },
    );
  }

  try {
    const info = await getCliVersionInfo(inst.sessionId, inst.sandboxId);
    return NextResponse.json({
      instanceId: inst.id,
      current: info.current,
      latest: info.latest,
      updateAvailable: info.updateAvailable,
      logs: info.logs,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
