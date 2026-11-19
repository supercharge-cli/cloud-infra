import { NextResponse } from 'next/server';
import { subscriptionService } from '@/lib/subscription-runtime';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Billing lifecycle sweep (Vercel Cron, daily on Hobby).
 * - creates workspaces for paid subscriptions whose webhook never landed
 * - failed renewal: grace (BILLING_GRACE_DAYS), then pause the sandbox
 * - cancelled/completed: access to the end of the paid period, then pause
 * - suspended longer than BILLING_RETENTION_DAYS: set deletionFlaggedAt
 * It never deletes anything. Guarded by CRON_SECRET (Bearer or ?secret=).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const q = new URL(req.url).searchParams.get('secret') || '';
  if (!secret) {
    return NextResponse.json({ error: 'Set CRON_SECRET to enable this cron' }, { status: 503 });
  }
  if (bearer !== secret && q !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await subscriptionService().runLifecycle(100);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    console.error('[cron/billing-lifecycle]', (e as Error).message);
    return NextResponse.json({ error: 'Lifecycle sweep failed' }, { status: 500 });
  }
}
