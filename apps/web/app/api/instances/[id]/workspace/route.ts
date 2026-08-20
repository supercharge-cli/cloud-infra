import { NextResponse } from 'next/server';
import { gatewaySessionFetch } from '@/lib/gateway-client';
import { requireChatInstance } from '@/lib/app-chat';

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };
const DEFAULT_PATH = '/home/user/workspace';
const MAX_PATH_LENGTH = 512;

function safePath(raw: string | null): string {
  const path = String(raw || DEFAULT_PATH).trim() || DEFAULT_PATH;
  if (path.length > MAX_PATH_LENGTH || path.includes('\0') || path.includes('..')) {
    throw new Error('Invalid workspace path');
  }
  return path;
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;

  let path: string;
  try {
    path = safePath(new URL(req.url).searchParams.get('path'));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  try {
    const res = await gatewaySessionFetch(
      gate.inst.sessionId,
      `/list?path=${encodeURIComponent(path)}`,
      { headers: { accept: 'application/json' } },
      { sandboxId: gate.inst.sandboxId },
    );
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
