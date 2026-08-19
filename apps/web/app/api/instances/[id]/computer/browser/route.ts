import { proxyInbox, requireChatInstance } from '@/lib/app-chat';

/** Keep well under Vercel’s 300s hard kill so idle SSE does not pile up. */
export const maxDuration = 55;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  try {
    const res = await proxyInbox(gate.inst, '/v1/computer/browser', {
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
