/** Vectra Cloud pricing — values come from env (with safe defaults). */

export type BillingCurrency = 'INR' | 'USD';

export type Plan = {
  id: string;
  name: string;
  /** India — major units (rupees) */
  priceInr: number;
  /** INR paise (Razorpay smallest unit) */
  amountPaise: number;
  /** International — major units (dollars) */
  priceUsd: number;
  /** USD cents */
  amountCents: number;
  /** Access window after a successful payment */
  periodDays: number;
  label: string;
};

function envNumber(key: string, fallback: number): number {
  // Server: BILLING_*; optional NEXT_PUBLIC_* for client-visible marketing copy
  const raw = process.env[key]?.trim() || process.env[`NEXT_PUBLIC_${key}`]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function formatMoney(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Live plan from environment.
 *
 * | Env | Default | Notes |
 * | --- | --- | --- |
 * | `BILLING_PRICE_INR` | `399` | Rupees (major) |
 * | `BILLING_PRICE_USD` | `4.59` | Dollars (major) |
 * | `BILLING_PERIOD_DAYS` | `30` | Access length after pay |
 * | `BILLING_AMOUNT_PAISE` | `price×100` | Optional Razorpay override |
 * | `BILLING_AMOUNT_CENTS` | `price×100` | Optional Razorpay override |
 * | `BILLING_PLAN_ID` | `hosting-4c8g` | Plan id stored on orders |
 * | `BILLING_PLAN_NAME` | `Vectra Cloud instance` | Display name |
 */
export function getPlan(): Plan {
  const priceInr = envNumber('BILLING_PRICE_INR', 399);
  const priceUsd = envNumber('BILLING_PRICE_USD', 4.59);
  const periodDays = Math.max(1, Math.round(envNumber('BILLING_PERIOD_DAYS', 30)));

  const amountPaise = process.env.BILLING_AMOUNT_PAISE?.trim()
    ? Math.round(envNumber('BILLING_AMOUNT_PAISE', priceInr * 100))
    : Math.round(priceInr * 100);
  const amountCents = process.env.BILLING_AMOUNT_CENTS?.trim()
    ? Math.round(envNumber('BILLING_AMOUNT_CENTS', priceUsd * 100))
    : Math.round(priceUsd * 100);

  const id = process.env.BILLING_PLAN_ID?.trim() || 'hosting-4c8g';
  const name = process.env.BILLING_PLAN_NAME?.trim() || 'Vectra Cloud instance';
  const inrLabel = formatMoney(priceInr);
  const usdLabel = formatMoney(priceUsd);

  return {
    id,
    name,
    priceInr,
    amountPaise,
    priceUsd,
    amountCents,
    periodDays,
    label: `4 vCPU · 8 GB · ₹${inrLabel} / $${usdLabel} mo`,
  };
}

/** @deprecated Prefer getPlan() — alias for call sites that still import PLAN */
export const PLAN = {
  get id() {
    return getPlan().id;
  },
  get name() {
    return getPlan().name;
  },
  get priceInr() {
    return getPlan().priceInr;
  },
  get amountPaise() {
    return getPlan().amountPaise;
  },
  get priceUsd() {
    return getPlan().priceUsd;
  },
  get amountCents() {
    return getPlan().amountCents;
  },
  get periodDays() {
    return getPlan().periodDays;
  },
  get label() {
    return getPlan().label;
  },
} as Plan;

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
  priceLabel: string;
  buttonLabel: string;
} {
  const plan = getPlan();
  if (currency === 'USD') {
    const usd = formatMoney(plan.priceUsd);
    return {
      currency: 'USD',
      display: plan.priceUsd,
      amountMinor: plan.amountCents,
      priceLabel: `$${usd}/mo`,
      buttonLabel: `Pay $${usd}`,
    };
  }
  const inr = formatMoney(plan.priceInr);
  return {
    currency: 'INR',
    display: plan.priceInr,
    amountMinor: plan.amountPaise,
    priceLabel: `₹${inr}/mo`,
    buttonLabel: `Pay ₹${inr}`,
  };
}

export function addBillingPeriod(from: Date = new Date(), days?: number): string {
  const period = days ?? getPlan().periodDays;
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + period);
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
