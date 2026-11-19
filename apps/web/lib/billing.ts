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

/** ₹95 = $1, then USD is 8% above that conversion. */
const INR_PER_USD = 95;
const USD_OVER_INR = 1.08;

export function usdFromInr(priceInr: number): number {
  return Math.round((priceInr / INR_PER_USD) * USD_OVER_INR * 100) / 100;
}

type Size = { id: string; cpu: number; memoryMb: number; priceInr: number; name: string };

const SIZES: Size[] = [
  { id: 'hosting-2c4g', cpu: 2, memoryMb: 4096, priceInr: 199, name: '2 vCPU · 4 GB' },
  { id: 'hosting-4c8g', cpu: 4, memoryMb: 8192, priceInr: 399, name: '4 vCPU · 8 GB' },
  { id: 'hosting-8c8g', cpu: 8, memoryMb: 8192, priceInr: 599, name: '8 vCPU · 8 GB' },
  { id: 'hosting-16c16g', cpu: 16, memoryMb: 16384, priceInr: 1199, name: '16 vCPU · 16 GB' },
];

function toPlan(size: Size, periodDays: number): Plan & { cpu: number; memoryMb: number } {
  const priceUsd = usdFromInr(size.priceInr);
  return {
    id: size.id,
    name: size.name,
    cpu: size.cpu,
    memoryMb: size.memoryMb,
    priceInr: size.priceInr,
    amountPaise: Math.round(size.priceInr * 100),
    priceUsd,
    amountCents: Math.round(priceUsd * 100),
    periodDays,
    label: `${size.name} · ₹${formatMoney(size.priceInr)} / $${formatMoney(priceUsd)} mo`,
  };
}

export type HostingPlan = ReturnType<typeof toPlan>;

function periodDays(): number {
  return Math.max(1, Math.round(envNumber('BILLING_PERIOD_DAYS', 30)));
}

export function listPlans(): HostingPlan[] {
  const days = periodDays();
  return SIZES.map((size) => toPlan(size, days));
}

export function planById(id?: string | null): HostingPlan {
  return listPlans().find((plan) => plan.id === id) || listPlans()[1];
}

/** Default sold size: 4 vCPU · 8 GB. USD is derived from INR. */
export function getPlan(): Plan {
  return planById('hosting-4c8g');
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

/**
 * How many free instances each user may hold at once (non-destroyed).
 * Override with FREE_INSTANCE_LIMIT env (0 disables free tier).
 */
export function freeInstanceLimit(): number {
  const raw = process.env.FREE_INSTANCE_LIMIT?.trim();
  if (raw === '0' || raw === 'off' || raw === 'false') return 0;
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

/** Access is granted for free-tier instances or while paidUntil is in the future. */
export function hasInstanceAccess(inst: {
  isFree?: boolean | null;
  paidUntil?: string | null;
}): boolean {
  if (inst.isFree) return true;
  return isSubscriptionActive(inst.paidUntil);
}

export function billingStatusForInstance(inst: {
  isFree?: boolean | null;
  paidUntil?: string | null;
}): BillingStatus {
  if (inst.isFree) return 'active';
  return billingStatusFromPaidUntil(inst.paidUntil);
}

export function normalizeCurrency(raw?: string | null): BillingCurrency {
  const c = String(raw || '').trim().toUpperCase();
  return c === 'USD' ? 'USD' : 'INR';
}

export function priceForCurrency(currency: BillingCurrency, plan: Plan = getPlan()): {
  currency: BillingCurrency;
  /** Display amount in major units */
  display: number;
  /** Razorpay amount in smallest unit */
  amountMinor: number;
  priceLabel: string;
  buttonLabel: string;
} {
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
