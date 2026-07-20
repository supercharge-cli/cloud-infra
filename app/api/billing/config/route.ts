import { NextResponse } from 'next/server';
import { PLAN } from '@/lib/billing';
import { publicRazorpayKeyId } from '@/lib/razorpay';

/** Public pricing + whether checkout keys are configured. */
export async function GET() {
  const keyId = publicRazorpayKeyId();
  return NextResponse.json({
    plan: {
      id: PLAN.id,
      name: PLAN.name,
      priceUsd: PLAN.priceUsd,
      amountCents: PLAN.amountCents,
      currency: PLAN.currency,
      periodDays: PLAN.periodDays,
      label: PLAN.label,
    },
    razorpayConfigured: Boolean(keyId && process.env.RAZORPAY_KEY_SECRET),
    keyId: keyId || null,
  });
}
