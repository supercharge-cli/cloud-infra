import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { syncBots, validBot } from '@/lib/bot-service';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const botId = new URL(req.url).searchParams.get('botId');
  if (botId && !await validBot(gate.inst, botId)) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  try {
    const res = await proxyInbox(gate.inst, botId ? `/v1/conversations?botId=${encodeURIComponent(botId)}` : '/v1/conversations');
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => ({})) as { botId?: string };
  if (body.botId !== undefined && (typeof body.botId !== 'string' || !await validBot(gate.inst, body.botId))) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  try {
    if (body.botId) await syncBots(gate.inst);
    const res = await proxyInbox(gate.inst, '/v1/conversations/new', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.botId ? { botId: body.botId } : {}),
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
