import { proxyInbox, requireChatInstance } from '@/lib/app-chat';

/** Keep well under Vercel’s 300s hard kill so idle SSE does not pile up. */
export const maxDuration = 55;

type Ctx = { params: Promise<{ id: string }> };

function withReadyFrame(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const ready = encoder.encode(
    `data: ${JSON.stringify({ type: 'ready', id: 'ready', ts: Date.now() })}\n\n`,
  );
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(ready);
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const since = url.searchParams.get('since') || '';
  const chatId = url.searchParams.get('chatId') || 'owner';
  const q = new URLSearchParams({ chatId });
  if (since) q.set('since', since);

  try {
    const res = await proxyInbox(gate.inst, `/v1/chat/events?${q.toString()}`, {
      headers: { accept: 'text/event-stream' },
    });
    if (!res.body) {
      return new Response('No stream', { status: 502 });
    }
    return new Response(withReadyFrame(res.body), {
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
