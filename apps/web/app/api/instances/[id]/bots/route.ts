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
    const bots = (await listBots(gate.inst)).map(exposedBot);
    // Listing is what the app does on open. Push Chief and GitHub into the VM
    // so the default GitHub bot exists without a separate create step.
    try { await syncBots(gate.inst); } catch { /* sandbox may be paused */ }
    return NextResponse.json({ bots });
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
