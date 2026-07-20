import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { billingStatusFromPaidUntil, isSubscriptionActive, PLAN, priceForCurrency } from '@/lib/billing';
import { getSandboxState } from '@/lib/gateway-client';
import {
  listInstances,
  publicInstance,
  updateInstance,
  type Instance,
  type InstanceStatus,
} from '@/lib/store';

function mapE2bToStatus(state: string, prev: InstanceStatus): InstanceStatus {
  if (state === 'paused') return 'paused';
  if (state === 'running') return 'running';
  if (state === 'missing') return 'error';
  return prev;
}

/** List always returns Mongo-owned instances (including paused) so the user can resume. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const rows = await listInstances(user.id);
  const instances = await Promise.all(
    rows.map(async (inst) => {
      let liveState: string | undefined;
      let resumable = true;
      let liveMessage: string | undefined;

      // Sync billing status from paidUntil
      const billingStatus = billingStatusFromPaidUntil(inst.paidUntil);
      if (inst.billingStatus !== billingStatus) {
        const u = await updateInstance(user.id, inst.id, { billingStatus });
        if (u) Object.assign(inst, u);
      }

      if (inst.sandboxId && inst.status !== 'destroyed') {
        try {
          const live = await getSandboxState(inst.sandboxId);
          liveState = live.state;
          resumable = live.resumable;
          liveMessage = live.message;

          const nextStatus = mapE2bToStatus(live.state, inst.status);
          if (nextStatus !== inst.status) {
            const updated = await updateInstance(user.id, inst.id, {
              status: nextStatus,
              lastError:
                live.state === 'missing'
                  ? (live.message || 'Sandbox no longer exists on E2B').slice(0, 500)
                  : nextStatus === 'paused'
                    ? undefined
                    : inst.lastError,
            });
            if (updated) Object.assign(inst, updated);
          }
        } catch {
          liveState = 'unknown';
          resumable = true;
        }
      }

      return {
        ...publicInstance(inst as Instance),
        liveState: liveState || inst.status,
        resumable,
        liveMessage,
        paid: isSubscriptionActive(inst.paidUntil),
        billingStatus: billingStatusFromPaidUntil(inst.paidUntil),
      };
    }),
  );

  return NextResponse.json({
    instances,
    plan: {
      priceInr: PLAN.priceInr,
      priceUsd: PLAN.priceUsd,
      periodDays: PLAN.periodDays,
      label: PLAN.label,
      currencies: {
        INR: priceForCurrency('INR'),
        USD: priceForCurrency('USD'),
      },
    },
  });
}

/**
 * Free create is disabled. Use POST /api/billing/create-order + verify.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Payment required',
      message: `Each instance is ₹${PLAN.priceInr} or $${PLAN.priceUsd}/month. Use billing checkout to create one.`,
      plan: PLAN,
    },
    { status: 402 },
  );
}
