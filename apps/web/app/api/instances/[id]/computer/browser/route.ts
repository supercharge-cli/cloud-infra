import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { computerBotId, computerBotQuery, matchesComputerBot } from '@/lib/computer-target';

/** Keep well under Vercel’s 300s hard kill so idle SSE does not pile up. */
export const maxDuration = 55;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const botId = computerBotId(new URL(req.url).searchParams.get('botId'));
  if (!botId) return new Response('Invalid botId', { status: 400 });

  try {
    if (botId !== 'main') {
      const status = await proxyInbox(gate.inst, `/v1/computer/status?${computerBotQuery(botId)}`);
      if (!status.ok) return new Response('Agent desktop unavailable', { status: status.status });
      if (!matchesComputerBot(await status.json(), botId)) {
        return new Response('Agent desktop identity unavailable', { status: 409 });
      }
    }
    const res = await proxyInbox(gate.inst, `/v1/computer/browser?${computerBotQuery(botId)}`, {
      headers: { accept: 'text/event-stream' },
    });
    if (!res.body) {
      return new Response('No stream', { status: 502 });
    }
    return new Response(res.body, {
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
