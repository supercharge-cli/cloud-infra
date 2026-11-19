import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { subscriptionService } from '@/lib/subscription-runtime';
import { respond, serverError } from '@/lib/subscription-http';

type Ctx = { params: Promise<{ id: string }> };

/** Cancel autopay. Default: at the end of the paid cycle (access kept until then). */
export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { id } = await ctx.params;
  let body: { immediately?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* default */
  }
  try {
    return respond(await subscriptionService().cancel(user.id, id, { immediately: body.immediately === true }));
  } catch (e) {
    return serverError('cancel', e);
  }
}
