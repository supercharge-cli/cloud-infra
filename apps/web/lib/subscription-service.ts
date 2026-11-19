/**
 * Subscription billing service. All I/O is injected so ownership checks,
 * webhook idempotency and lifecycle transitions are unit-tested with fakes.
 * Production wiring lives in ./subscription-runtime.ts.
 */
import {
  applySubscriptionEvent,
  isLive,
  isTerminal,
  isUpdateUnsupportedError,
  lifecycleDecision,
  scheduleForChange,
  type BillingConfig,
  type InstanceBilling,
  type RazorpaySubscriptionEntity,
  type SubscriptionCurrency,
  type SubscriptionEventType,
  type SubscriptionRecord,
} from './subscription-core';

export type ServiceInstance = InstanceBilling & {
  id: string;
  userId: string;
  name: string;
  status: string;
  sandboxId?: string;
  runtime?: string;
};

export type SizeInfo = { id: string; name: string; priceInr: number; priceUsd: number };

export type ServiceError = { ok: false; status: number; error: string; code?: string; [k: string]: unknown };
export type ServiceOk<T> = { ok: true } & T;
export type ServiceResult<T> = ServiceOk<T> | ServiceError;

export type EventClaim = 'claimed' | 'done' | 'processing';

export type SubscriptionDeps = {
  now(): Date;
  config: BillingConfig & { totalCount: number };
  publicKeyId(): string;
  sizes: {
    byId(id?: string | null): SizeInfo | null;
    all(): SizeInfo[];
    razorpayPlanId(sizeId: string, currency: SubscriptionCurrency): string | null;
    sizeForRazorpayPlan(razorpayPlanId?: string | null): string | null;
  };
  subs: {
    insert(rec: SubscriptionRecord): Promise<void>;
    get(id: string): Promise<SubscriptionRecord | null>;
    findOwned(userId: string, id: string): Promise<SubscriptionRecord | null>;
    listForUser(userId: string): Promise<SubscriptionRecord[]>;
    update(id: string, patch: Partial<SubscriptionRecord>): Promise<SubscriptionRecord | null>;
    liveForInstance(instanceId: string): Promise<SubscriptionRecord | null>;
    /** Atomic: true when this caller may create the workspace. */
    claimProvision(id: string, now: Date): Promise<boolean>;
    releaseProvision(id: string): Promise<void>;
    /** Active new-workspace subscriptions that never got a workspace. */
    listUnprovisioned(limit: number): Promise<SubscriptionRecord[]>;
  };
  events: {
    claim(eventId: string, meta: { event: string; subscriptionId?: string }): Promise<EventClaim>;
    complete(eventId: string): Promise<void>;
    release(eventId: string): Promise<void>;
  };
  invoices: {
    record(doc: {
      paymentId: string;
      subscriptionId: string;
      userId: string;
      invoiceId?: string | null;
      amount?: number;
      currency?: string;
      paidAt: string;
    }): Promise<void>;
  };
  instances: {
    getOwned(userId: string, id: string): Promise<ServiceInstance | null>;
    getById(id: string): Promise<ServiceInstance | null>;
    update(id: string, patch: Partial<ServiceInstance>): Promise<void>;
    listManaged(limit: number): Promise<ServiceInstance[]>;
  };
  razorpay: {
    create(input: { planId: string; totalCount: number; notes: Record<string, string>; startAt?: number }): Promise<RazorpaySubscriptionEntity>;
    fetch(id: string): Promise<RazorpaySubscriptionEntity>;
    cancel(id: string, atCycleEnd: boolean): Promise<RazorpaySubscriptionEntity>;
    update(id: string, input: { planId: string; scheduleChangeAt: 'now' | 'cycle_end' }): Promise<RazorpaySubscriptionEntity>;
    resume(id: string): Promise<RazorpaySubscriptionEntity>;
  };
  countWorkspaces(userId: string): Promise<number>;
  /** Create the paid workspace; returns its id. */
  provision(sub: SubscriptionRecord): Promise<{ instanceId: string }>;
  pauseSandbox(inst: ServiceInstance): Promise<void>;
  log?(message: string): void;
};

export type CreateSubscriptionInput = {
  planId?: string;
  currency?: string;
  purpose?: string;
  instanceId?: string;
  name?: string;
  runtime?: string;
};

function err(status: number, error: string, code?: string, extra?: Record<string, unknown>): ServiceError {
  return { ok: false, status, error, ...(code ? { code } : {}), ...(extra || {}) };
}

function errorMessage(e: unknown): string {
  return (e as Error)?.message || String(e);
}

export function publicSubscription(sub: SubscriptionRecord) {
  return {
    id: sub.id,
    planId: sub.planId,
    pendingPlanId: sub.pendingPlanId || null,
    currency: sub.currency,
    purpose: sub.purpose,
    instanceId: sub.instanceId || null,
    instanceName: sub.instanceName,
    status: sub.status,
    cancelAtCycleEnd: Boolean(sub.cancelAtCycleEnd),
    currentStart: sub.currentStart || null,
    currentEnd: sub.currentEnd || null,
    nextChargeAt: sub.chargeAt || null,
    startAt: sub.startAt || null,
    endedAt: sub.endedAt || null,
    paidCount: sub.paidCount || 0,
    lastPaymentFailedAt: sub.lastPaymentFailedAt || null,
    /** Razorpay-hosted page to authorise / fix the mandate */
    paymentUrl: sub.shortUrl || null,
    createdAt: sub.createdAt,
  };
}

export function createSubscriptionService(deps: SubscriptionDeps) {
  const log = deps.log || (() => undefined);

  /** Apply an entity to the subscription and its workspace; provision if needed. */
  async function applyEntity(
    type: SubscriptionEventType,
    sub: SubscriptionRecord,
    entity: RazorpaySubscriptionEntity,
    payment?: { id?: string; invoice_id?: string | null; amount?: number; currency?: string } | null,
  ): Promise<SubscriptionRecord> {
    const now = deps.now();
    const instance = sub.instanceId ? await deps.instances.getById(sub.instanceId) : null;
    const applied = applySubscriptionEvent({
      type,
      sub,
      instance,
      entity,
      payment,
      now,
      config: deps.config,
      planForRazorpayPlan: deps.sizes.sizeForRazorpayPlan,
    });
    let next = (await deps.subs.update(sub.id, applied.sub)) || { ...sub, ...applied.sub };

    if (type === 'subscription.charged' && payment?.id) {
      await deps.invoices.record({
        paymentId: payment.id,
        subscriptionId: sub.id,
        userId: sub.userId,
        invoiceId: payment.invoice_id || null,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: now.toISOString(),
      });
    }

    if (instance) {
      await deps.instances.update(instance.id, applied.instance as Partial<ServiceInstance>);
    } else if (applied.provision) {
      next = await provisionFor(next, entity, payment || null);
    }
    return next;
  }

  async function provisionFor(
    sub: SubscriptionRecord,
    entity: RazorpaySubscriptionEntity,
    payment: { id?: string; invoice_id?: string | null } | null,
  ): Promise<SubscriptionRecord> {
    const now = deps.now();
    if (!(await deps.subs.claimProvision(sub.id, now))) return sub;
    try {
      const { instanceId } = await deps.provision(sub);
      const linked = (await deps.subs.update(sub.id, {
        instanceId,
        provisioning: false,
        provisioningAt: null,
        updatedAt: now.toISOString(),
      })) || { ...sub, instanceId };
      // Re-apply now that the workspace exists so paidUntil/plan land on it.
      const instance = await deps.instances.getById(instanceId);
      const applied = applySubscriptionEvent({
        type: 'sync',
        sub: linked,
        instance,
        entity,
        payment,
        now,
        config: deps.config,
        planForRazorpayPlan: deps.sizes.sizeForRazorpayPlan,
      });
      await deps.instances.update(instanceId, applied.instance as Partial<ServiceInstance>);
      return linked;
    } catch (e) {
      await deps.subs.releaseProvision(sub.id);
      throw e;
    }
  }

  async function create(user: { id: string; email?: string }, input: CreateSubscriptionInput): Promise<
    ServiceResult<{ subscription: ReturnType<typeof publicSubscription>; keyId: string; size: SizeInfo }>
  > {
    const size = deps.sizes.byId(input.planId);
    if (!size) return err(400, 'Unknown sandbox size', 'UNKNOWN_PLAN');
    const wanted: SubscriptionCurrency = String(input.currency || '').toUpperCase() === 'USD' ? 'USD' : 'INR';
    let currency: SubscriptionCurrency = wanted;
    let razorpayPlanId = deps.sizes.razorpayPlanId(size.id, wanted);
    if (!razorpayPlanId && wanted === 'USD') {
      currency = 'INR';
      razorpayPlanId = deps.sizes.razorpayPlanId(size.id, 'INR');
    }
    if (!razorpayPlanId) return err(503, 'Autopay is not set up for this size yet', 'PLAN_NOT_CONFIGURED');
    const keyId = deps.publicKeyId();
    if (!keyId) return err(503, 'Razorpay key is not configured', 'RAZORPAY_NOT_CONFIGURED');

    const purpose = input.purpose === 'attach' || input.instanceId ? 'attach' : 'new_instance';
    const now = deps.now();
    let instanceName = String(input.name || 'workspace').trim().slice(0, 64) || 'workspace';
    let instanceId: string | null = null;
    let startAt: number | undefined;
    const runtime = 'supercharge';

    if (purpose === 'new_instance') {
      if ((await deps.countWorkspaces(user.id)) > 0) {
        return err(409, 'Your account already has a workspace. Subscribe from that workspace instead.', 'WORKSPACE_LIMIT');
      }
    } else {
      const inst = await deps.instances.getOwned(user.id, String(input.instanceId || ''));
      if (!inst) return err(404, 'Instance not found');
      if (inst.status === 'destroyed') return err(410, 'Instance destroyed');
      const live = await deps.subs.liveForInstance(inst.id);
      if (live && live.status !== 'created') {
        return err(409, 'This workspace already has autopay', 'ALREADY_SUBSCRIBED', { subscriptionId: live.id });
      }
      instanceId = inst.id;
      instanceName = inst.name;
      // Honour time already paid (legacy one-off orders): first charge at its end.
      const paidUntil = Date.parse(inst.paidUntil || '');
      if (!inst.isFree && Number.isFinite(paidUntil) && paidUntil > now.getTime() + 3_600_000) {
        startAt = Math.floor(paidUntil / 1000);
      }
    }

    let entity: RazorpaySubscriptionEntity;
    try {
      entity = await deps.razorpay.create({
        planId: razorpayPlanId,
        totalCount: deps.config.totalCount,
        startAt,
        notes: {
          product: 'vectra-cloud',
          userId: user.id,
          purpose,
          instanceId: instanceId || '',
          instanceName,
          runtime,
          plan: size.id,
        },
      });
    } catch (e) {
      log(`[subscriptions] create failed: ${errorMessage(e)}`);
      return err(502, 'Could not start autopay with Razorpay. Try again in a minute.', 'RAZORPAY_ERROR');
    }

    const nowIso = now.toISOString();
    const rec: SubscriptionRecord = {
      id: entity.id,
      userId: user.id,
      email: user.email,
      planId: size.id,
      razorpayPlanId,
      currency,
      purpose,
      instanceId,
      instanceName,
      runtime,
      status: 'created',
      startAt: startAt ? new Date(startAt * 1000).toISOString() : null,
      shortUrl: entity.short_url || null,
      paidCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await deps.subs.insert(rec);
    return { ok: true, subscription: publicSubscription(rec), keyId, size };
  }

  async function confirmCheckout(userId: string, subscriptionId: string): Promise<
    ServiceResult<{ subscription: ReturnType<typeof publicSubscription>; instanceId: string | null; pending: boolean }>
  > {
    const sub = await deps.subs.findOwned(userId, subscriptionId);
    if (!sub) return err(404, 'Subscription not found');
    let entity: RazorpaySubscriptionEntity;
    try {
      entity = await deps.razorpay.fetch(sub.id);
    } catch (e) {
      log(`[subscriptions] fetch after checkout failed: ${errorMessage(e)}`);
      // Payment is signed; the webhook finishes the job.
      const next = (await deps.subs.update(sub.id, {
        status: sub.status === 'created' ? 'authenticated' : sub.status,
        updatedAt: deps.now().toISOString(),
      })) || sub;
      return { ok: true, subscription: publicSubscription(next), instanceId: next.instanceId || null, pending: true };
    }
    const next = await applyEntity('sync', sub, entity);
    return {
      ok: true,
      subscription: publicSubscription(next),
      instanceId: next.instanceId || null,
      pending: !next.instanceId,
    };
  }

  async function list(userId: string) {
    const rows = await deps.subs.listForUser(userId);
    return rows.map(publicSubscription);
  }

  async function get(userId: string, id: string): Promise<ServiceResult<{ subscription: ReturnType<typeof publicSubscription> }>> {
    const sub = await deps.subs.findOwned(userId, id);
    if (!sub) return err(404, 'Subscription not found');
    return { ok: true, subscription: publicSubscription(sub) };
  }

  async function cancel(userId: string, id: string, opts: { immediately?: boolean } = {}): Promise<
    ServiceResult<{ subscription: ReturnType<typeof publicSubscription> }>
  > {
    const sub = await deps.subs.findOwned(userId, id);
    if (!sub) return err(404, 'Subscription not found');
    if (sub.status === 'created') {
      const next = (await deps.subs.update(sub.id, { status: 'expired', updatedAt: deps.now().toISOString() })) || sub;
      return { ok: true, subscription: publicSubscription(next) };
    }
    if (!isLive(sub.status)) return err(409, 'This subscription is already ended', 'NOT_CANCELLABLE');
    const atCycleEnd = !opts.immediately && sub.status !== 'halted' && sub.status !== 'pending';
    let entity: RazorpaySubscriptionEntity;
    try {
      entity = await deps.razorpay.cancel(sub.id, atCycleEnd);
    } catch (e) {
      log(`[subscriptions] cancel failed: ${errorMessage(e)}`);
      return err(502, 'Razorpay did not accept the cancellation. Try again in a minute.', 'RAZORPAY_ERROR');
    }
    const marked = (await deps.subs.update(sub.id, { cancelAtCycleEnd: atCycleEnd, updatedAt: deps.now().toISOString() })) || {
      ...sub,
      cancelAtCycleEnd: atCycleEnd,
    };
    const next = await applyEntity('sync', marked, entity);
    return { ok: true, subscription: publicSubscription(next) };
  }

  async function changeSize(userId: string, id: string, newPlanId: string): Promise<
    ServiceResult<{ subscription: ReturnType<typeof publicSubscription>; scheduleChangeAt: 'now' | 'cycle_end' }>
  > {
    const sub = await deps.subs.findOwned(userId, id);
    if (!sub) return err(404, 'Subscription not found');
    if (sub.status !== 'active' && sub.status !== 'authenticated') {
      return err(409, 'Size can change only while autopay is active', 'NOT_CHANGEABLE');
    }
    if (sub.cancelAtCycleEnd) return err(409, 'This subscription is set to cancel. Subscribe again to pick a new size.', 'CANCEL_SCHEDULED');
    const from = deps.sizes.byId(sub.planId);
    const to = deps.sizes.byId(newPlanId);
    if (!to || !from) return err(400, 'Unknown sandbox size', 'UNKNOWN_PLAN');
    if (to.id === sub.planId) return err(400, 'Already on this size', 'SAME_PLAN');
    const razorpayPlanId = deps.sizes.razorpayPlanId(to.id, sub.currency);
    if (!razorpayPlanId) return err(503, 'Autopay is not set up for this size yet', 'PLAN_NOT_CONFIGURED');
    const scheduleChangeAt = scheduleForChange(from.priceInr, to.priceInr);
    let entity: RazorpaySubscriptionEntity;
    try {
      entity = await deps.razorpay.update(sub.id, { planId: razorpayPlanId, scheduleChangeAt });
    } catch (e) {
      const message = errorMessage(e);
      if (isUpdateUnsupportedError(message)) {
        return err(
          409,
          'UPI Autopay and e-mandate subscriptions cannot change size. Cancel this one (you keep access until the period ends) and subscribe to the new size.',
          'CHANGE_UNSUPPORTED_METHOD',
        );
      }
      log(`[subscriptions] update failed: ${message}`);
      return err(502, 'Razorpay did not accept the size change. Try again in a minute.', 'RAZORPAY_ERROR');
    }
    let base = sub;
    if (scheduleChangeAt === 'cycle_end') {
      base = (await deps.subs.update(sub.id, { pendingPlanId: to.id, updatedAt: deps.now().toISOString() })) || {
        ...sub,
        pendingPlanId: to.id,
      };
      // The entity still carries the old plan until the cycle ends.
      const next = await applyEntity('sync', base, { ...entity, has_scheduled_changes: true });
      return { ok: true, subscription: publicSubscription(next), scheduleChangeAt };
    }
    const next = await applyEntity('subscription.updated', base, { ...entity, plan_id: entity.plan_id || razorpayPlanId });
    return { ok: true, subscription: publicSubscription(next), scheduleChangeAt };
  }

  async function resume(userId: string, id: string): Promise<
    ServiceResult<{ subscription: ReturnType<typeof publicSubscription>; paymentUrl?: string | null }>
  > {
    const sub = await deps.subs.findOwned(userId, id);
    if (!sub) return err(404, 'Subscription not found');
    if (sub.status === 'pending' || sub.status === 'halted') {
      // Razorpay retries or the customer pays the due invoice on its page.
      return { ok: true, subscription: publicSubscription(sub), paymentUrl: sub.shortUrl || null };
    }
    if (sub.status !== 'paused') return err(409, 'Only a paused subscription can be resumed', 'NOT_RESUMABLE');
    let entity: RazorpaySubscriptionEntity;
    try {
      entity = await deps.razorpay.resume(sub.id);
    } catch (e) {
      log(`[subscriptions] resume failed: ${errorMessage(e)}`);
      return err(502, 'Razorpay did not resume the subscription. Try again in a minute.', 'RAZORPAY_ERROR');
    }
    const next = await applyEntity('subscription.resumed', sub, entity);
    return { ok: true, subscription: publicSubscription(next) };
  }

  /**
   * Webhook entry. Returns handled:false for non-subscription events so the
   * route can fall through to the legacy one-off order handler.
   */
  async function handleWebhookEvent(eventId: string, event: {
    event?: string;
    payload?: {
      subscription?: { entity?: RazorpaySubscriptionEntity };
      payment?: { entity?: { id?: string; invoice_id?: string | null; amount?: number; currency?: string } };
    };
  }): Promise<{ handled: boolean; status: 'ok' | 'duplicate' | 'in_progress' | 'ignored'; reason?: string; subscriptionId?: string }> {
    const type = String(event.event || '');
    if (!type.startsWith('subscription.')) return { handled: false, status: 'ignored' };
    const entity = event.payload?.subscription?.entity;
    if (!entity?.id) return { handled: true, status: 'ignored', reason: 'no subscription entity' };

    const claim = await deps.events.claim(eventId, { event: type, subscriptionId: entity.id });
    if (claim === 'done') return { handled: true, status: 'duplicate', subscriptionId: entity.id };
    if (claim === 'processing') return { handled: true, status: 'in_progress', subscriptionId: entity.id };

    try {
      let sub = await deps.subs.get(entity.id);
      if (!sub) {
        sub = await adoptFromNotes(entity);
        if (!sub) {
          await deps.events.complete(eventId);
          return { handled: true, status: 'ignored', reason: 'unknown subscription', subscriptionId: entity.id };
        }
      }
      await applyEntity(type as SubscriptionEventType, sub, entity, event.payload?.payment?.entity || null);
      await deps.events.complete(eventId);
      return { handled: true, status: 'ok', subscriptionId: entity.id };
    } catch (e) {
      await deps.events.release(eventId);
      throw e;
    }
  }

  /** A subscription created outside our API (e.g. dashboard) that carries our notes. */
  async function adoptFromNotes(entity: RazorpaySubscriptionEntity): Promise<SubscriptionRecord | null> {
    const notes = (entity.notes && !Array.isArray(entity.notes) ? entity.notes : {}) as Record<string, string>;
    if (notes.product !== 'vectra-cloud' || !notes.userId) return null;
    const planId = deps.sizes.sizeForRazorpayPlan(entity.plan_id) || notes.plan;
    if (!planId || !deps.sizes.byId(planId)) return null;
    let instanceId: string | null = notes.instanceId || null;
    if (instanceId && !(await deps.instances.getOwned(notes.userId, instanceId))) instanceId = null;
    const nowIso = deps.now().toISOString();
    const rec: SubscriptionRecord = {
      id: entity.id,
      userId: notes.userId,
      planId,
      razorpayPlanId: entity.plan_id || '',
      currency: 'INR',
      purpose: instanceId ? 'attach' : 'new_instance',
      instanceId,
      instanceName: notes.instanceName || 'workspace',
      runtime: notes.runtime || 'supercharge',
      status: 'created',
      shortUrl: entity.short_url || null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await deps.subs.insert(rec);
    return rec;
  }

  /** Cron: grace → pause → retention flag. Never deletes. */
  async function runLifecycle(limit = 100) {
    const now = deps.now();
    const results: Array<{ instanceId: string; action: string; error?: string }> = [];

    for (const sub of await deps.subs.listUnprovisioned(Math.min(limit, 20))) {
      try {
        const entity = await deps.razorpay.fetch(sub.id);
        const next = await applyEntity('sync', sub, entity);
        results.push({ instanceId: next.instanceId || '', action: next.instanceId ? 'provisioned' : 'provision_skipped' });
      } catch (e) {
        results.push({ instanceId: '', action: 'provision_failed', error: errorMessage(e).slice(0, 200) });
      }
    }

    for (const inst of await deps.instances.listManaged(limit)) {
      const sub = inst.subscriptionId ? await deps.subs.get(inst.subscriptionId) : null;
      const decision = lifecycleDecision(inst, sub?.status || null, now, deps.config);
      try {
        if (decision.action !== 'none') {
          await deps.instances.update(inst.id, decision.patch as Partial<ServiceInstance>);
        }
        if (decision.action === 'suspend' || (decision.action === 'none' && inst.billingSuspendedAt && !inst.deletionFlaggedAt)) {
          // Re-pausing is idempotent and catches sandboxes woken by inbound traffic.
          await deps.pauseSandbox({ ...inst, ...(decision.action === 'suspend' ? decision.patch : {}) });
        }
        results.push({ instanceId: inst.id, action: decision.action });
      } catch (e) {
        results.push({ instanceId: inst.id, action: decision.action, error: errorMessage(e).slice(0, 200) });
      }
    }
    return { ranAt: now.toISOString(), results };
  }

  return { create, confirmCheckout, list, get, cancel, changeSize, resume, handleWebhookEvent, runLifecycle, applyEntity };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
export { isTerminal };
