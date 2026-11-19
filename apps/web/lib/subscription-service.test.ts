import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as Service from './subscription-service';
import type { RazorpaySubscriptionEntity, SubscriptionRecord } from './subscription-core';

const { loadLib } = (await import(new URL('./subscription-test-loader.ts', import.meta.url).href)) as typeof import('./subscription-test-loader');
const { createSubscriptionService } = loadLib<typeof Service>('subscription-service');

const NOW = new Date('2026-11-19T10:00:00.000Z');
const DAY = 86_400_000;
const sec = (days: number) => Math.floor((NOW.getTime() + days * DAY) / 1000);
const SIZES = [
  { id: 'hosting-2c4g', name: '2c4g', priceInr: 199, priceUsd: 2.26 },
  { id: 'hosting-4c8g', name: '4c8g', priceInr: 399, priceUsd: 4.54 },
  { id: 'hosting-8c8g', name: '8c8g', priceInr: 599, priceUsd: 6.81 },
];
const PLAN_IDS: Record<string, string> = { 'hosting-2c4g': 'plan_2', 'hosting-4c8g': 'plan_4', 'hosting-8c8g': 'plan_8' };

function fixture(opts: { workspaces?: number; updateError?: string } = {}) {
  const subs = new Map<string, SubscriptionRecord>();
  const events = new Map<string, 'processing' | 'done'>();
  const instances = new Map<string, Service.ServiceInstance>();
  const invoices = new Map<string, unknown>();
  const calls: string[] = [];
  let provisioned = 0;
  let remote: RazorpaySubscriptionEntity = { id: 'sub_new', status: 'created', plan_id: 'plan_4', short_url: 'https://rzp.io/i/x' };
  let n = 0;
  let clock = NOW;
  const deps: Service.SubscriptionDeps = {
    now: () => clock,
    config: { graceDays: 3, retentionDays: 14, totalCount: 120 },
    publicKeyId: () => 'rzp_test_key',
    sizes: {
      byId: (id) => SIZES.find((s) => s.id === id) || null,
      all: () => SIZES,
      razorpayPlanId: (id, currency) => (currency === 'INR' ? PLAN_IDS[id] || null : null),
      sizeForRazorpayPlan: (rzp) => Object.keys(PLAN_IDS).find((k) => PLAN_IDS[k] === rzp) || null,
    },
    subs: {
      insert: async (r) => void subs.set(r.id, { ...r }),
      get: async (id) => (subs.get(id) ? { ...subs.get(id)! } : null),
      findOwned: async (u, id) => (subs.get(id)?.userId === u ? { ...subs.get(id)! } : null),
      listForUser: async (u) => [...subs.values()].filter((s) => s.userId === u),
      update: async (id, patch) => {
        const prev = subs.get(id);
        if (!prev) return null;
        const next = { ...prev } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]; else if (v !== undefined) next[k] = v;
        subs.set(id, next as SubscriptionRecord);
        return { ...(next as SubscriptionRecord) };
      },
      liveForInstance: async (iid) => [...subs.values()].find((s) => s.instanceId === iid && !['cancelled', 'completed', 'expired'].includes(s.status)) || null,
      claimProvision: async (id) => {
        const s = subs.get(id)!;
        if (s.instanceId || s.provisioning) return false;
        s.provisioning = true;
        return true;
      },
      releaseProvision: async (id) => void (subs.get(id)!.provisioning = false),
      listUnprovisioned: async () => [],
    },
    events: {
      claim: async (id) => {
        const st = events.get(id);
        if (st) return st === 'done' ? 'done' : 'processing';
        events.set(id, 'processing');
        return 'claimed';
      },
      complete: async (id) => void events.set(id, 'done'),
      release: async (id) => void events.delete(id),
    },
    invoices: { record: async (doc) => void invoices.set(doc.paymentId, doc) },
    instances: {
      getOwned: async (u, id) => (instances.get(id)?.userId === u ? { ...instances.get(id)! } : null),
      getById: async (id) => (instances.get(id) ? { ...instances.get(id)! } : null),
      update: async (id, patch) => {
        const next = { ...instances.get(id)! } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]; else if (v !== undefined) next[k] = v;
        instances.set(id, next as Service.ServiceInstance);
      },
      listManaged: async () => [...instances.values()].filter((i) => i.subscriptionId),
    },
    razorpay: {
      create: async (input) => {
        calls.push(`create:${input.planId}:${input.startAt || ''}`);
        remote = { id: `sub_${++n}`, status: 'created', plan_id: input.planId, short_url: 'https://rzp.io/i/x' };
        return remote;
      },
      fetch: async (id) => ({ ...remote, id }),
      cancel: async (id, atEnd) => {
        calls.push(`cancel:${id}:${atEnd}`);
        return { ...remote, id, status: atEnd ? 'active' : 'cancelled' };
      },
      update: async (id, input) => {
        calls.push(`update:${id}:${input.planId}:${input.scheduleChangeAt}`);
        if (opts.updateError) throw new Error(opts.updateError);
        return { ...remote, id, plan_id: input.scheduleChangeAt === 'now' ? input.planId : remote.plan_id };
      },
      resume: async (id) => ({ ...remote, id, status: 'active' }),
    },
    countWorkspaces: async (u) => opts.workspaces ?? [...instances.values()].filter((i) => i.userId === u).length,
    provision: async (s) => {
      provisioned++;
      const id = `inst_${provisioned}`;
      instances.set(id, { id, userId: s.userId, name: s.instanceName, status: 'running', plan: s.planId, sandboxId: 'sbx' });
      return { instanceId: id };
    },
    pauseSandbox: async (i) => void calls.push(`pause:${i.id}`),
  };
  const svc = createSubscriptionService(deps);
  return {
    svc, subs, events, instances, invoices, calls,
    provisioned: () => provisioned,
    advance: (days: number) => { clock = new Date(NOW.getTime() + days * DAY); },
    setRemote: (e: Partial<RazorpaySubscriptionEntity>) => { remote = { ...remote, ...e }; },
  };
}

const owner = { id: 'u1', email: 'a@example.invalid' };
const chargedEvent = (id: string, over: Partial<RazorpaySubscriptionEntity> = {}) => ({
  event: 'subscription.charged',
  payload: {
    subscription: { entity: { id, status: 'active', plan_id: 'plan_4', current_start: sec(0), current_end: sec(30), charge_at: sec(30), paid_count: 1, ...over } },
    payment: { entity: { id: 'pay_1', invoice_id: 'inv_1', amount: 39900, currency: 'INR' } },
  },
});

test('create: new workspace only when the account has none', async () => {
  const f = fixture({ workspaces: 1 });
  const r = await f.svc.create(owner, { planId: 'hosting-4c8g' });
  assert.equal(r.ok, false);
  assert.equal((r as Service.ServiceError).code, 'WORKSPACE_LIMIT');
  const g = fixture();
  const ok = await g.svc.create(owner, { planId: 'hosting-4c8g', currency: 'USD' });
  assert.equal(ok.ok, true);
  const created = ok as Extract<typeof ok, { ok: true }>;
  assert.equal(created.subscription.currency, 'INR', 'falls back to INR plan when no USD plan exists');
  assert.equal(g.subs.get(created.subscription.id)?.purpose, 'new_instance');
});

test('create: unconfigured plan and unknown size are refused', async () => {
  const f = fixture();
  assert.equal(((await f.svc.create(owner, { planId: 'hosting-16c16g' })) as Service.ServiceError).code, 'UNKNOWN_PLAN');
});

test('ownership: another user cannot attach, read, cancel, change or resume', async () => {
  const f = fixture();
  f.instances.set('i1', { id: 'i1', userId: 'u1', name: 'mine', status: 'running' });
  const attach = await f.svc.create({ id: 'u2' }, { planId: 'hosting-4c8g', purpose: 'attach', instanceId: 'i1' });
  assert.equal((attach as Service.ServiceError).status, 404);
  const mine = (await f.svc.create(owner, { planId: 'hosting-4c8g', purpose: 'attach', instanceId: 'i1' })) as Extract<Service.ServiceResult<{ subscription: { id: string } }>, { ok: true }>;
  const id = mine.subscription.id;
  for (const r of [
    await f.svc.get('u2', id),
    await f.svc.cancel('u2', id),
    await f.svc.changeSize('u2', id, 'hosting-8c8g'),
    await f.svc.resume('u2', id),
    await f.svc.confirmCheckout('u2', id),
  ]) {
    assert.equal(r.ok, false);
    assert.equal((r as Service.ServiceError).status, 404);
  }
  assert.ok(!f.calls.some((c) => c.startsWith('cancel') || c.startsWith('update')), 'no Razorpay call for a foreign subscription');
  assert.equal((await f.svc.list('u2')).length, 0);
});

test('attach honours legacy prepaid time with start_at and blocks a second live mandate', async () => {
  const f = fixture();
  const paidUntil = new Date(NOW.getTime() + 10 * DAY).toISOString();
  f.instances.set('i1', { id: 'i1', userId: 'u1', name: 'legacy', status: 'running', paidUntil });
  const r = await f.svc.create(owner, { planId: 'hosting-4c8g', instanceId: 'i1' });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0], `create:plan_4:${Math.floor(Date.parse(paidUntil) / 1000)}`);
  const id = (r as { subscription: { id: string } }).subscription.id;
  await f.subs.get(id);
  f.subs.get(id)!.status = 'authenticated';
  const dup = await f.svc.create(owner, { planId: 'hosting-4c8g', instanceId: 'i1' });
  assert.equal((dup as Service.ServiceError).code, 'ALREADY_SUBSCRIBED');
});

test('webhook: same event id is processed once; charge provisions one workspace', async () => {
  const f = fixture();
  const created = (await f.svc.create(owner, { planId: 'hosting-4c8g', name: 'team' })) as { subscription: { id: string } };
  const id = created.subscription.id;
  const first = await f.svc.handleWebhookEvent('evt_1', chargedEvent(id));
  assert.equal(first.status, 'ok');
  const second = await f.svc.handleWebhookEvent('evt_1', chargedEvent(id));
  assert.equal(second.status, 'duplicate');
  assert.equal(f.provisioned(), 1);
  const sub = f.subs.get(id)!;
  assert.equal(sub.instanceId, 'inst_1');
  assert.equal(sub.status, 'active');
  const inst = f.instances.get('inst_1')!;
  assert.equal(inst.paidUntil, new Date(sec(30) * 1000).toISOString());
  assert.equal(inst.subscriptionId, id);
  assert.equal(inst.plan, 'hosting-4c8g');
  assert.equal(f.invoices.size, 1);
  // A different event for the same charge (e.g. activated) must not create a second workspace.
  await f.svc.handleWebhookEvent('evt_2', { event: 'subscription.activated', payload: chargedEvent(id).payload });
  assert.equal(f.provisioned(), 1);
});

test('webhook: in-flight event reports in_progress; failure releases the claim for retry', async () => {
  const f = fixture();
  f.events.set('evt_busy', 'processing');
  const busy = await f.svc.handleWebhookEvent('evt_busy', chargedEvent('sub_x'));
  assert.equal(busy.status, 'in_progress');
  const created = (await f.svc.create(owner, { planId: 'hosting-4c8g' })) as { subscription: { id: string } };
  const id = created.subscription.id;
  // Make provisioning fail once.
  let fail = true;
  const svc = f.svc as unknown as { handleWebhookEvent: typeof f.svc.handleWebhookEvent };
  const instancesSize = f.instances.size;
  const origSet = f.instances.set.bind(f.instances);
  f.instances.set = ((k: string, v: Service.ServiceInstance) => {
    if (fail) { fail = false; throw new Error('gateway down'); }
    return origSet(k, v);
  }) as typeof f.instances.set;
  await assert.rejects(() => svc.handleWebhookEvent('evt_fail', chargedEvent(id)), /gateway down/);
  assert.equal(f.events.has('evt_fail'), false, 'claim released');
  assert.equal(f.subs.get(id)!.provisioning, false);
  assert.equal(f.instances.size, instancesSize);
  const retry = await svc.handleWebhookEvent('evt_fail', chargedEvent(id));
  assert.equal(retry.status, 'ok');
  assert.ok(f.subs.get(id)!.instanceId);
});

test('webhook: unknown subscriptions without our notes are ignored; non-subscription events fall through', async () => {
  const f = fixture();
  const r = await f.svc.handleWebhookEvent('evt_9', chargedEvent('sub_foreign'));
  assert.equal(r.status, 'ignored');
  const legacy = await f.svc.handleWebhookEvent('evt_10', { event: 'payment.captured', payload: {} });
  assert.equal(legacy.handled, false);
});

test('halted → grace; cron pauses after grace, flags after retention; charge resumes', async () => {
  const f = fixture();
  f.instances.set('i1', { id: 'i1', userId: 'u1', name: 'ws', status: 'running', sandboxId: 'sbx', paidUntil: NOW.toISOString() });
  const created = (await f.svc.create(owner, { planId: 'hosting-4c8g', instanceId: 'i1' })) as { subscription: { id: string } };
  const id = created.subscription.id;
  f.subs.get(id)!.status = 'active';
  await f.svc.handleWebhookEvent('evt_h', { event: 'subscription.halted', payload: { subscription: { entity: { id, status: 'halted', plan_id: 'plan_4' } } } });
  assert.equal(f.instances.get('i1')!.graceUntil, new Date(NOW.getTime() + 3 * DAY).toISOString());
  assert.equal(f.instances.get('i1')!.billingStatus, 'grace');

  f.advance(2);
  await f.svc.runLifecycle();
  assert.equal(f.instances.get('i1')!.billingSuspendedAt, undefined, 'still inside grace');
  f.advance(4);
  await f.svc.runLifecycle();
  assert.ok(f.instances.get('i1')!.billingSuspendedAt);
  assert.ok(f.calls.includes('pause:i1'));
  f.advance(19);
  await f.svc.runLifecycle();
  assert.ok(f.instances.get('i1')!.deletionFlaggedAt);
  assert.equal(f.instances.has('i1'), true, 'lifecycle never deletes');

  f.advance(20);
  f.setRemote({ current_end: sec(50) });
  await f.svc.handleWebhookEvent('evt_c', chargedEvent(id, { current_start: sec(20), current_end: sec(50), charge_at: sec(50) }));
  const inst = f.instances.get('i1')!;
  assert.equal(inst.billingSuspendedAt, undefined);
  assert.equal(inst.deletionFlaggedAt, undefined);
  assert.equal(inst.graceUntil, undefined);
  assert.equal(inst.billingStatus, 'active');
});

test('cancel defaults to cycle end; change size: upgrade now, downgrade at cycle end, UPI refused', async () => {
  const f = fixture();
  f.instances.set('i1', { id: 'i1', userId: 'u1', name: 'ws', status: 'running' });
  const { subscription } = (await f.svc.create(owner, { planId: 'hosting-4c8g', instanceId: 'i1' })) as { subscription: { id: string } };
  const id = subscription.id;
  f.subs.get(id)!.status = 'active';
  f.setRemote({ status: 'active', plan_id: 'plan_4', current_end: sec(20) });

  const up = await f.svc.changeSize('u1', id, 'hosting-8c8g');
  assert.equal(up.ok, true);
  assert.equal((up as { scheduleChangeAt: string }).scheduleChangeAt, 'now');
  assert.equal(f.subs.get(id)!.planId, 'hosting-8c8g');

  f.setRemote({ plan_id: 'plan_8' });
  const down = await f.svc.changeSize('u1', id, 'hosting-2c4g');
  assert.equal((down as { scheduleChangeAt: string }).scheduleChangeAt, 'cycle_end');
  assert.equal(f.subs.get(id)!.pendingPlanId, 'hosting-2c4g');
  assert.equal(f.subs.get(id)!.planId, 'hosting-8c8g');

  const c = await f.svc.cancel('u1', id);
  assert.equal(c.ok, true);
  assert.ok(f.calls.includes(`cancel:${id}:true`));
  assert.equal(f.subs.get(id)!.cancelAtCycleEnd, true);
  assert.equal(f.instances.get('i1')!.cancelAtCycleEnd, true);

  const upi = fixture({ updateError: 'subscriptions cannot be updated when payment mode is UPI' });
  upi.instances.set('i1', { id: 'i1', userId: 'u1', name: 'ws', status: 'running' });
  const s2 = (await upi.svc.create(owner, { planId: 'hosting-4c8g', instanceId: 'i1' })) as { subscription: { id: string } };
  upi.subs.get(s2.subscription.id)!.status = 'active';
  const refused = await upi.svc.changeSize('u1', s2.subscription.id, 'hosting-8c8g');
  assert.equal((refused as Service.ServiceError).code, 'CHANGE_UNSUPPORTED_METHOD');
});

test('resume: paused resumes via Razorpay; halted returns the payment page', async () => {
  const f = fixture();
  f.instances.set('i1', { id: 'i1', userId: 'u1', name: 'ws', status: 'running' });
  const { subscription } = (await f.svc.create(owner, { planId: 'hosting-4c8g', instanceId: 'i1' })) as { subscription: { id: string } };
  f.subs.get(subscription.id)!.status = 'halted';
  const halted = await f.svc.resume('u1', subscription.id);
  assert.equal((halted as { paymentUrl: string }).paymentUrl, 'https://rzp.io/i/x');
  f.subs.get(subscription.id)!.status = 'paused';
  const resumed = await f.svc.resume('u1', subscription.id);
  assert.equal((resumed as { subscription: { status: string } }).subscription.status, 'active');
});
