import { NextResponse } from 'next/server';
import { getSandboxState } from '@/lib/gateway-client';
import { getDb } from '@/lib/mongodb';
import type { Instance, InstanceStatus } from '@/lib/store';
import { updateInstanceById } from '@/lib/store';
import { syncTelegramWakeWebhook } from '@/lib/telegram-webhook';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function mapE2bToStatus(state: string, prev: InstanceStatus): InstanceStatus {
  if (state === 'paused') return 'paused';
  if (state === 'running') return 'running';
  if (state === 'missing') return 'error';
  return prev;
}

/**
 * Periodically:
 * 1) Sync Mongo status from live E2B state (pause often happens without a user
 *    opening the dashboard).
 * 2) Arm host Telegram webhooks for paused sandboxes so the next DM can
 *    auto-resume via gateway Sandbox.connect.
 * 3) Clear host webhooks while running so the daemon long-poll owns Telegram.
 *
 * Prefer E2B lifecycle webhook (`/api/e2b/lifecycle`) for instant pause arming;
 * this cron is the safety net every few minutes.
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
      sandboxId: { $exists: true, $type: 'string' },
    })
    .limit(100)
    .toArray();

  const results: Array<{
    id: string;
    state: string;
    statusSynced?: string;
    action: string | null;
  }> = [];

  for (const inst of rows) {
    if (!inst.sandboxId) continue;
    let state: string = inst.status || 'unknown';
    try {
      const live = await getSandboxState(inst.sandboxId);
      state = live.state || state;

      const nextStatus = mapE2bToStatus(state, inst.status);
      if (nextStatus !== inst.status) {
        await updateInstanceById(inst.id, {
          status: nextStatus,
          lastError:
            state === 'missing'
              ? (live.message || 'Sandbox no longer exists').slice(0, 500)
              : nextStatus === 'paused'
                ? undefined
                : inst.lastError,
        });
      }
    } catch {
      /* keep mongo status */
    }

    if (state !== 'paused' && state !== 'running') {
      results.push({ id: inst.id, state, action: null });
      continue;
    }

    let action: string | null = null;
    if (inst.telegramBotToken) {
      action = await syncTelegramWakeWebhook({
        botToken: inst.telegramBotToken,
        instanceId: inst.id,
        wakeSecret: inst.wakeSecret,
        sandboxState: state,
      });
    } else {
      action = 'no telegram token';
    }
    results.push({
      id: inst.id,
      state,
      statusSynced: state !== inst.status ? state : undefined,
      action,
    });
  }

  return NextResponse.json({
    ok: true,
    checked: results.length,
    results,
  });
}
