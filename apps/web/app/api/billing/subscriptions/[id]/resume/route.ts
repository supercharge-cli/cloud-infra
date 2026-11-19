import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { subscriptionService } from '@/lib/subscription-runtime';
import { respond, serverError } from '@/lib/subscription-http';

type Ctx = { params: Promise<{ id: string }> };

/** Resume a paused subscription, or get the Razorpay page to fix a failed payment. */
export async function POST(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return respond(await subscriptionService().resume(user.id, id));
  } catch (e) {
    return serverError('resume', e);
  }
}
