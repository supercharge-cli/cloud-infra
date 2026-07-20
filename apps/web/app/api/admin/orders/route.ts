import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { listRecentOrders } from '@/lib/store';

export async function GET() {
  try {
    await requireAdmin();
    const orders = await listRecentOrders(150);
    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        userId: o.userId,
        email: o.email,
        purpose: o.purpose,
        instanceId: o.instanceId,
        instanceName: o.instanceName,
        razorpayOrderId: o.razorpayOrderId,
        amountCents: o.amountCents,
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        paymentId: o.paymentId,
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
