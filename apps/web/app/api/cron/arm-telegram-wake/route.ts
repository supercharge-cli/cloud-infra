import { NextResponse } from 'next/server';
import { getSandboxState } from '@/lib/gateway-client';
import { getDb } from '@/lib/mongodb';
import type { Instance } from '@/lib/store';
import { syncTelegramWakeWebhook } from '@/lib/telegram-webhook';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Periodically arm host Telegram webhooks for paused sandboxes so the next DM
 * can auto-resume via gateway Sandbox.connect (E2B).
 *
 * Secure with CRON_SECRET (Authorization: Bearer … or ?secret=).
 * Schedule from Vercel Cron every few minutes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const q = new URL(req.url).searchParams.get('secret') || '';
  // Vercel Cron sends Authorization: Bearer $CRON_SECRET when CRON_SECRET is set.
  if (secret) {
    if (bearer !== secret && q !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.VERCEL === '1') {
    // Refuse open cron on Vercel — set CRON_SECRET in project env.
    return NextResponse.json(
      { error: 'Set CRON_SECRET to enable this cron' },
      { status: 503 },
    );
  }

  const db = await getDb();
  const rows = await db
    .collection<Instance>('instances')
    .find({
      status: { $in: ['running', 'paused', 'error'] },
      telegramBotToken: { $exists: true, $type: 'string' },
      sandboxId: { $exists: true, $type: 'string' },
    })
    .limit(100)
    .toArray();

  const results: Array<{ id: string; state: string; action: string | null }> = [];

  for (const inst of rows) {
    if (!inst.sandboxId || !inst.telegramBotToken) continue;
    let state: string = inst.status || 'unknown';
    try {
      const live = await getSandboxState(inst.sandboxId);
      state = live.state || state;
    } catch {
      /* keep mongo status */
    }

    if (state !== 'paused' && state !== 'running') {
      results.push({ id: inst.id, state, action: null });
      continue;
    }

    const action = await syncTelegramWakeWebhook({
      botToken: inst.telegramBotToken,
      instanceId: inst.id,
      wakeSecret: inst.wakeSecret,
      sandboxState: state,
    });
    results.push({ id: inst.id, state, action });
  }

  return NextResponse.json({
    ok: true,
    checked: results.length,
    results,
  });
}
