import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { botsEnabled, syncBots } from '@/lib/bot-service';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Shared agents require Supercharge E2B' }, { status: 404 });
  if (gate.inst.status === 'paused') return NextResponse.json({ paused: true, messages: [], activity: [] });
  try {
    const response = await proxyInbox(gate.inst, '/v1/app/group');
    return new NextResponse(await response.text(), { status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Group chat is reconnecting. Your messages are kept in the sandbox.' }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Shared agents require Supercharge E2B' }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid message' }, { status: 400 }); }
  if (!body || typeof body.text !== 'string' || !body.text.trim() || Buffer.byteLength(body.text, 'utf8') > 16_000 ||
      typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(body.requestId) ||
      (body.mentions !== undefined && (!Array.isArray(body.mentions) || body.mentions.length > 64 || body.mentions.some((id) => typeof id !== 'string')))) {
    return NextResponse.json({ error: 'Write a message up to 16,000 bytes and select valid agent mentions' }, { status: 400 });
  }
  try {
    await syncBots(gate.inst);
    const response = await proxyInbox(gate.inst, '/v1/app/group', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: body.text.trim(), requestId: body.requestId, mentions: body.mentions ?? [] }),
    });
    return new NextResponse(await response.text(), { status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Message could not be confirmed. Retry to check the same message without duplicating it.' }, { status: 502 });
  }
}
