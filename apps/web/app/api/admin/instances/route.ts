import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  adminDestroyInstance,
  adminExecOnInstance,
  adminProvisionInstance,
  adminReassignInstance,
  adminRestartDaemon,
  adminWakeInstance,
  isSubscriptionActive,
  publicInstance,
} from '@/lib/admin-ops';
import {
  adminUpdateInstance,
  getInstanceById,
  listAllInstances,
  listAllUsers,
} from '@/lib/store';

function errRes(e: unknown) {
  const err = e as Error & { status?: number };
  return NextResponse.json(
    { error: err.message || 'Forbidden' },
    { status: err.status || 500 },
  );
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const includeDestroyed = url.searchParams.get('destroyed') === '1';
    const userId = url.searchParams.get('userId')?.trim() || '';
    const [instances, users] = await Promise.all([
      listAllInstances({ includeDestroyed: includeDestroyed || Boolean(userId), limit: 500 }),
      listAllUsers(),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    let list = instances;
    if (userId) list = list.filter((i) => i.userId === userId);
    return NextResponse.json({
      instances: list.map((inst) => ({
        ...publicInstance(inst),
        ownerEmail: emailById.get(inst.userId) || null,
        paid: inst.isFree || isSubscriptionActive(inst.paidUntil),
        isFree: Boolean(inst.isFree),
        sessionId: inst.sessionId,
      })),
    });
  } catch (e) {
    return errRes(e);
  }
}

/** Admin provision: create sandbox for any user (no payment). */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      userId?: string;
      email?: string;
      name?: string;
      days?: number;
      createUserIfMissing?: boolean;
      password?: string;
    };
    const result = await adminProvisionInstance({
      userId: body.userId,
      email: body.email,
      name: body.name,
      days: body.days,
      createUserIfMissing: body.createUserIfMissing,
      password: body.password,
    });
    return NextResponse.json({
      ok: true,
      instance: { ...result.instance, paid: true },
      owner: result.owner,
      createdUser: result.createdUser,
    });
  } catch (e) {
    return errRes(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      instanceId?: string;
      action?:
        | 'extend'
        | 'set_paid_until'
        | 'mark_unpaid'
        | 'set_status'
        | 'rename'
        | 'wake'
        | 'restart'
        | 'reassign'
        | 'exec';
      paidUntil?: string;
      days?: number;
      status?: string;
      name?: string;
      newUserId?: string;
      command?: string;
      cwd?: string;
      timeout?: number;
    };
    const instanceId = String(body.instanceId || '').trim();
    if (!instanceId || !body.action) {
      return NextResponse.json({ error: 'instanceId and action required' }, { status: 400 });
    }
    const inst = await getInstanceById(instanceId);
    if (!inst) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });

    if (body.action === 'extend') {
      const days = Math.max(1, Math.min(3650, Math.round(Number(body.days) || 30)));
      const base =
        inst.paidUntil && Date.parse(inst.paidUntil) > Date.now()
          ? new Date(inst.paidUntil)
          : new Date();
      const paidUntil = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
      const next = await adminUpdateInstance(instanceId, {
        paidUntil,
        billingStatus: 'active',
      });
      return NextResponse.json({
        instance: next ? { ...publicInstance(next), paid: true } : null,
      });
    }

    if (body.action === 'set_paid_until') {
      const paidUntil = String(body.paidUntil || '').trim();
      if (!paidUntil || Number.isNaN(Date.parse(paidUntil))) {
        return NextResponse.json({ error: 'valid paidUntil ISO date required' }, { status: 400 });
      }
      const next = await adminUpdateInstance(instanceId, {
        paidUntil,
        billingStatus: isSubscriptionActive(paidUntil) ? 'active' : 'past_due',
      });
      return NextResponse.json({
        instance: next
          ? { ...publicInstance(next), paid: isSubscriptionActive(next.paidUntil) }
          : null,
      });
    }

    if (body.action === 'mark_unpaid') {
      const next = await adminUpdateInstance(instanceId, {
        paidUntil: new Date(0).toISOString(),
        billingStatus: 'past_due',
      });
      return NextResponse.json({
        instance: next ? { ...publicInstance(next), paid: false } : null,
      });
    }

    if (body.action === 'set_status') {
      const status = String(body.status || '').trim();
      const allowed = ['running', 'paused', 'error', 'destroyed', 'creating'];
      if (!allowed.includes(status)) {
        return NextResponse.json({ error: 'invalid status' }, { status: 400 });
      }
      const next = await adminUpdateInstance(instanceId, {
        status: status as 'running' | 'paused' | 'error' | 'destroyed' | 'creating',
      });
      return NextResponse.json({ instance: next ? publicInstance(next) : null });
    }

    if (body.action === 'rename') {
      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
      const next = await adminUpdateInstance(instanceId, { name });
      return NextResponse.json({ instance: next ? publicInstance(next) : null });
    }

    if (body.action === 'wake') {
      const result = await adminWakeInstance(instanceId);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.action === 'restart') {
      const result = await adminRestartDaemon(instanceId);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.action === 'reassign') {
      const newUserId = String(body.newUserId || '').trim();
      if (!newUserId) {
        return NextResponse.json({ error: 'newUserId required' }, { status: 400 });
      }
      const next = await adminReassignInstance(instanceId, newUserId);
      return NextResponse.json({ instance: publicInstance(next) });
    }

    if (body.action === 'exec') {
      const command = String(body.command || '').trim();
      if (!command) {
        return NextResponse.json({ error: 'command required' }, { status: 400 });
      }
      const result = await adminExecOnInstance(instanceId, command, {
        cwd: body.cwd,
        timeout: body.timeout,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return errRes(e);
  }
}

/**
 * Destroy sandbox.
 * ?id=…           soft (status=destroyed)
 * ?id=…&hard=1    hard delete from DB + kill sandbox
 */
export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const instanceId = url.searchParams.get('id')?.trim() || '';
    const hard = url.searchParams.get('hard') === '1';
    if (!instanceId) {
      return NextResponse.json({ error: 'id query required' }, { status: 400 });
    }
    const result = await adminDestroyInstance(instanceId, { hard });
    return NextResponse.json(result);
  } catch (e) {
    return errRes(e);
  }
}
