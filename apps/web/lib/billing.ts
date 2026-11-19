/** Vectra Cloud pricing — values come from env (with safe defaults). */
import {
  computeAccess,
  computeBillingStatus,
  type InstanceBilling,
  type InstanceBillingStatus,
} from './subscription-core';


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

type Size = { id: string; cpu: number; memoryMb: number; priceInr: number; priceUsd: number; name: string };

const SIZES: Size[] = [
  { id: 'hosting-2c4g', cpu: 2, memoryMb: 4096, priceInr: 199, priceUsd: 2.29, name: '2 vCPU · 4 GB' },
  { id: 'hosting-4c8g', cpu: 4, memoryMb: 8192, priceInr: 399, priceUsd: 4.59, name: '4 vCPU · 8 GB' },
  { id: 'hosting-8c8g', cpu: 8, memoryMb: 8192, priceInr: 599, priceUsd: 6.79, name: '8 vCPU · 8 GB' },
  { id: 'hosting-16c16g', cpu: 16, memoryMb: 16384, priceInr: 1199, priceUsd: 13.49, name: '16 vCPU · 16 GB' },
];

function toPlan(size: Size, periodDays: number): Plan & { cpu: number; memoryMb: number } {
  const priceUsd = size.priceUsd;
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

/** Default sold size: 4 vCPU · 8 GB. */
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

export type BillingStatus = InstanceBillingStatus;

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

/**
 * Access: free tier, paid period, or failed-renewal grace — and never while
 * billing has suspended the workspace.
 */
export function hasInstanceAccess(inst: InstanceBilling): boolean {
  return computeAccess(inst);
}

export function billingStatusForInstance(inst: InstanceBilling): BillingStatus {
  return computeBillingStatus(inst);
}

function envInt(key: string, fallback: number, min: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Subscription lifecycle knobs (server-side env). */
export function subscriptionBillingConfig(): { graceDays: number; retentionDays: number; totalCount: number } {
  return {
    graceDays: envInt('BILLING_GRACE_DAYS', 3, 0),
    retentionDays: envInt('BILLING_RETENTION_DAYS', 14, 1),
    // Monthly cycles Razorpay may charge before the subscription completes.
    totalCount: envInt('BILLING_SUBSCRIPTION_TOTAL_COUNT', 120, 1),
  };
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
