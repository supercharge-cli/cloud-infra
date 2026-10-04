import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { prepareBotRequest } from '@/lib/bot-routing';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => null) as { text?: unknown; botId?: unknown; chatId?: unknown } | null;
  if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 64_000 ||
      typeof body.botId !== 'string' || typeof body.chatId !== 'string') {
    return NextResponse.json({ error: 'Text, bot ID, and conversation ID are required' }, { status: 400 });
  }
  try {
    const rejected = await prepareBotRequest(gate.inst, body.botId, body.chatId);
    if (rejected) return rejected;
    const res = await proxyInbox(gate.inst, '/v1/chat/steer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: body.text.trim(), botId: body.botId, chatId: body.chatId }),
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
