import { NextResponse } from 'next/server';
import { requireChatInstance } from '@/lib/app-chat';
import { attachSandboxHost } from '@/lib/gateway-client';

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || 'xibecode') !== 'supercharge') {
    return NextResponse.json({ error: 'Supercharge session not found' }, { status: 404 });
  }
  try {
    const attach = await attachSandboxHost(gate.inst.sessionId);
    return NextResponse.json(attach);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
