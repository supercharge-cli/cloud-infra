/** Vectra Cloud pricing — one sandbox seat. */

export type BillingCurrency = 'INR' | 'USD';

export const PLAN = {
  id: 'hosting-4c8g',
  name: 'Vectra Cloud instance',
  /** India — ₹399 / month */
  priceInr: 399,
  /** INR paise (Razorpay smallest unit) */
  amountPaise: 39900,
  /** International — $4.59 / month */
  priceUsd: 4.59,
  /** USD cents */
  amountCents: 459,
  /** Access window after a successful payment */
  periodDays: 30,
  label: '4 vCPU · 8 GB · ₹399 / $4.59 mo',
} as const;

export type BillingStatus = 'active' | 'past_due' | 'none';

export function normalizeCurrency(raw?: string | null): BillingCurrency {
  const c = String(raw || '').trim().toUpperCase();
  return c === 'USD' ? 'USD' : 'INR';
}

export function priceForCurrency(currency: BillingCurrency): {
  currency: BillingCurrency;
  /** Display amount in major units */
  display: number;
  /** Razorpay amount in smallest unit */
  amountMinor: number;
  symbolLabel: string;
  buttonLabel: string;
} {
  if (currency === 'USD') {
    return {
      currency: 'USD',
      display: PLAN.priceUsd,
      amountMinor: PLAN.amountCents,
      symbolLabel: `$${PLAN.priceUsd}/mo`,
      buttonLabel: `Pay $${PLAN.priceUsd}`,
    };
  }
  return {
    currency: 'INR',
    display: PLAN.priceInr,
    amountMinor: PLAN.amountPaise,
    priceLabel: `₹${PLAN.priceInr}/mo`,
    buttonLabel: `Pay ₹${PLAN.priceInr}`,
  };
}

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
