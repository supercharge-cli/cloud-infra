import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getPlan, hasInstanceAccess } from '@/lib/billing';
import { updateCliInSandbox, wakeSession } from '@/lib/gateway-client';
import { getInstance, publicInstance, updateInstance } from '@/lib/store';

/** npm install + daemon restart can be slow */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }
  if (inst.status === 'destroyed') {
    return NextResponse.json({ error: 'Instance destroyed' }, { status: 410 });
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: 'Subscription expired',
        message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to update the CLI.`,
        code: 'PAYMENT_REQUIRED',
        paidUntil: inst.paidUntil || null,
      },
      { status: 402 },
    );
  }

  let body: { version?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const version = body.version?.trim().replace(/^v/, '') || undefined;
  if (version && !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return NextResponse.json({ error: 'Invalid version' }, { status: 400 });
  }

  try {
    // Wake paused sandboxes first (same path as Telegram / dashboard wake)
    const wake = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      restartDaemon: false,
    });
    const wakeLogs = wake.logs || [];

    const result = await updateCliInSandbox(inst.sessionId, {
      sandboxId: inst.sandboxId,
      version,
    });

    const logs = [
      wake.ok === false
        ? `wake: ${wake.message || 'not ok'} · state=${wake.state || '?'}`
        : `wake: ok state=${wake.state || '?'} resumed=${wake.resumed ? 'yes' : 'no'}`,
      ...wakeLogs,
      ...result.logs,
    ];

    await updateInstance(user.id, inst.id, {
      status: result.ok ? 'running' : 'error',
      lastError: result.ok
        ? undefined
        : logs.join('\n').slice(0, 500),
    }).catch(() => undefined);

    return NextResponse.json(
      {
        ok: result.ok,
        from: result.from,
        to: result.to,
        verified: result.verified,
        logs,
        instance: publicInstance(inst),
        ...(result.ok
          ? {}
          : {
              error: `CLI update did not reach target (from ${result.from || '?'} verified ${result.verified || '?'} wanted ${version || result.to || 'latest'})`,
            }),
      },
      { status: result.ok ? 200 : 502 },
    );
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await updateInstance(user.id, inst.id, {
      status: 'error',
      lastError: msg,
    }).catch(() => undefined);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
