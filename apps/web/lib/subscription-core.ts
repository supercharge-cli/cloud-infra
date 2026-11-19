/**
 * Pure subscription billing rules: no I/O, no runtime imports.
 * Razorpay webhooks, checkout callbacks and the billing cron all go through
 * these functions so the state machine is tested in one place.
 */

export type SubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'expired';

export type SubscriptionCurrency = 'INR' | 'USD';

export type SubscriptionRecord = {
  /** Razorpay subscription id (sub_…) */
  id: string;
  userId: string;
  email?: string;
  /** Sandbox size id, e.g. hosting-4c8g */
  planId: string;
  razorpayPlanId: string;
  currency: SubscriptionCurrency;
  /** Downgrade waiting for the cycle end */
  pendingPlanId?: string | null;
  purpose: 'new_instance' | 'attach';
  instanceId?: string | null;
  instanceName: string;
  runtime: string;
  status: SubscriptionStatus;
  cancelAtCycleEnd?: boolean;
  currentStart?: string | null;
  currentEnd?: string | null;
  chargeAt?: string | null;
  startAt?: string | null;
  endedAt?: string | null;
  shortUrl?: string | null;
  paidCount?: number;
  lastPaymentId?: string | null;
  lastInvoiceId?: string | null;
  lastPaymentFailedAt?: string | null;
  provisioning?: boolean;
  provisioningAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Billing fields on an instance (workspace) document. */
export type InstanceBilling = {
  isFree?: boolean | null;
  paidUntil?: string | null;
  plan?: string | null;
  billingStatus?: InstanceBillingStatus | null;
  subscriptionId?: string | null;
  subscriptionStatus?: SubscriptionStatus | null;
  nextChargeAt?: string | null;
  cancelAtCycleEnd?: boolean | null;
  pendingPlanId?: string | null;
  graceUntil?: string | null;
  billingSuspendedAt?: string | null;
  retainUntil?: string | null;
  deletionFlaggedAt?: string | null;
  /** Workspace was the free base before a subscription upgraded it */
  wasFree?: boolean | null;
};

export type InstanceBillingStatus = 'active' | 'grace' | 'past_due' | 'suspended' | 'none';

/** Razorpay subscription entity (subset we read). Times are unix seconds. */
export type RazorpaySubscriptionEntity = {
  id: string;
  plan_id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  ended_at?: number | null;
  paid_count?: number;
  short_url?: string | null;
  has_scheduled_changes?: boolean;
  notes?: Record<string, string> | unknown[];
};

export type BillingConfig = {
  graceDays: number;
  retentionDays: number;
};

export const FREE_BASE_PLAN_ID = 'hosting-2c4g';

const TERMINAL: SubscriptionStatus[] = ['cancelled', 'completed', 'expired'];
/** Statuses where the customer still has a live mandate. */
export const LIVE_STATUSES: SubscriptionStatus[] = ['authenticated', 'active', 'pending', 'halted', 'paused'];
const PRE_ACTIVE: SubscriptionStatus[] = ['created', 'authenticated'];
const KNOWN: SubscriptionStatus[] = [
  'created', 'authenticated', 'active', 'pending', 'halted', 'paused', 'cancelled', 'completed', 'expired',
];

const DAY_MS = 86_400_000;

export function isTerminal(status?: string | null): boolean {
  return TERMINAL.includes(status as SubscriptionStatus);
}

export function isLive(status?: string | null): boolean {
  return LIVE_STATUSES.includes(status as SubscriptionStatus);
}

export function toIso(unixSeconds?: number | null): string | null {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

function ms(iso?: string | null): number {
  if (!iso) return NaN;
  return Date.parse(iso);
}

function laterIso(a?: string | null, b?: string | null): string | null {
  const ta = ms(a);
  const tb = ms(b);
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? (b as string) : null;
  if (!Number.isFinite(tb)) return a as string;
  return tb > ta ? (b as string) : (a as string);
}

function addDays(fromMs: number, days: number): string {
  return new Date(fromMs + days * DAY_MS).toISOString();
}

/** `hosting-4c8g` → `4C8G` (env key suffix). */
export function sizeKey(planId: string): string {
  return planId.replace(/^hosting-/, '').replace(/[^a-z0-9]/gi, '_').toUpperCase();
}

/** Env var holding the Razorpay plan id for a size (INR, optional _USD). */
export function planEnvKey(planId: string, currency: SubscriptionCurrency = 'INR'): string {
  return `RAZORPAY_PLAN_ID_${sizeKey(planId)}${currency === 'USD' ? '_USD' : ''}`;
}

export function razorpayPlanIdFromEnv(
  env: Record<string, string | undefined>,
  planId: string,
  currency: SubscriptionCurrency = 'INR',
): string | null {
  const v = env[planEnvKey(planId, currency)]?.trim();
  return v || null;
}

export function sizeForRazorpayPlanId(
  env: Record<string, string | undefined>,
  sizeIds: string[],
  razorpayPlanId?: string | null,
): string | null {
  if (!razorpayPlanId) return null;
  for (const id of sizeIds) {
    if (razorpayPlanIdFromEnv(env, id, 'INR') === razorpayPlanId) return id;
    if (razorpayPlanIdFromEnv(env, id, 'USD') === razorpayPlanId) return id;
  }
  return null;
}

/** Workspace access (chat, wake, exec, …). */
export function computeAccess(inst: InstanceBilling, now: Date = new Date()): boolean {
  if (inst.billingSuspendedAt) return false;
  if (inst.isFree) return true;
  const t = now.getTime();
  if (ms(inst.paidUntil) > t) return true;
  if (ms(inst.graceUntil) > t) return true;
  return false;
}

export function computeBillingStatus(inst: InstanceBilling, now: Date = new Date()): InstanceBillingStatus {
  if (inst.billingSuspendedAt) return 'suspended';
  if (inst.isFree) return 'active';
  const t = now.getTime();
  if (ms(inst.paidUntil) > t) {
    return inst.subscriptionStatus === 'pending' || inst.subscriptionStatus === 'halted' ? 'grace' : 'active';
  }
  if (ms(inst.graceUntil) > t) return 'grace';
  if (!inst.paidUntil) return 'none';
  return 'past_due';
}

export function normalizeStatus(raw?: string | null): SubscriptionStatus | null {
  const s = String(raw || '').trim().toLowerCase();
  return KNOWN.includes(s as SubscriptionStatus) ? (s as SubscriptionStatus) : null;
}

/**
 * Next status given the current one and an incoming (possibly stale) one.
 * Webhooks can arrive out of order: never leave a terminal state and never
 * step back to created/authenticated after the subscription went live.
 */
export function nextStatus(current: SubscriptionStatus, incoming: SubscriptionStatus | null): SubscriptionStatus {
  if (!incoming) return current;
  if (isTerminal(current)) return current;
  if (PRE_ACTIVE.includes(incoming) && !PRE_ACTIVE.includes(current)) return current;
  if (incoming === 'created' && current === 'authenticated') return current;
  return incoming;
}

export type SubscriptionEventType =
  | 'subscription.authenticated'
  | 'subscription.activated'
  | 'subscription.charged'
  | 'subscription.pending'
  | 'subscription.halted'
  | 'subscription.cancelled'
  | 'subscription.completed'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.updated'
  /** Synthetic: client checkout callback or our own API call result */
  | 'sync';

export type AppliedEvent = {
  sub: Partial<SubscriptionRecord>;
  instance: Partial<InstanceBilling> & { plan?: string };
  /** A new workspace must be created for this subscription */
  provision: boolean;
};

/**
 * Apply a subscription webhook (or a fetched entity) to our records.
 * `planForRazorpayPlan` maps a Razorpay plan id back to a size id.
 */
export function applySubscriptionEvent(input: {
  type: SubscriptionEventType;
  sub: SubscriptionRecord;
  instance: InstanceBilling | null;
  entity: RazorpaySubscriptionEntity;
  payment?: { id?: string; invoice_id?: string | null } | null;
  now: Date;
  config: BillingConfig;
  planForRazorpayPlan: (razorpayPlanId?: string | null) => string | null;
}): AppliedEvent {
  const { type, sub, instance, entity, now, config } = input;
  const nowIso = now.toISOString();
  const status = nextStatus(sub.status, normalizeStatus(entity.status));
  const terminalAlready = isTerminal(sub.status);

  const subPatch: Partial<SubscriptionRecord> = { status, updatedAt: nowIso };
  if (!terminalAlready) {
    const currentStart = toIso(entity.current_start);
    const currentEnd = toIso(entity.current_end);
    if (currentStart) subPatch.currentStart = currentStart;
    if (currentEnd) subPatch.currentEnd = laterIso(sub.currentEnd, currentEnd);
    subPatch.chargeAt = isLive(status) && status !== 'paused' ? toIso(entity.charge_at) : null;
    if (entity.short_url) subPatch.shortUrl = entity.short_url;
    if (typeof entity.paid_count === 'number') subPatch.paidCount = Math.max(sub.paidCount || 0, entity.paid_count);
  }
  if (isTerminal(status)) {
    subPatch.endedAt = toIso(entity.ended_at) || sub.endedAt || nowIso;
    subPatch.chargeAt = null;
  }

  // Plan changes (upgrade now, or a scheduled downgrade that just applied).
  const sizeFromEntity = input.planForRazorpayPlan(entity.plan_id);
  if (sizeFromEntity && entity.plan_id && !terminalAlready) {
    subPatch.planId = sizeFromEntity;
    subPatch.razorpayPlanId = entity.plan_id;
    if (sub.pendingPlanId && (sub.pendingPlanId === sizeFromEntity || entity.has_scheduled_changes === false)) {
      subPatch.pendingPlanId = null;
    }
  }
  const planId = subPatch.planId || sub.planId;

  if (type === 'subscription.charged' && input.payment?.id) {
    subPatch.lastPaymentId = input.payment.id;
    if (input.payment.invoice_id) subPatch.lastInvoiceId = input.payment.invoice_id;
  }
  if (type === 'subscription.pending' || type === 'subscription.halted') {
    subPatch.lastPaymentFailedAt = nowIso;
  }

  const inst: AppliedEvent['instance'] = {
    subscriptionId: sub.id,
    subscriptionStatus: status,
    nextChargeAt: subPatch.chargeAt ?? null,
    cancelAtCycleEnd: Boolean(sub.cancelAtCycleEnd) && !isTerminal(status),
    pendingPlanId: subPatch.pendingPlanId !== undefined ? subPatch.pendingPlanId : sub.pendingPlanId || null,
  };

  const paidPeriodConfirmed =
    !terminalAlready &&
    status === 'active' &&
    (type === 'subscription.charged' || type === 'subscription.activated' || type === 'subscription.resumed' || type === 'sync');
  const periodEnd = subPatch.currentEnd || sub.currentEnd || null;

  if (paidPeriodConfirmed && periodEnd && ms(periodEnd) > now.getTime()) {
    const paidUntil = laterIso(instance?.paidUntil, periodEnd);
    inst.paidUntil = paidUntil;
    inst.graceUntil = null;
    inst.billingSuspendedAt = null;
    inst.retainUntil = null;
    inst.deletionFlaggedAt = null;
    inst.billingStatus = 'active';
    if (instance?.isFree) inst.wasFree = true;
    inst.isFree = false;
    inst.plan = planId;
  } else if (status === 'pending' || status === 'halted') {
    if (!instance?.graceUntil) {
      const base = Math.max(ms(instance?.paidUntil) || 0, now.getTime());
      inst.graceUntil = addDays(base, config.graceDays);
    }
    inst.billingStatus = 'grace';
  } else if (isTerminal(status)) {
    // No more retries: access runs to the end of what was paid.
    inst.graceUntil = null;
    inst.nextChargeAt = null;
  } else if (type === 'subscription.updated' && sizeFromEntity && status === 'active') {
    inst.plan = planId;
  }

  const provision =
    sub.purpose === 'new_instance' &&
    !sub.instanceId &&
    status === 'active' &&
    !terminalAlready;

  return { sub: subPatch, instance: inst, provision };
}

export type LifecycleAction =
  | { action: 'none' }
  | { action: 'start_grace'; patch: Partial<InstanceBilling> }
  | { action: 'revert_free'; patch: Partial<InstanceBilling> & { plan: string } }
  | { action: 'suspend'; patch: Partial<InstanceBilling> }
  | { action: 'flag_deletion'; patch: Partial<InstanceBilling> };

/**
 * Cron decision for one subscription-managed workspace. Only pauses and
 * flags; nothing here deletes data.
 */
export function lifecycleDecision(
  inst: InstanceBilling,
  subStatus: SubscriptionStatus | null,
  now: Date,
  config: BillingConfig,
): LifecycleAction {
  const t = now.getTime();
  if (inst.deletionFlaggedAt) return { action: 'none' };
  if (inst.billingSuspendedAt) {
    if (inst.retainUntil && ms(inst.retainUntil) <= t) {
      return { action: 'flag_deletion', patch: { deletionFlaggedAt: now.toISOString() } };
    }
    return { action: 'none' };
  }
  if (inst.isFree) return { action: 'none' };
  if (ms(inst.paidUntil) > t) return { action: 'none' };
  if (ms(inst.graceUntil) > t) return { action: 'none' };

  // Period ended but the mandate is live: Razorpay may still be charging.
  if (!inst.graceUntil && subStatus && (subStatus === 'active' || subStatus === 'pending' || subStatus === 'halted')) {
    const base = Number.isFinite(ms(inst.paidUntil)) ? ms(inst.paidUntil) : t;
    const graceUntil = addDays(base, config.graceDays);
    if (ms(graceUntil) > t) return { action: 'start_grace', patch: { graceUntil, billingStatus: 'grace' } };
  }

  // A paid upgrade of the free base falls back to the free base, never paused.
  if (inst.wasFree) {
    const ended = !subStatus || isTerminal(subStatus);
    return {
      action: 'revert_free',
      patch: {
        isFree: true,
        wasFree: false,
        plan: FREE_BASE_PLAN_ID,
        billingStatus: 'active',
        graceUntil: null,
        pendingPlanId: null,
        ...(ended
          ? { subscriptionId: null, subscriptionStatus: null, nextChargeAt: null, cancelAtCycleEnd: false }
          : {}),
      },
    };
  }

  return {
    action: 'suspend',
    patch: {
      billingSuspendedAt: now.toISOString(),
      retainUntil: addDays(t, config.retentionDays),
      billingStatus: 'suspended',
    },
  };
}

/** Upgrade when the new size costs more. Upgrades apply now, downgrades at cycle end. */
export function scheduleForChange(fromPriceInr: number, toPriceInr: number): 'now' | 'cycle_end' {
  return toPriceInr > fromPriceInr ? 'now' : 'cycle_end';
}

/** Razorpay refuses plan updates for UPI Autopay and e-mandate subscriptions. */
export function isUpdateUnsupportedError(message?: string | null): boolean {
  const m = String(message || '').toLowerCase();
  return m.includes('upi') || m.includes('emandate') || m.includes('e-mandate');
}
