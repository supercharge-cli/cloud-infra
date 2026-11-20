import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { inboxEventStream } from '@/lib/inbox-event-stream';
import { activeBotChat, prepareBotRequest } from '@/lib/bot-routing';
import { gatewaySessionFetch, getGatewayUrl } from '@/lib/gateway-client';

export const maxDuration = 300;
const streamBudgetMs = 270_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const startedAt = Date.now();
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const since = url.searchParams.get('since') || '';
  const explicitChatId = url.searchParams.get('chatId');
  const botId = url.searchParams.get('botId');
  let chatId = explicitChatId || undefined;
  if (botId && !chatId) {
    try { chatId = await activeBotChat(gate.inst, botId); }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: 502 }); }
  }
  const rejected = await prepareBotRequest(gate.inst, botId ?? undefined, chatId,
    { allowLegacyChatId: true });
  if (rejected) return rejected;
  const q = new URLSearchParams({ chatId: chatId || 'owner' });
  if (botId) q.set('botId', botId);
  if (since) q.set('since', since);

  const gateway = getGatewayUrl();
  const wantsDirect = req.headers.get('accept')?.includes('application/json') === true;
  if (wantsDirect && gateway.startsWith('https://')) {
    try {
      const issued = await gatewaySessionFetch(gate.inst.sessionId, '/chat/stream-ticket', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chatId: chatId || 'owner',
          ...(botId ? { botId } : {}),
          ...(since ? { since } : {}),
        }),
      }, { sandboxId: gate.inst.sandboxId, runtime: gate.inst.runtime });
      const issuedBody = await issued.json() as { ticket?: unknown };
      if (issued.ok && typeof issuedBody.ticket === 'string' && issuedBody.ticket) {
        const streamUrl = `${gateway.replace(/\/$/, '')}/chat/stream?ticket=${encodeURIComponent(issuedBody.ticket)}`;
        return Response.json({ streamUrl, chatId: chatId || 'owner' });
      }
    } catch {
      // The Vercel stream below still serves the chat when the gateway has no ticket route yet.
    }
  }

  try {
    const res = await proxyInbox(gate.inst, `/v1/chat/events?${q.toString()}`, {
      headers: { accept: 'text/event-stream' },
      signal: req.signal,
    });
    if (!res.body) {
      return new Response('No stream', { status: 502 });
    }
    const remainingMs = streamBudgetMs - (Date.now() - startedAt);
    return new Response(inboxEventStream(res.body, req.signal, remainingMs), {
      status: res.status,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}
