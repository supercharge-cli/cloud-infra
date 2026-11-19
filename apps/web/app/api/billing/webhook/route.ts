import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { fulfillPaidOrder } from '@/lib/billing-fulfill';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { subscriptionService } from '@/lib/subscription-runtime';

export const runtime = 'nodejs';
/** subscription.activated / charged may boot the paid workspace */
export const maxDuration = 300;

/**
 * Razorpay webhook — server-side payment verification.
 *
 * Dashboard → Settings → Webhooks:
 *   URL:  https://YOUR_DOMAIN/api/billing/webhook
 *   Secret: RAZORPAY_WEBHOOK_SECRET
 *   Events: payment.captured, order.paid (legacy one-off orders) and
 *           subscription.authenticated, activated, charged, pending, halted,
 *           cancelled, completed, paused, resumed, updated (autopay)
 *
 * Subscription events are idempotent by X-Razorpay-Event-Id (billing_events).
 * One-off orders stay idempotent through the order claim in fulfillPaidOrder.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    console.error('[billing/webhook] RAZORPAY_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.error('[billing/webhook] invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: RazorpayPaymentEntity };
      order?: { entity?: { id?: string } };
    };
  };

  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event || '';
  console.log(`[billing/webhook] ${eventType}`);

  if (eventType.startsWith('subscription.')) {
    const eventId =
      req.headers.get('x-razorpay-event-id')?.trim() ||
      `body_${createHash('sha256').update(rawBody).digest('hex')}`;
    try {
      const result = await subscriptionService().handleWebhookEvent(eventId, event as never);
      if (result.status === 'in_progress') {
        // Another delivery is mid-flight; non-2xx makes Razorpay retry later.
        return NextResponse.json({ status: 'in_progress' }, { status: 409 });
      }
      return NextResponse.json({ status: result.status, reason: result.reason, subscriptionId: result.subscriptionId });
    } catch (e) {
      console.error('[billing/webhook] subscription exception', (e as Error).message);
      return NextResponse.json({ error: 'Subscription update failed' }, { status: 500 });
    }
  }

  // Prefer payment.captured (has order_id + payment id)
  if (eventType === 'payment.captured' || eventType === 'payment.authorized') {
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment.order_id) {
      return NextResponse.json({ error: 'No payment entity' }, { status: 400 });
    }

    // Only capture successful / captured payments
    if (payment.status && !['captured', 'authorized'].includes(payment.status)) {
      return NextResponse.json({
        status: 'ignored',
        reason: `payment status ${payment.status}`,
      });
    }

    // Autopay charges carry an invoice and are handled by subscription.charged.
    if (payment.invoice_id || payment.subscription_id) {
      return NextResponse.json({ status: 'ignored', reason: 'subscription payment' });
    }

    // Ensure notes mark this as our product (optional guard)
    const notes = payment.notes || {};
    if (notes.product && notes.product !== 'vectra-cloud') {
      return NextResponse.json({ status: 'ignored', reason: 'not vectra-cloud' });
    }

    try {
      const result = await fulfillPaidOrder({
        razorpayOrderId: payment.order_id,
        paymentId: payment.id,
      });

      if (!result.ok) {
        console.error('[billing/webhook] fulfill failed', result.error);
        // 200 so Razorpay does not hammer retries on business errors like missing order
        // (e.g. payment for non-vectra). Still log.
        return NextResponse.json(
          { status: 'error', error: result.error },
          { status: result.status === 404 ? 200 : 500 },
        );
      }

      console.log(
        `[billing/webhook] ok purpose=${result.purpose} already=${Boolean(result.alreadyProcessed)} instance=${result.instance?.id || '—'}`,
      );
      return NextResponse.json({
        status: result.alreadyProcessed ? 'already_processed' : 'ok',
        purpose: result.purpose,
        instanceId: result.instance?.id,
        paidUntil: result.paidUntil,
      });
    } catch (e) {
      console.error('[billing/webhook] exception', e);
      return NextResponse.json(
        { error: (e as Error).message || 'Fulfill failed' },
        { status: 500 },
      );
    }
  }

  if (eventType === 'order.paid') {
    // Fallback: order paid but we need payment id from nested payload when present
    const orderId = event.payload?.order?.entity?.id;
    const payment = event.payload?.payment?.entity;
    if (payment?.invoice_id || payment?.subscription_id) {
      return NextResponse.json({ status: 'ignored', reason: 'subscription payment' });
    }
    if (orderId && payment?.id) {
      try {
        const result = await fulfillPaidOrder({
          razorpayOrderId: orderId,
          paymentId: payment.id,
        });
        if (!result.ok) {
          return NextResponse.json({ status: 'error', error: result.error });
        }
        return NextResponse.json({
          status: result.alreadyProcessed ? 'already_processed' : 'ok',
          purpose: result.purpose,
          instanceId: result.instance?.id,
        });
      } catch (e) {
        console.error('[billing/webhook] order.paid exception', e);
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
      }
    }
    return NextResponse.json({ status: 'ignored', reason: 'order.paid without payment id' });
  }

  return NextResponse.json({ status: 'ignored', event: eventType });
}

type RazorpayPaymentEntity = {
  id?: string;
  order_id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  invoice_id?: string | null;
  subscription_id?: string | null;
  notes?: Record<string, string>;
};

/** Health / Razorpay dashboard ping */
export async function GET() {
  const configured = Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim());
  return NextResponse.json({
    ok: true,
    service: 'vectra-billing-webhook',
    webhookSecretConfigured: configured,
  });
}
