import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { subscriptionService } from '@/lib/subscription-runtime';
import { respond, serverError } from '@/lib/subscription-http';

type Ctx = { params: Promise<{ id: string }> };

/** Change sandbox size. Upgrades apply now, downgrades at the cycle end. */
export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await ctx.params;
  let body: { planId?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* validated below */
  }
  if (typeof body.planId !== 'string' || !body.planId) {
    return NextResponse.json({ error: 'planId required' }, { status: 400 });
  }
  try {
    return respond(await subscriptionService().changeSize(user.id, id, body.planId));
  } catch (e) {
    return serverError('change', e);
  }
}
