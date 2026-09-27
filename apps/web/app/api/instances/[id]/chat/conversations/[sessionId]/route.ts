import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { validBot } from '@/lib/bot-service';

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id, sessionId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const botId = new URL(req.url).searchParams.get('botId');
  if (botId && !await validBot(gate.inst, botId)) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  try {
    const path = `/v1/conversations/${encodeURIComponent(sessionId)}`;
    const res = await proxyInbox(gate.inst, botId ? `${path}?botId=${encodeURIComponent(botId)}` : path);
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
