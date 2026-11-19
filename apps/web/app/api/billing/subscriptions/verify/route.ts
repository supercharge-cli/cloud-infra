import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { verifySubscriptionPaymentSignature } from '@/lib/razorpay';
import { subscriptionService } from '@/lib/subscription-runtime';
import { publicInstance, getInstance } from '@/lib/store';
import { respond, serverError } from '@/lib/subscription-http';

export const runtime = 'nodejs';
/** First payment may create the workspace (sandbox boot). */
export const maxDuration = 300;

/**
 * Checkout handler callback (subscription mode). The webhook stays the source
 * of truth; this just makes the dashboard update without waiting for it.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* validated below */
  }
  const subscriptionId = String(body.razorpay_subscription_id || '');
  const paymentId = String(body.razorpay_payment_id || '');
  const signature = String(body.razorpay_signature || '');
  if (!subscriptionId || !paymentId || !signature) {
    return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
  }
  try {
    if (!verifySubscriptionPaymentSignature({ subscriptionId, paymentId, signature })) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }
    const result = await subscriptionService().confirmCheckout(user.id, subscriptionId);
    if (!result.ok) return respond(result);
    const inst = result.instanceId ? await getInstance(user.id, result.instanceId) : null;
    return NextResponse.json({ ...result, instance: inst ? publicInstance(inst) : null });
  } catch (e) {
    return serverError('verify', e);
  }
}
