import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { fulfillPaidOrder } from '@/lib/billing-fulfill';
import { verifyPaymentSignature } from '@/lib/razorpay';

/**
 * Client-side checkout callback.
 * Webhook (/api/billing/webhook) is the server source of truth; both share fulfillPaidOrder.
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

    const result = await fulfillPaidOrder({
      razorpayOrderId: orderId,
      paymentId,
      expectUserId: user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      alreadyProcessed: result.alreadyProcessed,
      purpose: result.purpose,
      instance: result.instance,
      paidUntil: result.paidUntil,
      plan: result.plan,
    });
  } catch (e) {
    console.error('[billing/verify]', e);
    return NextResponse.json(
      { error: (e as Error).message || 'Payment verify failed' },
      { status: 500 },
    );
  }
}
