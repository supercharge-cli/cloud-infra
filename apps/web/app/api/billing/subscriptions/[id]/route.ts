import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { subscriptionService } from '@/lib/subscription-runtime';
import { respond, serverError } from '@/lib/subscription-http';

type Ctx = { params: Promise<{ id: string }> };

/** Status of one subscription (owner only). */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await ctx.params;
  try {
    return respond(await subscriptionService().get(user.id, id));
  } catch (e) {
    return serverError('get', e);
  }
}
