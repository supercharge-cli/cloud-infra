import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { validBot } from '@/lib/bot-service';
import { tokenMessages } from '@/lib/github-token-chat';
import { isDirectGitHubConversation, type ConversationListing } from '@/lib/github-token';

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
    const text = await res.text();
    if (!res.ok || botId !== 'github') return new NextResponse(text, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    const conversation = JSON.parse(text) as { botId?: string; sessionId?: string; messages?: Array<{ id: string; role: string; content: string }> };
    if (conversation.botId !== 'github' || conversation.sessionId !== sessionId || !Array.isArray(conversation.messages)) {
      return NextResponse.json({ error: 'GitHub conversation could not be verified' }, { status: 502 });
    }
    const listingResponse = await proxyInbox(gate.inst, '/v1/conversations?botId=github');
    if (!listingResponse.ok) return NextResponse.json({ error: 'GitHub conversation list is unavailable' }, { status: 502 });
    if (!isDirectGitHubConversation(await listingResponse.json() as ConversationListing, sessionId)) {
      return NextResponse.json(conversation, { headers: { 'cache-control': 'no-store, private' } });
    }
    const messages = await tokenMessages(gate.inst.id, gate.inst.userId, sessionId);
    const entries = conversation.messages;
    messages.forEach((message, index) => entries.splice(Math.min(message.messageIndex + index, entries.length), 0, message));
    return NextResponse.json(conversation, { headers: { 'cache-control': 'no-store, private' } });
  } catch {
    return NextResponse.json({ error: 'Conversation is temporarily unavailable.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
