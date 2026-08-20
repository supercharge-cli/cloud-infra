import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };
const ACTIONS = new Set([
  'navigate',
  'click',
  'fill',
  'type',
  'press',
  'select',
  'scroll',
  'wait',
  'back',
  'forward',
  'reload',
]);

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unsupported browser action' }, { status: 400 });
  }

  try {
    const res = await proxyInbox(gate.inst, '/v1/computer/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...body, approved: true }),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
