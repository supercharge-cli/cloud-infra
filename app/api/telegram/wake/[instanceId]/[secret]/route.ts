import { NextResponse } from 'next/server';
import { wakeSession } from '@/lib/gateway-client';
import { getInstanceByWake, updateInstance } from '@/lib/store';
import { setTelegramWebhook, wakeWebhookUrl } from '@/lib/telegram-webhook';

type Ctx = { params: Promise<{ instanceId: string; secret: string }> };

/**
 * Telegram calls this when the user DMs the bot.
 * 1) SDK activity via gateway → E2B auto-resume (paused sandbox)
 * 2) Restart daemon (stale long-poll after pause)
 * 3) Re-register webhook (daemon deletes webhooks so long-poll works while running;
 *    after pause we need host webhook again for the next wake)
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
  const logs: string[] = [];

  try {
    // Official auto-resume path: any gateway exec → commands.run → activity
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

    // Daemon deletes webhooks on start — put host webhook back so the *next*
    // pause cycle can still receive DMs for wake-up.
    if (inst.telegramBotToken) {
      const url = wakeWebhookUrl(inst.id, inst.wakeSecret || secret);
      if (url) {
        // Small delay so daemon's deleteWebhook finishes first
        await new Promise((r) => setTimeout(r, 2500));
        const wh = await setTelegramWebhook(inst.telegramBotToken, url);
        logs.push(`re-setWebhook ok=${wh.ok} ${wh.description || ''} url=${url}`);
      } else {
        logs.push(
          'PUBLIC_BASE_URL not set (or localhost) — cannot re-set Telegram webhook; set PUBLIC_BASE_URL to a public HTTPS URL',
        );
      }
    }

    if (text) {
      logs.push(`telegram message received (${text.length} chars) — sandbox woken`);
    }

    // Always 200 to Telegram so it does not retry aggressively
    return NextResponse.json({ ok: true, logs });
  } catch (e) {
    console.error('[telegram-wake]', e);
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
