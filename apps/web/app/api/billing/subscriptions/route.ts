import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { subscriptionService, subscriptionsConfigured } from '@/lib/subscription-runtime';
import { respond, serverError } from '@/lib/subscription-http';

export const runtime = 'nodejs';

/** List the signed-in user's autopay subscriptions. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  try {
    const subscriptions = await subscriptionService().list(user.id);
    return NextResponse.json({ subscriptions, configured: subscriptionsConfigured() });
  } catch (e) {
    return serverError('list', e);
  }
}

/**
 * Start autopay for a sandbox size. Returns the Razorpay subscription id for
 * Checkout (`subscription_id`). purpose "attach" + instanceId moves an existing
 * workspace (free or one-off paid) onto autopay; otherwise a new workspace is
 * created once the first charge succeeds.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  try {
    const result = await subscriptionService().create(user, {
      planId: typeof body.planId === 'string' ? body.planId : undefined,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      purpose: typeof body.purpose === 'string' ? body.purpose : undefined,
      instanceId: typeof body.instanceId === 'string' ? body.instanceId : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
    });
    return respond(result);
  } catch (e) {
    return serverError('create', e);
  }
}
