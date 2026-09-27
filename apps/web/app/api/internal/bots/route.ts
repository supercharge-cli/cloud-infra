import { NextResponse } from 'next/server';
import { BotInputError, createBot, exposedBot, listBots, type BotInput } from '@/lib/bots';
import { authenticateBotCapability, syncBots } from '@/lib/bot-service';

export async function POST(req: Request) {
  let body: { instanceId?: unknown; action?: unknown; input?: BotInput };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error:'Invalid request'}, {status:400});
  const secret = req.headers.get('x-vectra-bot-capability') || '';
  const instance = typeof body.instanceId === 'string'
    ? await authenticateBotCapability(body.instanceId, secret) : null;
  if (!instance) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (body.action === 'list') {
    return NextResponse.json({ bots: (await listBots(instance)).map((bot) => ({id:bot.id, name:bot.name, defaultFolder:bot.defaultFolder, revision:bot.revision})) });
  }
  if (body.action !== 'create' || !body.input) {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }
  try {
    const bot = await createBot(instance, body.input, 'main');
    await syncBots(instance);
    return NextResponse.json({ bot: exposedBot(bot) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, {
      status: error instanceof BotInputError ? 400 : 502,
    });
  }
}
