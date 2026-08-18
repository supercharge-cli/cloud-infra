import { NextResponse } from 'next/server';
import { proxyInbox, requireChatInstance } from '@/lib/app-chat';

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const MAX_FILE = 25 * 1024 * 1024;

function siteOrigin(): string {
  return (
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    'https://infra.xibeai.in'
  ).replace(/\/$/, '');
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  const ctype = req.headers.get('content-type') || '';
  let name = 'upload.bin';
  let mime: string | undefined;
  let contentBase64 = '';

  try {
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') continue;
        const blob = value as File;
        if (blob.size > MAX_FILE) {
          return NextResponse.json(
            { error: `file too large (max ${MAX_FILE} bytes)` },
            { status: 413 },
          );
        }
        name = blob.name || name;
        mime = blob.type || undefined;
        contentBase64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
        break;
      }
    } else {
      const body = (await req.json()) as {
        name?: string;
        mime?: string;
        contentBase64?: string;
      };
      name = body.name || name;
      mime = body.mime;
      contentBase64 = String(body.contentBase64 || '');
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!contentBase64) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }

  try {
    const res = await proxyInbox(gate.inst, '/v1/public', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mime, contentBase64 }),
    });
    const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !data.token) {
      return NextResponse.json(
        { error: data.error || 'Could not publish file' },
        { status: res.status === 401 ? 502 : res.status || 502 },
      );
    }
    const url = `${siteOrigin()}/api/public/media/${encodeURIComponent(id)}/${encodeURIComponent(data.token)}`;
    return NextResponse.json({ url, token: data.token, name, mime });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
