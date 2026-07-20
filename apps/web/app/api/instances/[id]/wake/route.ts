import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getPlan, hasInstanceAccess } from '@/lib/billing';
import { wakeSession } from '@/lib/gateway-client';
import { getInstance, updateInstance } from '@/lib/store';
import { syncTelegramWakeWebhook } from '@/lib/telegram-webhook';

export const maxDuration = 120;

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

  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: 'Subscription expired',
        message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to resume this instance.`,
        code: 'PAYMENT_REQUIRED',
        paidUntil: inst.paidUntil || null,
      },
      { status: 402 },
    );
  }

  try {
    const result = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: true,
    });
    const logs = [...(result.logs || [])];

    // Running → clear host webhook so daemon long-poll owns Telegram.
    // Failed wake → keep/arm host webhook for next attempt.
    if (inst.telegramBotToken) {
      const tg = await syncTelegramWakeWebhook({
        botToken: inst.telegramBotToken,
        instanceId: inst.id,
        wakeSecret: inst.wakeSecret,
        sandboxState: result.ok ? 'running' : 'paused',
      });
      if (tg) logs.push(tg);
    }

    const next = await updateInstance(user.id, inst.id, {
      status: result.ok ? 'running' : 'error',
      lastError: result.ok ? undefined : (result.message || logs.join('\n')).slice(0, 500),
    });
    const { publicInstance } = await import('@/lib/store');
    return NextResponse.json(
      {
        ok: result.ok,
        state: result.state || (result.ok ? 'running' : undefined),
        resumed: result.resumed,
        logs,
        instance: next ? publicInstance(next) : null,
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
