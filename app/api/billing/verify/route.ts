import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { addBillingPeriod, billingStatusFromPaidUntil, PLAN } from '@/lib/billing';
import { createGatewaySession } from '@/lib/gateway-client';
import { verifyPaymentSignature } from '@/lib/razorpay';
import {
  createInstanceRecord,
  findPendingOrderByRazorpayId,
  getInstance,
  markOrderPaid,
  publicInstance,
  updateInstance,
} from '@/lib/store';

/**
 * After Razorpay Checkout succeeds:
 * - verify HMAC signature
 * - new_instance → provision E2B sandbox + Mongo row with paidUntil +30d
 * - renew → extend paidUntil by 30d from max(now, previous paidUntil)
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };
    const orderId = String(body.razorpay_order_id || '');
    const paymentId = String(body.razorpay_payment_id || '');
    const signature = String(body.razorpay_signature || '');

    if (!orderId || !paymentId || !signature) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
    }

    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    const pending = await findPendingOrderByRazorpayId(orderId);
    if (!pending || pending.userId !== user.id) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // Idempotent: already paid
    if (pending.status === 'paid' && pending.purpose === 'new_instance' && pending.instanceId) {
      const existing = await getInstance(user.id, pending.instanceId);
      if (existing) {
        return NextResponse.json({
          ok: true,
          alreadyProcessed: true,
          instance: publicInstance(existing),
        });
      }
    }

    await markOrderPaid(orderId, paymentId);

    if (pending.purpose === 'renew') {
      const inst = pending.instanceId
        ? await getInstance(user.id, pending.instanceId)
        : null;
      if (!inst) {
        return NextResponse.json({ error: 'Instance not found for renew' }, { status: 404 });
      }
      const base =
        inst.paidUntil && Date.parse(inst.paidUntil) > Date.now()
          ? new Date(inst.paidUntil)
          : new Date();
      const paidUntil = addBillingPeriod(base);
      const updated = await updateInstance(user.id, inst.id, {
        paidUntil,
        billingStatus: 'active',
        lastPaymentId: paymentId,
        lastOrderId: orderId,
      });
      return NextResponse.json({
        ok: true,
        purpose: 'renew',
        instance: updated ? publicInstance(updated) : null,
        paidUntil,
        plan: PLAN,
      });
    }

    // new_instance — provision after money is confirmed
    const session = await createGatewaySession({ strategy: 'sandbox_full' });
    const paidUntil = addBillingPeriod();
    const instance = await createInstanceRecord({
      userId: user.id,
      name: pending.instanceName,
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
    });
    const withBilling = await updateInstance(user.id, instance.id, {
      paidUntil,
      billingStatus: 'active',
      lastPaymentId: paymentId,
      lastOrderId: orderId,
    });

    // Link order → instance for idempotency
    const { getDb } = await import('@/lib/mongodb');
    const db = await getDb();
    await db.collection('orders').updateOne(
      { razorpayOrderId: orderId },
      { $set: { instanceId: instance.id } },
    );

    return NextResponse.json({
      ok: true,
      purpose: 'new_instance',
      instance: publicInstance(withBilling || instance),
      paidUntil,
      plan: PLAN,
    });
  } catch (e) {
    console.error('[billing/verify]', e);
    return NextResponse.json(
      { error: (e as Error).message || 'Payment verify failed' },
      { status: 500 },
    );
  }
}
