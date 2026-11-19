import { NextResponse } from 'next/server';
import { getPlan, listPlans, priceForCurrency } from '@/lib/billing';
import { publicRazorpayKeyId } from '@/lib/razorpay';
import { razorpayPlanIdFromEnv } from '@/lib/subscription-core';
import { subscriptionBillingConfig } from '@/lib/billing';

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
    subscriptions: {
      // Autopay is offered for a size once its Razorpay plan id is set.
      enabled: listPlans().some((p) => Boolean(razorpayPlanIdFromEnv(process.env, p.id, 'INR'))),
      graceDays: subscriptionBillingConfig().graceDays,
      retentionDays: subscriptionBillingConfig().retentionDays,
    },
    plans: listPlans().map((item) => ({
      id: item.id,
      name: item.name,
      cpu: item.cpu,
      memoryMb: item.memoryMb,
      priceInr: item.priceInr,
      priceUsd: item.priceUsd,
      periodDays: item.periodDays,
      label: item.label,
      autopay: Boolean(razorpayPlanIdFromEnv(process.env, item.id, 'INR')),
      autopayUsd: Boolean(razorpayPlanIdFromEnv(process.env, item.id, 'USD')),
    })),
  });
}
