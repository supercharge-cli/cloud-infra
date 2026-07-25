import { after, NextResponse } from 'next/server';
import { wakeSession } from '@/lib/gateway-client';
import { getInstanceByWake, updateInstance } from '@/lib/store';
import {
  acquireWakeLock,
  isDuplicateUpdate,
  markFailNotified,
  markOkNotified,
  markUpdateProcessed,
  releaseWakeLock,
  shouldNotifyFail,
  shouldNotifyOk,
} from '@/lib/telegram-wake-guard';
import {
  deleteTelegramWebhook,
  sendTelegramMessage,
  syncTelegramWakeWebhook,
} from '@/lib/telegram-webhook';

type Ctx = { params: Promise<{ instanceId: string; secret: string }> };

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

type TelegramUpdate = {
  update_id?: number;
  message?: { text?: string; chat?: { id?: number }; from?: { id?: number } };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number } };
    from?: { id?: number };
  };
};

/**
 * Telegram calls this when the user DMs the bot *and* the host webhook is armed
 * (sandbox was paused). Flow:
 * 1) Ack Telegram immediately (200) so it does not redeliver / spam
 * 2) Gateway Sandbox.connect / auto-resume (E2B)
 * 3) Restart xibecode daemon (stale long-poll after memory freeze)
 * 4) Clear host webhook only if daemon is up (so long-poll owns Telegram)
 * 5) Tell the user to resend (this update was consumed by the wake webhook)
 *
 * If wake or daemon fails, re-arm the host webhook so the next DM can retry.
 * Failure messages are rate-limited (one every 3 min) to avoid chat spam.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { instanceId, secret } = await ctx.params;
  const inst = await getInstanceByWake(instanceId, secret);
  if (!inst) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let update: TelegramUpdate = {};
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    /* empty body ok for health pings */
  }

  const updateId = update.update_id;
  const text = update.message?.text?.trim() || update.callback_query?.data || '';
  const chatId =
    update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;

  // Empty probe (no update) — just confirm the endpoint is live
  if (updateId == null && !text && chatId == null) {
    return NextResponse.json({ ok: true, service: 'vectra-telegram-wake', instanceId });
  }

  // Telegram redelivery of an update we already accepted
  if (await isDuplicateUpdate(inst.id, updateId)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Mark update accepted ASAP so Telegram redelivery is treated as duplicate
  await markUpdateProcessed(inst.id, updateId);

  // Only one wake at a time per instance
  const gotLock = await acquireWakeLock(inst.id);
  if (!gotLock) {
    // Another delivery is already waking — ack so Telegram stops retrying
    return NextResponse.json({ ok: true, inFlight: true });
  }

  const work = async () => {
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

          if (chatId != null && (await shouldNotifyOk(inst.id))) {
            await sendTelegramMessage(
              inst.telegramBotToken,
              chatId,
              'Sandbox is awake — please send your message again (the first DM only woke the machine).',
            );
            await markOkNotified(inst.id);
            logs.push('notified user to resend (webhook consumed first update)');
          }
        } else {
          // Sandbox may be up but daemon dead, or wake failed — keep host webhook armed
          await rearm(result.ok ? 'daemon not ready' : 'wake failed');
          if (chatId != null && (await shouldNotifyFail(inst.id))) {
            await sendTelegramMessage(
              inst.telegramBotToken,
              chatId,
              'Could not fully wake the coding bot. Try again in a moment, or use Wake / resume on the dashboard.',
            );
            await markFailNotified(inst.id);
            logs.push('failure notified (rate-limited)');
          } else {
            logs.push('failure notify suppressed (cooldown)');
          }
        }
      }

      if (text) {
        logs.push(`telegram message received (${text.length} chars) — sandbox wake attempted`);
      }
      console.log('[telegram-wake]', inst.id, logs.join(' | ').slice(0, 2000));
    } catch (e) {
      console.error('[telegram-wake]', e);
      await updateInstance(inst.userId, inst.id, {
        status: 'error',
        lastError: (e as Error).message.slice(0, 500),
      }).catch(() => undefined);
      await rearm('exception');
      if (inst.telegramBotToken && chatId != null && (await shouldNotifyFail(inst.id))) {
        await sendTelegramMessage(
          inst.telegramBotToken,
          chatId,
          'Wake failed — try again shortly or use Wake / resume on the dashboard.',
        );
        await markFailNotified(inst.id);
      }
    } finally {
      await releaseWakeLock(inst.id).catch(() => undefined);
    }
  };

  // Ack Telegram immediately so it does not redeliver while resume runs (30–90s+).
  // next/server `after` keeps the work alive after the response on Vercel.
  after(work);

  return NextResponse.json({ ok: true, accepted: true });
}

/** Telegram sometimes probes with GET */
export async function GET(_req: Request, ctx: Ctx) {
  const { instanceId, secret } = await ctx.params;
  const inst = await getInstanceByWake(instanceId, secret);
  if (!inst) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, service: 'vectra-telegram-wake', instanceId });
}
