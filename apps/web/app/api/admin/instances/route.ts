import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  adminUpdateInstance,
  getInstanceById,
  listAllInstances,
  listAllUsers,
  publicInstance,
} from '@/lib/store';
import { destroyGatewaySession } from '@/lib/gateway-client';
import { isSubscriptionActive } from '@/lib/billing';

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const includeDestroyed = url.searchParams.get('destroyed') === '1';
    const [instances, users] = await Promise.all([
      listAllInstances({ includeDestroyed, limit: 500 }),
      listAllUsers(),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    return NextResponse.json({
      instances: instances.map((inst) => ({
        ...publicInstance(inst),
        ownerEmail: emailById.get(inst.userId) || null,
        paid: isSubscriptionActive(inst.paidUntil),
      })),
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || 'Forbidden' },
      { status: err.status || 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as {
      instanceId?: string;
      action?: 'extend' | 'set_paid_until' | 'mark_unpaid' | 'set_status';
      paidUntil?: string;
      days?: number;
      status?: string;
    };
    const instanceId = String(body.instanceId || '').trim();
    if (!instanceId || !body.action) {
      return NextResponse.json({ error: 'instanceId and action required' }, { status: 400 });
    }
    const inst = await getInstanceById(instanceId);
    if (!inst) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });

    if (body.action === 'extend') {
      const days = Math.max(1, Math.min(365, Math.round(Number(body.days) || 30)));
      const base =
        inst.paidUntil && Date.parse(inst.paidUntil) > Date.now()
          ? new Date(inst.paidUntil)
          : new Date();
      // addBillingPeriod uses env period; for custom days compute manually
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
      return NextResponse.json({
        instance: next ? publicInstance(next) : null,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || 'Forbidden' },
      { status: err.status || 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const instanceId = url.searchParams.get('id')?.trim() || '';
    if (!instanceId) {
      return NextResponse.json({ error: 'id query required' }, { status: 400 });
    }
    const inst = await getInstanceById(instanceId);
    if (!inst) return NextResponse.json({ error: 'Instance not found' }, { status: 404 });

    try {
      await destroyGatewaySession(inst.sessionId);
    } catch {
      /* sandbox may already be gone */
    }

    await adminUpdateInstance(instanceId, { status: 'destroyed' });
    return NextResponse.json({ ok: true, id: instanceId });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || 'Forbidden' },
      { status: err.status || 500 },
    );
  }
}
