/** Production wiring for the subscription service (Mongo + Razorpay + gateway). */
import { listPlans, planById, subscriptionBillingConfig } from './billing';
import { provisionPaidWorkspace } from './billing-fulfill';
import { pauseSandbox } from './gateway-client';
import { getDb } from './mongodb';
import {
  cancelRazorpaySubscription,
  createRazorpaySubscription,
  fetchRazorpaySubscription,
  publicRazorpayKeyId,
  resumeRazorpaySubscription,
  updateRazorpaySubscription,
} from './razorpay';
import {
  countInstancesForUser,
  getInstance,
  getInstanceById,
  listInstancesForUser,
  updateInstanceBilling,
  type Instance,
} from './store';
import {
  LIVE_STATUSES,
  razorpayPlanIdFromEnv,
  sizeForRazorpayPlanId,
  type SubscriptionRecord,
} from './subscription-core';
import { createSubscriptionService, type EventClaim, type ServiceInstance, type SubscriptionDeps } from './subscription-service';
import { withWorkspaceCreation, WorkspaceLimitError } from './workspace-limit';

const SUBS = 'subscriptions';
const EVENTS = 'billing_events';
const INVOICES = 'subscription_invoices';
/** A webhook still "processing" after this is assumed crashed and retried. */
const STALE_CLAIM_MS = 5 * 60_000;
const STALE_PROVISION_MS = 10 * 60_000;

let indexesReady: Promise<void> | null = null;
async function db() {
  const database = await getDb();
  if (!indexesReady) {
    indexesReady = Promise.all([
      database.collection(SUBS).createIndex({ id: 1 }, { unique: true }),
      database.collection(SUBS).createIndex({ userId: 1, createdAt: -1 }),
      database.collection(SUBS).createIndex({ instanceId: 1, status: 1 }),
      database.collection(INVOICES).createIndex({ paymentId: 1 }, { unique: true }),
      database.collection('instances').createIndex({ subscriptionId: 1 }, { sparse: true }),
    ])
      .then(() => undefined)
      .catch((e) => {
        indexesReady = null;
        console.warn('[subscriptions] index setup failed:', (e as Error).message);
      });
  }
  await indexesReady;
  return database;
}

function strip<T>(doc: (T & { _id?: unknown }) | null): T | null {
  if (!doc) return null;
  const { _id: _drop, ...rest } = doc;
  return rest as T;
}

function toServiceInstance(inst: Instance | null): ServiceInstance | null {
  return inst as unknown as ServiceInstance | null;
}

export function subscriptionsConfigured(): boolean {
  return listPlans().some((p) => Boolean(razorpayPlanIdFromEnv(process.env, p.id, 'INR')));
}

function buildDeps(): SubscriptionDeps {
  const sizeIds = listPlans().map((p) => p.id);
  const cfg = subscriptionBillingConfig();
  return {
    now: () => new Date(),
    config: cfg,
    publicKeyId: publicRazorpayKeyId,
    sizes: {
      byId: (id) => {
        if (!id || !sizeIds.includes(id)) return null;
        const p = planById(id);
        return { id: p.id, name: p.name, priceInr: p.priceInr, priceUsd: p.priceUsd };
      },
      all: () => listPlans().map((p) => ({ id: p.id, name: p.name, priceInr: p.priceInr, priceUsd: p.priceUsd })),
      razorpayPlanId: (sizeId, currency) => razorpayPlanIdFromEnv(process.env, sizeId, currency),
      sizeForRazorpayPlan: (rzp) => sizeForRazorpayPlanId(process.env, sizeIds, rzp),
    },
    subs: {
      async insert(rec) {
        await (await db()).collection<SubscriptionRecord>(SUBS).insertOne({ ...rec });
      },
      async get(id) {
        return strip(await (await db()).collection<SubscriptionRecord>(SUBS).findOne({ id }));
      },
      async findOwned(userId, id) {
        return strip(await (await db()).collection<SubscriptionRecord>(SUBS).findOne({ id, userId }));
      },
      async listForUser(userId) {
        const rows = await (await db())
          .collection<SubscriptionRecord>(SUBS)
          .find({ userId })
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray();
        return rows.map((r) => strip(r) as SubscriptionRecord);
      },
      async update(id, patch) {
        const $set: Record<string, unknown> = {};
        const $unset: Record<string, ''> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'id' || k === 'userId') continue;
          if (v === null) $unset[k] = '';
          else if (v !== undefined) $set[k] = v;
        }
        const r = await (await db())
          .collection<SubscriptionRecord>(SUBS)
          .findOneAndUpdate({ id }, Object.keys($unset).length ? { $set, $unset } : { $set }, { returnDocument: 'after' });
        return strip(r as SubscriptionRecord | null);
      },
      async liveForInstance(instanceId) {
        return strip(
          await (await db())
            .collection<SubscriptionRecord>(SUBS)
            .findOne({ instanceId, status: { $in: [...LIVE_STATUSES, 'created'] } }, { sort: { createdAt: -1 } }),
        );
      },
      async claimProvision(id, now) {
        const stale = new Date(now.getTime() - STALE_PROVISION_MS).toISOString();
        const r = await (await db()).collection<SubscriptionRecord>(SUBS).findOneAndUpdate(
          {
            id,
            $and: [
              { $or: [{ instanceId: { $exists: false } }, { instanceId: null }] },
              { $or: [{ provisioning: { $ne: true } }, { provisioningAt: { $lt: stale } }] },
            ],
          },
          { $set: { provisioning: true, provisioningAt: now.toISOString() } },
          { returnDocument: 'after' },
        );
        return Boolean(r);
      },
      async releaseProvision(id) {
        await (await db()).collection(SUBS).updateOne({ id }, { $set: { provisioning: false }, $unset: { provisioningAt: '' } });
      },
      async listUnprovisioned(limit) {
        const rows = await (await db())
          .collection<SubscriptionRecord>(SUBS)
          .find({
            purpose: 'new_instance',
            status: { $in: ['authenticated', 'active'] },
            $or: [{ instanceId: { $exists: false } }, { instanceId: null }],
          })
          .limit(limit)
          .toArray();
        return rows.map((r) => strip(r) as SubscriptionRecord);
      },
    },
    events: {
      async claim(eventId, meta): Promise<EventClaim> {
        const col = (await db()).collection<{ _id: string; state: string; claimedAt: Date; event: string; subscriptionId?: string }>(EVENTS);
        const now = new Date();
        try {
          await col.insertOne({ _id: eventId, state: 'processing', claimedAt: now, ...meta });
          return 'claimed';
        } catch (e) {
          if ((e as { code?: number }).code !== 11000) throw e;
        }
        const existing = await col.findOne({ _id: eventId });
        if (existing?.state === 'done') return 'done';
        // Take over a crashed claim.
        const taken = await col.findOneAndUpdate(
          { _id: eventId, state: 'processing', claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
          { $set: { claimedAt: now } },
        );
        return taken ? 'claimed' : 'processing';
      },
      async complete(eventId) {
        await (await db()).collection<{ _id: string }>(EVENTS).updateOne({ _id: eventId }, { $set: { state: 'done', doneAt: new Date() } });
      },
      async release(eventId) {
        await (await db()).collection<{ _id: string }>(EVENTS).deleteOne({ _id: eventId, state: 'processing' });
      },
    },
    invoices: {
      async record(doc) {
        await (await db()).collection(INVOICES).updateOne({ paymentId: doc.paymentId }, { $setOnInsert: doc }, { upsert: true });
      },
    },
    instances: {
      getOwned: async (userId, id) => toServiceInstance(await getInstance(userId, id)),
      getById: async (id) => toServiceInstance(await getInstanceById(id)),
      update: (id, patch) => updateInstanceBilling(id, patch as Partial<Instance>),
      async listManaged(limit) {
        const rows = await (await db())
          .collection<Instance>('instances')
          .find({
            status: { $ne: 'destroyed' },
            subscriptionId: { $type: 'string' },
            deletionFlaggedAt: { $exists: false },
          })
          .limit(limit)
          .toArray();
        return rows.map((r) => strip(r) as unknown as ServiceInstance);
      },
    },
    razorpay: {
      create: createRazorpaySubscription,
      fetch: fetchRazorpaySubscription,
      cancel: cancelRazorpaySubscription,
      update: updateRazorpaySubscription,
      resume: resumeRazorpaySubscription,
    },
    countWorkspaces: countInstancesForUser,
    async provision(sub) {
      try {
        return await withWorkspaceCreation(sub.userId, async () => {
          const inst = await provisionPaidWorkspace({
            userId: sub.userId,
            name: sub.instanceName,
            runtime: 'supercharge',
            planId: sub.planId,
          });
          return { instanceId: inst.id };
        });
      } catch (e) {
        if (!(e instanceof WorkspaceLimitError)) throw e;
        // The account got a workspace between checkout and payment (one per
        // account): the subscription pays for that one instead.
        const existing = (await listInstancesForUser(sub.userId)).find((i) => i.status !== 'destroyed');
        if (!existing) throw e;
        await (await db()).collection(SUBS).updateOne({ id: sub.id }, { $set: { purpose: 'attach' } });
        return { instanceId: existing.id };
      }
    },
    async pauseSandbox(inst) {
      if (!inst.sandboxId) return;
      const r = await pauseSandbox(inst.sandboxId);
      if (!r.ok) console.warn(`[subscriptions] pause ${inst.id} not confirmed: ${r.message || 'unknown'}`);
    },
    log: (m) => console.warn(m),
  };
}

let service: ReturnType<typeof createSubscriptionService> | null = null;
export function subscriptionService() {
  if (!service) service = createSubscriptionService(buildDeps());
  return service;
}
