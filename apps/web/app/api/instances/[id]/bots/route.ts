import { NextResponse } from 'next/server';
import { BotInputError, createBot, exposedBot, listBots, type BotInput } from '@/lib/bots';
import { botsEnabled, syncBots } from '@/lib/bot-service';
import { requireChatInstance } from '@/lib/app-chat';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  try {
    return NextResponse.json({ bots: (await listBots(gate.inst)).map(exposedBot) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if (!botsEnabled(gate.inst)) return NextResponse.json({ error: 'Supercharge E2B only' }, { status: 404 });
  try {
    const input = await req.json() as BotInput;
    const bot = await createBot(gate.inst, input);
    await syncBots(gate.inst);
    return NextResponse.json({ bot: exposedBot(bot) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, {
      status: error instanceof BotInputError || error instanceof SyntaxError ? 400 : 502,
    });
  }
}
