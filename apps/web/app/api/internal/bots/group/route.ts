import { NextResponse } from 'next/server';
import { requireAgentCaller } from '@/lib/bot-service';
import { proxyInbox } from '@/lib/app-chat';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const caller = await requireAgentCaller(req, body);
  if (caller instanceof NextResponse) return caller;
  try {
    const response = body.action === 'read'
      ? await proxyInbox(caller.instance, '/v1/app/group')
      : body.action === 'send'
        ? await proxyInbox(caller.instance, '/v1/app/group', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requestId: body.requestId, text: body.text, mentions: body.mentions,
              senderBotId: caller.botId, senderSessionId: caller.sessionId }),
          })
        : null;
    if (!response) return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    return new NextResponse(await response.text(), { status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Shared group is unavailable; retry after the sandbox reconnects' }, { status: 502 });
  }
}
