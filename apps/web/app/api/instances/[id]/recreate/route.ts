import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getPlan, hasInstanceAccess } from '@/lib/billing';
import {
  recreateSandboxSession,
  restartDaemon,
  wakeSession,
} from '@/lib/gateway-client';
import { buildSandboxTelegramWebhookUrl } from '@/lib/sandbox-telegram';
import { syncTelegramWakeWebhook } from '@/lib/telegram-webhook';
import { getInstance, publicInstance, updateInstance } from '@/lib/store';

/** New sandbox + copy workspace/keys can take a few minutes */
export const maxDuration = 300;

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
  if (inst.status === 'destroyed') {
    return NextResponse.json({ error: 'Instance destroyed' }, { status: 410 });
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: 'Subscription expired',
        message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to move this workspace.`,
        code: 'PAYMENT_REQUIRED',
        paidUntil: inst.paidUntil || null,
      },
      { status: 402 },
    );
  }

  try {
    const wake = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: false,
    });
    const moved = await recreateSandboxSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
    });
    if (!moved.ok || !moved.sandboxId) {
      const msg = moved.message || 'Could not create the new sandbox';
      await updateInstance(user.id, inst.id, {
        status: 'error',
        lastError: msg.slice(0, 500),
      }).catch(() => undefined);
      return NextResponse.json(
        { ok: false, error: msg, logs: [...(wake.logs || []), ...moved.logs] },
        { status: 502 },
      );
    }

    const webhookUrl = inst.telegramBotToken
      ? buildSandboxTelegramWebhookUrl(moved.sandboxId)
      : inst.sandboxTelegramWebhookUrl;

    const next = await updateInstance(user.id, inst.id, {
      sandboxId: moved.sandboxId,
      status: 'running',
      lastError: undefined,
      sandboxTelegramWebhookUrl: webhookUrl || undefined,
    });

    const restart = await restartDaemon(inst.sessionId, moved.sandboxId);
    const tg = inst.telegramBotToken
      ? await syncTelegramWakeWebhook({
          botToken: inst.telegramBotToken,
          instanceId: inst.id,
          wakeSecret: inst.wakeSecret,
          sandboxState: 'running',
          mode: inst.telegramWebhookMode || 'sandbox',
          sandboxId: moved.sandboxId,
          sandboxWebhookUrl: webhookUrl,
          telegramWebhookSecret: inst.telegramWebhookSecret,
        })
      : null;

    return NextResponse.json({
      ok: true,
      oldSandboxId: moved.oldSandboxId,
      sandboxId: moved.sandboxId,
      template: moved.template,
      bytes: moved.bytes,
      logs: [
        wake.ok === false ? `wake: ${wake.message || 'not ok'}` : 'wake: ok',
        ...moved.logs,
        restart.ok ? 'daemon restarted on new sandbox' : `daemon restart: ${restart.logs.join(' ')}`,
        tg || undefined,
      ].filter(Boolean),
      instance: publicInstance(next || { ...inst, sandboxId: moved.sandboxId }),
    });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: msg,
    }).catch(() => undefined);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
