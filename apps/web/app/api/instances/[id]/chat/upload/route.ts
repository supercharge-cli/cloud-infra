import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';
import { prepareBotRequest } from '@/lib/bot-routing';

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const MAX_FILE = 25 * 1024 * 1024;

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  const ctype = req.headers.get('content-type') || '';
  let payload: {
    text?: string;
    chatId?: string;
    botId?: string;
    files?: Array<{ name: string; contentBase64: string; mime?: string }>;
  } = {};

  try {
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const files: Array<{ name: string; contentBase64: string; mime?: string }> =
        [];
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') {
          if (key === 'text' || key === 'caption') payload.text = value;
          if (key === 'chatId') payload.chatId = value;
          if (key === 'botId') payload.botId = value;
          continue;
        }
        const blob = value as File;
        if (blob.size > MAX_FILE) {
          return NextResponse.json(
            { error: `file too large (max ${MAX_FILE} bytes)` },
            { status: 413 },
          );
        }
        const buf = Buffer.from(await blob.arrayBuffer());
        files.push({
          name: blob.name || 'upload.bin',
          contentBase64: buf.toString('base64'),
          mime: blob.type || undefined,
        });
      }
      payload.files = files;
    } else {
      payload = (await req.json()) as typeof payload;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    const rejected = await prepareBotRequest(gate.inst, payload.botId, payload.chatId, { sync: true, allowLegacyChatId: true });
    if (rejected) return rejected;
    const res = await proxyInbox(gate.inst, '/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
