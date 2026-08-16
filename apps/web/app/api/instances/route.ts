import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import {
  billingStatusForInstance,
  freeInstanceLimit,
  getPlan,
  hasInstanceAccess,
  priceForCurrency,
} from '@/lib/billing';
import {
  bootstrapAppInbox,
  createGatewaySession,
  destroyGatewaySession,
  getSandboxState,
} from '@/lib/gateway-client';
import { syncTelegramWakeWebhook } from '@/lib/telegram-webhook';
import {
  countFreeInstancesForUser,
  createInstanceRecord,
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

async function refreshLiveStates(userId: string, rows: Instance[]): Promise<void> {
  await Promise.all(
    rows.map(async (inst) => {
      if (!inst.sandboxId || inst.status === 'destroyed') return;
      try {
        const live = await getSandboxState(inst.sandboxId);
        const nextStatus = mapE2bToStatus(live.state, inst.status);
        if (nextStatus !== inst.status) {
          await updateInstance(userId, inst.id, {
            status: nextStatus,
            lastError:
              live.state === 'missing'
                ? (live.message || 'Sandbox no longer exists on the cloud provider').slice(0, 500)
                : nextStatus === 'paused'
                  ? undefined
                  : inst.lastError,
          });
        }
        if (
          inst.telegramBotToken &&
          (live.state === 'paused' || live.state === 'running')
        ) {
          void syncTelegramWakeWebhook({
            botToken: inst.telegramBotToken,
            instanceId: inst.id,
            wakeSecret: inst.wakeSecret,
            sandboxState: live.state,
          }).catch(() => undefined);
        }
      } catch {
        /* next list/refresh will retry */
      }
    }),
  );
}

/** List always returns Mongo-owned instances (including paused) so the user can resume. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const freeLimit = freeInstanceLimit();
  const freeUsed = await countFreeInstancesForUser(user.id);
  const freeAvailable = Math.max(0, freeLimit - freeUsed);

  const rows = await listInstances(user.id);

  // Do not wait on E2B here — one live probe per sandbox is 1–3s and
  // makes the dashboard/app feel like "the DB is slow". Return Mongo
  // status immediately; refresh live state in the background.
  const instances = rows.map((inst) => {
    const billingStatus = billingStatusForInstance(inst);
    if (inst.billingStatus !== billingStatus) {
      void updateInstance(user.id, inst.id, { billingStatus }).catch(() => undefined);
    }
    return {
      ...publicInstance(inst as Instance),
      liveState: inst.status,
      resumable: inst.status !== 'destroyed' && inst.status !== 'missing',
      paid: hasInstanceAccess(inst),
      isFree: Boolean(inst.isFree),
      billingStatus,
    };
  });

  void refreshLiveStates(user.id, rows).catch(() => undefined);

  const plan = getPlan();
  return NextResponse.json({
    instances,
    freeQuota: {
      limit: freeLimit,
      used: freeUsed,
      available: freeAvailable,
    },
    plan: {
      priceInr: plan.priceInr,
      priceUsd: plan.priceUsd,
      periodDays: plan.periodDays,
      label: plan.label,
      currencies: {
        INR: priceForCurrency('INR'),
        USD: priceForCurrency('USD'),
      },
    },
  });
}

/**
 * Create one free instance per user (when free quota remains).
 * Extra instances require POST /api/billing/create-order + verify.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }

  const freeLimit = freeInstanceLimit();
  const freeUsed = await countFreeInstancesForUser(user.id);
  if (freeLimit <= 0 || freeUsed >= freeLimit) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: 'Payment required',
        message:
          freeLimit <= 0
            ? `Each instance is ₹${plan.priceInr} or $${plan.priceUsd}/month. Use billing checkout to create one.`
            : `You've used your free instance (${freeLimit}). Extra instances are ₹${plan.priceInr} or $${plan.priceUsd}/month — use Pay & create.`,
        code: 'PAYMENT_REQUIRED',
        freeQuota: { limit: freeLimit, used: freeUsed, available: 0 },
        plan,
      },
      { status: 402 },
    );
  }

  let name = 'workspace';
  try {
    const body = (await req.json()) as { name?: string };
    if (body?.name) name = String(body.name).trim().slice(0, 64) || 'workspace';
  } catch {
    /* empty body ok */
  }

  try {
    const session = await createGatewaySession({ strategy: 'sandbox_full' });

    // Re-check after slow provision so two parallel requests don't both get free slots
    const freeUsedAfter = await countFreeInstancesForUser(user.id);
    if (freeUsedAfter >= freeLimit) {
      try {
        await destroyGatewaySession(session.sessionId);
      } catch {
        /* best-effort cleanup */
      }
      const plan = getPlan();
      return NextResponse.json(
        {
          error: 'Payment required',
          message: `You've used your free instance (${freeLimit}). Extra instances are ₹${plan.priceInr} or $${plan.priceUsd}/month — use Pay & create.`,
          code: 'PAYMENT_REQUIRED',
          freeQuota: { limit: freeLimit, used: freeUsedAfter, available: 0 },
          plan,
        },
        { status: 402 },
      );
    }

    const instance = await createInstanceRecord({
      userId: user.id,
      name,
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
      isFree: true,
    });

    await bootstrapAppInbox(session.sessionId, session.sandboxId).catch(
      () => undefined,
    );

    return NextResponse.json(
      {
        instance: {
          ...publicInstance(instance),
          paid: true,
          isFree: true,
          billingStatus: 'active' as const,
        },
        freeQuota: {
          limit: freeLimit,
          used: freeUsedAfter + 1,
          available: Math.max(0, freeLimit - freeUsedAfter - 1),
        },
      },
      { status: 201 },
    );
  } catch (e) {
    console.error('[instances/POST free]', e);
    return NextResponse.json(
      { error: (e as Error).message || 'Failed to create free instance' },
      { status: 502 },
    );
  }
}
