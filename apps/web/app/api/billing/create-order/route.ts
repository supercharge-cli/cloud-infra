import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getSessionUser } from '@/lib/auth';
import { normalizeCurrency, PLAN, priceForCurrency } from '@/lib/billing';
import { createRazorpayOrder, publicRazorpayKeyId } from '@/lib/razorpay';
import { getInstance, savePendingOrder } from '@/lib/store';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      purpose?: 'new_instance' | 'renew';
      name?: string;
      instanceId?: string;
      currency?: string;
    };
    const purpose = body.purpose === 'renew' ? 'renew' : 'new_instance';
    const currency = normalizeCurrency(body.currency);
    const price = priceForCurrency(currency);

    let instanceName = String(body.name || 'workspace').trim().slice(0, 64) || 'workspace';
    let instanceId: string | undefined;

    if (purpose === 'renew') {
      instanceId = String(body.instanceId || '').trim();
      if (!instanceId) {
        return NextResponse.json({ error: 'instanceId required for renew' }, { status: 400 });
      }
      const inst = await getInstance(user.id, instanceId);
      if (!inst) {
        return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
      }
      instanceName = inst.name;
    }

    const receipt = `vc_${purpose.slice(0, 4)}_${nanoid(8)}`;
    const order = await createRazorpayOrder({
      receipt,
      amountMinor: price.amountMinor,
      currency: price.currency,
      notes: {
        userId: user.id,
        email: user.email,
        purpose,
        instanceName,
        instanceId: instanceId || '',
        plan: PLAN.id,
        product: 'vectra-cloud',
        currency: price.currency,
        displayPrice: String(price.display),
      },
    });

    await savePendingOrder({
      id: nanoid(12),
      userId: user.id,
      email: user.email,
      purpose,
      instanceId,
      instanceName,
      razorpayOrderId: order.id,
      amountCents: order.amount,
      currency: order.currency,
      status: 'created',
      createdAt: new Date().toISOString(),
    });

    const keyId = publicRazorpayKeyId();
    if (!keyId) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_RAZORPAY_KEY_ID not set' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      purpose,
      instanceName,
      plan: {
        id: PLAN.id,
        priceInr: PLAN.priceInr,
        priceUsd: PLAN.priceUsd,
        periodDays: PLAN.periodDays,
        label: PLAN.label,
        priceLabel: price.priceLabel,
        buttonLabel: price.buttonLabel,
      },
    });
  } catch (e) {
    console.error('[billing/create-order]', e);
    return NextResponse.json(
      { error: (e as Error).message || 'Failed to create order' },
      { status: 500 },
    );
  }
}
