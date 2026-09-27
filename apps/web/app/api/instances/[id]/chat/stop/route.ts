import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { prepareBotRequest } from '@/lib/bot-routing';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => ({})) as { botId?: string; chatId?: string };
  try {
    const rejected = await prepareBotRequest(gate.inst, body.botId, body.chatId,
      { allowLegacyChatId: true });
    if (rejected) return rejected;
    const res = await proxyInbox(gate.inst, '/v1/chat/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
