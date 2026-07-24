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
 * 3) Clear host webhook only if daemon is up (so long-poll owns Telegram)
 * 4) Tell the user to resend (this update was consumed by the wake webhook)
 *
 * If wake or daemon fails, re-arm the host webhook so the next DM can retry.
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

  const rearm = async (reason: string) => {
    if (!inst.telegramBotToken) return;
    const arm = await syncTelegramWakeWebhook({
      botToken: inst.telegramBotToken,
      instanceId: inst.id,
      wakeSecret: inst.wakeSecret || secret,
      sandboxState: 'paused',
    });
    logs.push(arm || `re-arm skipped (${reason})`);
  };

  try {
    // E2B: connect/SDK activity resumes paused sandbox (autoResume + connect fallback)
    const result = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: true,
    });
    logs.push(
      `wake ok=${result.ok} state=${result.state} resumed=${result.resumed} daemonOk=${result.daemonOk}`,
      ...result.logs,
    );

    const fullyUp = result.ok && result.daemonOk !== false;

    await updateInstance(inst.userId, inst.id, {
      status: fullyUp ? 'running' : result.ok ? 'running' : 'error',
      lastError: fullyUp
        ? undefined
        : (result.message || result.logs.join('\n') || 'wake incomplete').slice(0, 500),
    });

    if (inst.telegramBotToken) {
      if (fullyUp) {
        // Critical: do NOT re-arm host webhook while running — that steals getUpdates.
        const cleared = await deleteTelegramWebhook(inst.telegramBotToken);
        logs.push(
          cleared.ok
            ? 'host webhook cleared — daemon owns Telegram while running'
            : `deleteWebhook failed: ${cleared.description || 'unknown'}`,
        );

        // Give long-poll a moment after deleteWebhook before telling the user
        await new Promise((r) => setTimeout(r, 1500));

        if (chatId != null) {
          await sendTelegramMessage(
            inst.telegramBotToken,
            chatId,
            fullyUp
              ? 'Sandbox is awake — please send your message again (the first DM only woke the machine).'
              : 'Sandbox is waking but the bot may still be starting — try again in a few seconds.',
          );
          logs.push('notified user to resend (webhook consumed first update)');
        }
      } else {
        // Sandbox may be up but daemon dead, or wake failed — keep host webhook armed
        await rearm(result.ok ? 'daemon not ready' : 'wake failed');
        if (chatId != null) {
          await sendTelegramMessage(
            inst.telegramBotToken,
            chatId,
            'Could not fully wake the coding bot. Try again in a moment, or use Wake / resume on the dashboard.',
          );
        }
      }
    }

    if (text) {
      logs.push(`telegram message received (${text.length} chars) — sandbox wake attempted`);
    }

    // Always 200 to Telegram so it does not retry aggressively
    return NextResponse.json({ ok: fullyUp, logs });
  } catch (e) {
    console.error('[telegram-wake]', e);
    await updateInstance(inst.userId, inst.id, {
      status: 'error',
      lastError: (e as Error).message.slice(0, 500),
    }).catch(() => undefined);
    await rearm('exception');
    if (inst.telegramBotToken && chatId != null) {
      await sendTelegramMessage(
        inst.telegramBotToken,
        chatId,
        'Wake failed — try again shortly or use Wake / resume on the dashboard.',
      );
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
