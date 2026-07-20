import { NextResponse } from 'next/server';
import { wakeSession } from '@/lib/gateway-client';
import { getInstanceByWake, updateInstance } from '@/lib/store';
import {
  deleteTelegramWebhook,
  sendTelegramMessage,
  syncTelegramWakeWebhook,
} from '@/lib/telegram-webhook';

type Ctx = { params: Promise<{ instanceId: string; secret: string }> };

export const maxDuration = 120;

/**
 * Telegram calls this when the user DMs the bot *and* the host webhook is armed
 * (sandbox was paused). Flow:
 * 1) Gateway Sandbox.connect / auto-resume (E2B)
 * 2) Restart xibecode daemon (stale long-poll after memory freeze)
 * 3) Clear host webhook so daemon getUpdates works while running
 * 4) Tell the user to resend (this update was consumed by the webhook, not the daemon)
 */
export async function POST(req: Request, ctx: Ctx) {
  const { instanceId, secret } = await ctx.params;
  const inst = await getInstanceByWake(instanceId, secret);
  if (!inst) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let update: {
    message?: { text?: string; chat?: { id?: number }; from?: { id?: number } };
  } = {};
  try {
    update = (await req.json()) as typeof update;
  } catch {
    /* empty body ok for health pings */
  }

  const text = update.message?.text?.trim() || '';
  const chatId = update.message?.chat?.id;
  const logs: string[] = [];

  try {
    // E2B: connect/SDK activity resumes paused sandbox (autoResume + connect fallback)
    const result = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: true,
    });
    logs.push(
      `wake ok=${result.ok} state=${result.state} resumed=${result.resumed}`,
      ...result.logs,
    );

    await updateInstance(inst.userId, inst.id, {
      status: result.ok ? 'running' : 'error',
      lastError: result.ok ? undefined : (result.message || '').slice(0, 500),
    });

    if (inst.telegramBotToken) {
      // Critical: do NOT re-arm host webhook while running — that steals getUpdates.
      const cleared = await deleteTelegramWebhook(inst.telegramBotToken);
      logs.push(
        cleared.ok
          ? 'host webhook cleared — daemon owns Telegram while running'
          : `deleteWebhook failed: ${cleared.description || 'unknown'}`,
      );

      if (result.ok && chatId != null) {
        await sendTelegramMessage(
          inst.telegramBotToken,
          chatId,
          'Sandbox is waking up — please send your message again in a few seconds.',
        );
        logs.push('notified user to resend (webhook consumed first update)');
      }
    }

    if (text) {
      logs.push(`telegram message received (${text.length} chars) — sandbox woken`);
    }

    // Always 200 to Telegram so it does not retry aggressively
    return NextResponse.json({ ok: true, logs });
  } catch (e) {
    console.error('[telegram-wake]', e);
    // Still paused / failed — keep host webhook armed for the next attempt
    if (inst.telegramBotToken) {
      const arm = await syncTelegramWakeWebhook({
        botToken: inst.telegramBotToken,
        instanceId: inst.id,
        wakeSecret: inst.wakeSecret || secret,
        sandboxState: 'paused',
      });
      if (arm) logs.push(arm);
    }
    return NextResponse.json(
      { ok: false, error: (e as Error).message, logs },
      { status: 200 },
    );
  }
}

/** Telegram sometimes probes with GET */
export async function GET(_req: Request, ctx: Ctx) {
  const { instanceId, secret } = await ctx.params;
  const inst = await getInstanceByWake(instanceId, secret);
  if (!inst) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, service: 'vectra-telegram-wake', instanceId });
}
