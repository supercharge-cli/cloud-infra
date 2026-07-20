import { NextResponse } from 'next/server';
import { PLAN, priceForCurrency } from '@/lib/billing';
import { publicRazorpayKeyId } from '@/lib/razorpay';

/** Public pricing + whether checkout keys are configured. */
export async function GET() {
  const keyId = publicRazorpayKeyId();
  const inr = priceForCurrency('INR');
  const usd = priceForCurrency('USD');
  return NextResponse.json({
    plan: {
      id: PLAN.id,
      name: PLAN.name,
      priceInr: PLAN.priceInr,
      priceUsd: PLAN.priceUsd,
      amountPaise: PLAN.amountPaise,
      amountCents: PLAN.amountCents,
      periodDays: PLAN.periodDays,
      label: PLAN.label,
      currencies: {
        INR: inr,
        USD: usd,
      },
    },
    razorpayConfigured: Boolean(keyId && process.env.RAZORPAY_KEY_SECRET),
    keyId: keyId || null,
  });
}
