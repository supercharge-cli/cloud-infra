import assert from 'node:assert/strict';
import { test } from 'node:test';
const { loadLib } = (await import(new URL('./subscription-test-loader.ts', import.meta.url).href)) as typeof import('./subscription-test-loader');
import type * as Core from './subscription-core';

const core = loadLib<typeof Core>('subscription-core');
const NOW = new Date('2026-11-19T10:00:00.000Z');
const DAY = 86_400_000;
const cfg = { graceDays: 3, retentionDays: 14 };
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const plus = (days: number) => new Date(NOW.getTime() + days * DAY);

function sub(over: Partial<Core.SubscriptionRecord> = {}): Core.SubscriptionRecord {
  return {
    id: 'sub_1', userId: 'u1', planId: 'hosting-4c8g', razorpayPlanId: 'plan_4', currency: 'INR',
    purpose: 'attach', instanceId: 'i1', instanceName: 'ws', runtime: 'supercharge', status: 'created',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  };
}
const planFor = (id?: string | null) => ({ plan_4: 'hosting-4c8g', plan_8: 'hosting-8c8g' } as Record<string, string>)[id || ''] || null;
const apply = (type: Core.SubscriptionEventType, s: Core.SubscriptionRecord, inst: Core.InstanceBilling | null, entity: Partial<Core.RazorpaySubscriptionEntity>) =>
  core.applySubscriptionEvent({ type, sub: s, instance: inst, entity: { id: s.id, ...entity }, now: NOW, config: cfg, planForRazorpayPlan: planFor });

test('env plan mapping per size and currency', () => {
  const env = { RAZORPAY_PLAN_ID_4C8G: 'plan_4', RAZORPAY_PLAN_ID_16C16G_USD: 'plan_16u' };
  assert.equal(core.planEnvKey('hosting-16c16g', 'USD'), 'RAZORPAY_PLAN_ID_16C16G_USD');
  assert.equal(core.razorpayPlanIdFromEnv(env, 'hosting-4c8g'), 'plan_4');
  assert.equal(core.razorpayPlanIdFromEnv(env, 'hosting-8c8g'), null);
  assert.equal(core.sizeForRazorpayPlanId(env, ['hosting-4c8g', 'hosting-16c16g'], 'plan_16u'), 'hosting-16c16g');
});

test('charged extends paidUntil to current_end, clears grace and suspension, upgrades free base', () => {
  const r = apply('subscription.charged', sub({ status: 'active' }), {
    isFree: true, graceUntil: plus(1).toISOString(), billingSuspendedAt: NOW.toISOString(), retainUntil: plus(10).toISOString(),
  }, { status: 'active', plan_id: 'plan_4', current_start: sec(NOW), current_end: sec(plus(30)), charge_at: sec(plus(30)) });
  assert.equal(r.instance.paidUntil, plus(30).toISOString());
  assert.equal(r.instance.graceUntil, null);
  assert.equal(r.instance.billingSuspendedAt, null);
  assert.equal(r.instance.retainUntil, null);
  assert.equal(r.instance.isFree, false);
  assert.equal(r.instance.wasFree, true);
  assert.equal(r.instance.plan, 'hosting-4c8g');
  assert.equal(r.instance.nextChargeAt, plus(30).toISOString());
  assert.equal(r.provision, false);
});

test('paidUntil never moves backwards (legacy prepaid time is kept)', () => {
  const r = apply('subscription.charged', sub({ status: 'active' }), { paidUntil: plus(40).toISOString() },
    { status: 'active', current_end: sec(plus(30)) });
  assert.equal(r.instance.paidUntil, plus(40).toISOString());
});

test('pending/halted start one grace window from the paid end', () => {
  const paidUntil = NOW.toISOString();
  const r = apply('subscription.halted', sub({ status: 'pending' }), { paidUntil }, { status: 'halted' });
  assert.equal(r.sub.status, 'halted');
  assert.equal(r.instance.graceUntil, plus(3).toISOString());
  assert.equal(r.instance.billingStatus, 'grace');
  const again = apply('subscription.halted', sub({ status: 'halted' }), { paidUntil, graceUntil: plus(1).toISOString() }, { status: 'halted' });
  assert.equal(again.instance.graceUntil, undefined, 'existing grace is not extended');
});

test('out-of-order events never revive a cancelled subscription or step back to authenticated', () => {
  assert.equal(core.nextStatus('cancelled', 'active'), 'cancelled');
  assert.equal(core.nextStatus('active', 'authenticated'), 'active');
  assert.equal(core.nextStatus('authenticated', 'active'), 'active');
  const r = apply('subscription.charged', sub({ status: 'cancelled' }), { paidUntil: plus(2).toISOString() },
    { status: 'active', current_end: sec(plus(32)) });
  assert.equal(r.sub.status, 'cancelled');
  assert.equal(r.instance.paidUntil, undefined);
});

test('cancel keeps access to the period end, then the cron pauses and retention flags', () => {
  const paidUntil = plus(5).toISOString();
  const r = apply('subscription.cancelled', sub({ status: 'active' }), { paidUntil }, { status: 'cancelled', ended_at: sec(NOW) });
  assert.equal(r.sub.status, 'cancelled');
  assert.equal(r.instance.nextChargeAt, null);
  const inst: Core.InstanceBilling = { paidUntil, subscriptionId: 'sub_1' };
  assert.equal(core.computeAccess(inst, NOW), true);
  assert.deepEqual(core.lifecycleDecision(inst, 'cancelled', NOW, cfg), { action: 'none' });
  const later = plus(6);
  const suspend = core.lifecycleDecision(inst, 'cancelled', later, cfg);
  assert.equal(suspend.action, 'suspend');
  const suspended = { ...inst, ...(suspend as { patch: Core.InstanceBilling }).patch };
  assert.equal(core.computeAccess(suspended, later), false);
  assert.equal(core.computeBillingStatus(suspended, later), 'suspended');
  assert.equal(suspended.retainUntil, new Date(later.getTime() + 14 * DAY).toISOString());
  assert.deepEqual(core.lifecycleDecision(suspended, 'cancelled', plus(10), cfg), { action: 'none' });
  const flag = core.lifecycleDecision(suspended, 'cancelled', plus(21), cfg);
  assert.equal(flag.action, 'flag_deletion');
});

test('cron gives a live mandate a grace window after the period ends', () => {
  const inst = { paidUntil: plus(-1).toISOString(), subscriptionId: 'sub_1' };
  const d = core.lifecycleDecision(inst, 'active', NOW, cfg);
  assert.equal(d.action, 'start_grace');
  assert.equal((d as { patch: Core.InstanceBilling }).patch.graceUntil, plus(2).toISOString());
  const graceOver = { ...inst, graceUntil: plus(-0.1).toISOString() };
  assert.equal(core.lifecycleDecision(graceOver, 'halted', NOW, cfg).action, 'suspend');
});

test('an upgraded free base falls back to free instead of pausing', () => {
  const d = core.lifecycleDecision({ paidUntil: plus(-1).toISOString(), wasFree: true, subscriptionId: 'sub_1' }, 'cancelled', NOW, cfg);
  assert.equal(d.action, 'revert_free');
  const patch = (d as { patch: Core.InstanceBilling }).patch;
  assert.equal(patch.isFree, true);
  assert.equal(patch.plan, 'hosting-2c4g');
  assert.equal(patch.subscriptionId, null);
});

test('legacy one-off workspaces: access by paidUntil only', () => {
  assert.equal(core.computeAccess({ paidUntil: plus(1).toISOString() }, NOW), true);
  assert.equal(core.computeAccess({ paidUntil: plus(-1).toISOString() }, NOW), false);
  assert.equal(core.computeBillingStatus({ paidUntil: plus(-1).toISOString() }, NOW), 'past_due');
  assert.equal(core.computeAccess({ isFree: true }, NOW), true);
});

test('new-workspace subscription asks for provisioning once active', () => {
  const s = sub({ purpose: 'new_instance', instanceId: null, status: 'authenticated' });
  assert.equal(apply('subscription.authenticated', s, null, { status: 'authenticated' }).provision, false);
  assert.equal(apply('subscription.activated', s, null, { status: 'active', current_end: sec(plus(30)) }).provision, true);
});

test('scheduled downgrade clears once Razorpay applies the new plan', () => {
  const s = sub({ status: 'active', planId: 'hosting-8c8g', razorpayPlanId: 'plan_8', pendingPlanId: 'hosting-4c8g' });
  const r = apply('subscription.updated', s, { paidUntil: plus(20).toISOString() }, { status: 'active', plan_id: 'plan_4', has_scheduled_changes: false });
  assert.equal(r.sub.planId, 'hosting-4c8g');
  assert.equal(r.sub.pendingPlanId, null);
  assert.equal(r.instance.plan, 'hosting-4c8g');
});

test('upgrade now, downgrade at cycle end; UPI/e-mandate update errors detected', () => {
  assert.equal(core.scheduleForChange(399, 599), 'now');
  assert.equal(core.scheduleForChange(599, 399), 'cycle_end');
  assert.equal(core.isUpdateUnsupportedError('subscriptions cannot be updated when payment mode is UPI'), true);
  assert.equal(core.isUpdateUnsupportedError('subscriptions cannot be updated when payment mode is emandate.'), true);
  assert.equal(core.isUpdateUnsupportedError('Request failed because another subscription operation is in progress.'), false);
});
