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

export async function ensureInbox(inst: Instance): Promise<void> {
  try {
    const health = await appInboxFetch(
      inst.sessionId,
      '/health',
      { signal: AbortSignal.timeout(4_000) },
      { sandboxId: inst.sandboxId },
    );
    if (health.ok) return;
  } catch {
    /* wake only when inbox is actually down */
  }
  await bootstrapAppInbox(inst.sessionId, inst.sandboxId).catch(() => undefined);
  await wakeSession(inst.sessionId, {
    sandboxId: inst.sandboxId,
    restartDaemon: true,
  });
}

export async function proxyInbox(
  inst: Instance,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  await ensureInbox(inst);
  return appInboxFetch(inst.sessionId, path, init, { sandboxId: inst.sandboxId });
}
