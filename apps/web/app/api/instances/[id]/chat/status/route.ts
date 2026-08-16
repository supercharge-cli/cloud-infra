import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  try {
    const res = await proxyInbox(gate.inst, '/v1/status');
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
