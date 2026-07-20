/**
 * Shared fulfillment after a Razorpay payment is confirmed
 * (client checkout signature OR server webhook).
 */
import { addBillingPeriod, PLAN } from './billing';
import { createGatewaySession } from './gateway-client';
import { getDb } from './mongodb';
import {
  createInstanceRecord,
  findPendingOrderByRazorpayId,
  getInstance,
  markOrderPaid,
  publicInstance,
  updateInstance,
  type Instance,
  type PendingOrder,
} from './store';

export type FulfillResult =
  | {
      ok: true;
      alreadyProcessed?: boolean;
      purpose: 'new_instance' | 'renew';
      instance: ReturnType<typeof publicInstance> | null;
      paidUntil?: string;
      plan: typeof PLAN;
    }
  | { ok: false; error: string; status: number };

/**
 * Idempotent: if order already paid and instance linked, return it.
 * Otherwise mark paid and create/renew instance.
 */
export async function fulfillPaidOrder(input: {
  razorpayOrderId: string;
  paymentId: string;
  /** When set, order must belong to this user (client verify). Webhook omits. */
  expectUserId?: string;
}): Promise<FulfillResult> {
  const pending = await findPendingOrderByRazorpayId(input.razorpayOrderId);
  if (!pending) {
    return { ok: false, error: 'Order not found', status: 404 };
  }
  if (input.expectUserId && pending.userId !== input.expectUserId) {
    return { ok: false, error: 'Order not found', status: 404 };
  }

  // Already fulfilled
  if (pending.status === 'paid') {
    if (pending.purpose === 'new_instance' && pending.instanceId) {
      const existing = await getInstance(pending.userId, pending.instanceId);
      if (existing) {
        return {
          ok: true,
          alreadyProcessed: true,
          purpose: 'new_instance',
          instance: publicInstance(existing),
          paidUntil: existing.paidUntil,
          plan: PLAN,
        };
      }
    }
    if (pending.purpose === 'renew' && pending.instanceId) {
      const existing = await getInstance(pending.userId, pending.instanceId);
      if (existing) {
        return {
          ok: true,
          alreadyProcessed: true,
          purpose: 'renew',
          instance: publicInstance(existing),
          paidUntil: existing.paidUntil,
          plan: PLAN,
        };
      }
    }
  }

  // Race-safe: mark paid only if still created (compare-and-set style)
  const claimed = await claimOrderPaid(input.razorpayOrderId, input.paymentId);
  if (!claimed.claimed) {
    // Another worker fulfilled first — re-read
    const again = await findPendingOrderByRazorpayId(input.razorpayOrderId);
    if (again?.status === 'paid' && again.instanceId) {
      const existing = await getInstance(again.userId, again.instanceId);
      return {
        ok: true,
        alreadyProcessed: true,
        purpose: again.purpose,
        instance: existing ? publicInstance(existing) : null,
        paidUntil: existing?.paidUntil,
        plan: PLAN,
      };
    }
    if (claimed.order?.status === 'paid' && claimed.order.purpose === 'renew' && claimed.order.instanceId) {
      const existing = await getInstance(claimed.order.userId, claimed.order.instanceId);
      return {
        ok: true,
        alreadyProcessed: true,
        purpose: 'renew',
        instance: existing ? publicInstance(existing) : null,
        paidUntil: existing?.paidUntil,
        plan: PLAN,
      };
    }
  }

  const order = claimed.order || pending;

  if (order.purpose === 'renew') {
    const inst = order.instanceId
      ? await getInstance(order.userId, order.instanceId)
      : null;
    if (!inst) {
      return { ok: false, error: 'Instance not found for renew', status: 404 };
    }
    const base =
      inst.paidUntil && Date.parse(inst.paidUntil) > Date.now()
        ? new Date(inst.paidUntil)
        : new Date();
    const paidUntil = addBillingPeriod(base);
    const updated = await updateInstance(order.userId, inst.id, {
      paidUntil,
      billingStatus: 'active',
      lastPaymentId: input.paymentId,
      lastOrderId: input.razorpayOrderId,
    });
    return {
      ok: true,
      purpose: 'renew',
      instance: updated ? publicInstance(updated) : publicInstance(inst),
      paidUntil,
      plan: PLAN,
    };
  }

  // new_instance
  const session = await createGatewaySession({ strategy: 'sandbox_full' });
  const paidUntil = addBillingPeriod();
  const instance = await createInstanceRecord({
    userId: order.userId,
    name: order.instanceName,
    sessionId: session.sessionId,
    sandboxId: session.sandboxId,
  });
  const withBilling = await updateInstance(order.userId, instance.id, {
    paidUntil,
    billingStatus: 'active',
    lastPaymentId: input.paymentId,
    lastOrderId: input.razorpayOrderId,
  });

  const db = await getDb();
  await db.collection('orders').updateOne(
    { razorpayOrderId: input.razorpayOrderId },
    { $set: { instanceId: instance.id, paymentId: input.paymentId } },
  );

  return {
    ok: true,
    purpose: 'new_instance',
    instance: publicInstance(withBilling || instance),
    paidUntil,
    plan: PLAN,
  };
}

/** Atomically mark order paid if still `created`. */
async function claimOrderPaid(
  razorpayOrderId: string,
  paymentId: string,
): Promise<{ claimed: boolean; order: PendingOrder | null }> {
  const db = await getDb();
  const paidAt = new Date().toISOString();
  const r = await db.collection('orders').findOneAndUpdate(
    { razorpayOrderId, status: 'created' },
    { $set: { status: 'paid', paymentId, paidAt } },
    { returnDocument: 'after' },
  );
  // mongodb driver may return document differently by version
  const doc = (r as { value?: PendingOrder } | PendingOrder | null) as
    | { value?: PendingOrder }
    | PendingOrder
    | null;
  const order =
    doc && typeof doc === 'object' && 'value' in doc
      ? doc.value || null
      : (doc as PendingOrder | null);

  if (order && order.status === 'paid') {
    return { claimed: true, order };
  }

  // Already paid or missing
  const existing = await findPendingOrderByRazorpayId(razorpayOrderId);
  return { claimed: false, order: existing };
}
