/** Vectra Cloud pricing — one sandbox seat. */

export const PLAN = {
  id: 'hosting-4c8g',
  name: 'Vectra Cloud instance',
  /** USD per month per instance */
  priceUsd: 4,
  /** Razorpay amount is in smallest currency unit (cents for USD) */
  amountCents: 400,
  currency: 'USD' as const,
  /** Access window after a successful payment */
  periodDays: 30,
  label: '4 vCPU · 8 GB · $4/mo',
} as const;

export type BillingStatus = 'active' | 'past_due' | 'none';

export function addBillingPeriod(from: Date = new Date(), days = PLAN.periodDays): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function isSubscriptionActive(paidUntil?: string | null): boolean {
  if (!paidUntil) return false;
  const t = Date.parse(paidUntil);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

export function billingStatusFromPaidUntil(paidUntil?: string | null): BillingStatus {
  if (!paidUntil) return 'none';
  return isSubscriptionActive(paidUntil) ? 'active' : 'past_due';
}
