import { NextResponse } from 'next/server';
import { BotInputError, getBot, updateBot } from '@/lib/bots';
import { avatarIcon, deleteBotAvatar, getBotAvatar, MAX_BOT_AVATAR_BYTES, pruneBotAvatars, storeBotAvatar, validateBotAvatar } from '@/lib/bot-avatars';
import { botsEnabled, syncBots } from '@/lib/bot-service';
import { requireChatInstance } from '@/lib/app-chat';

type Ctx = { params: Promise<{ id: string; botId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id, botId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  try {
    const version = new URL(req.url).searchParams.get('v') ?? '';
    const avatar = await getBotAvatar(gate.inst, botId, version);
    if (!avatar) return NextResponse.json({ error: 'Picture not found' }, { status: 404 });
    return new Response(new Uint8Array(avatar.data.buffer), {
      headers: {
        'content-type': avatar.mime,
        'content-length': String(avatar.data.length()),
        'cache-control': 'private, max-age=31536000, immutable',
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Picture unavailable' }, { status: 502 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id, botId } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  if (!await getBot(gate.inst, botId)) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
  }
  let version: string | null = null;
  try {
    const declaredLength = req.headers.get('content-length');
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > MAX_BOT_AVATAR_BYTES)) {
      throw new BotInputError('Picture must be at most 1 MiB');
    }
    const stream = req.body?.getReader();
    if (!stream) throw new BotInputError('Picture is missing');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BOT_AVATAR_BYTES) {
        await stream.cancel();
        throw new BotInputError('Picture must be at most 1 MiB');
      }
      chunks.push(value);
    }
    const data = Buffer.concat(chunks, total);
    const mime = await validateBotAvatar(data, req.headers.get('content-type')?.split(';')[0].trim() ?? '');
    version = await storeBotAvatar(gate.inst, botId, data, mime);
    const updated = await updateBot(gate.inst, botId, { icon: avatarIcon(version) });
    if (!updated) throw new Error('Bot was removed during upload');
    const current = await getBot(gate.inst, botId);
    if (current?.icon !== avatarIcon(version)) {
      throw new Error('Bot picture was replaced during upload; retry');
    }
    await syncBots(gate.inst);
    const afterSync = await getBot(gate.inst, botId);
    if (afterSync?.icon !== avatarIcon(version)) {
      throw new Error('Bot picture was replaced during sync; retry');
    }
    await pruneBotAvatars(gate.inst, botId, version).catch(() => undefined);
    return NextResponse.json({ icon: updated.icon, revision: updated.revision });
  } catch (error) {
    if (version) {
      const current = await getBot(gate.inst, botId).catch(() => null);
      if (current?.icon !== avatarIcon(version)) {
        await deleteBotAvatar(gate.inst.id, botId, version).catch(() => undefined);
      }
    }
    return NextResponse.json({ error: (error as Error).message }, {
      status: error instanceof BotInputError ? 400 : 502,
    });
  }
}
