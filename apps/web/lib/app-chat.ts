import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getPlan, hasInstanceAccess } from '@/lib/billing';
import {
  appInboxFetch,
  bootstrapAppInbox,
  wakeSession,
} from '@/lib/gateway-client';
import { getInstance, type Instance } from '@/lib/store';

export async function requireChatInstance(id: string): Promise<
  | { ok: true; inst: Instance }
  | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Login required' }, { status: 401 }),
    };
  }
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Instance not found' }, { status: 404 }),
    };
  }
  if (inst.status === 'destroyed') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Instance destroyed' }, { status: 410 }),
    };
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Subscription expired',
          message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to chat.`,
          code: 'PAYMENT_REQUIRED',
          paidUntil: inst.paidUntil || null,
        },
        { status: 402 },
      ),
    };
  }
  return { ok: true, inst };
}

async function inboxHealthy(inst: Instance): Promise<boolean> {
  try {
    const health = await appInboxFetch(
      inst.sessionId,
      '/health',
      { signal: AbortSignal.timeout(5_000) },
      { sandboxId: inst.sandboxId },
    );
    return health.ok;
  } catch {
    return false;
  }
}

const inboxLocks = new Map<string, Promise<void>>();

export async function ensureInbox(inst: Instance): Promise<void> {
  const key = inst.id;
  const pending = inboxLocks.get(key);
  if (pending) {
    await pending;
    if (await inboxHealthy(inst)) return;
  }

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  inboxLocks.set(key, gate);

  try {
    if (await inboxHealthy(inst)) return;

    await bootstrapAppInbox(inst.sessionId, inst.sandboxId, inst.id).catch(() => undefined);
    await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: true,
    });

    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 750));
      if (await inboxHealthy(inst)) return;
    }

    throw new Error(
      'App inbox not reachable on :8790 after wake. Open Control → Update CLI (need xibecode 1.17.5+) then try chat again.',
    );
  } finally {
    release();
    if (inboxLocks.get(key) === gate) inboxLocks.delete(key);
  }
}

export async function proxyInbox(
  inst: Instance,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  await ensureInbox(inst);
  return appInboxFetch(inst.sessionId, path, init, { sandboxId: inst.sandboxId });
}
