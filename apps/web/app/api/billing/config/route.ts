import { NextResponse } from 'next/server';
import { getPlan, priceForCurrency } from '@/lib/billing';
import { publicRazorpayKeyId } from '@/lib/razorpay';

/** Public pricing + whether checkout keys are configured. */
export async function GET() {
  const keyId = publicRazorpayKeyId();
  const plan = getPlan();
  const inr = priceForCurrency('INR');
  const usd = priceForCurrency('USD');
  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      priceInr: plan.priceInr,
      priceUsd: plan.priceUsd,
      amountPaise: plan.amountPaise,
      amountCents: plan.amountCents,
      periodDays: plan.periodDays,
      label: plan.label,
      currencies: {
        INR: inr,
        USD: usd,
      },
    },
    razorpayConfigured: Boolean(keyId && process.env.RAZORPAY_KEY_SECRET),
    keyId: keyId || null,
    webhookConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET?.trim()),
    webhookPath: '/api/billing/webhook',
  });
}
