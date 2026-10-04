import { NextResponse } from "next/server";
import { proxyInbox, requireChatInstance } from "@/lib/app-chat";
import { computerBotId, computerBotQuery, matchesComputerBot } from "@/lib/computer-target";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  const botId = computerBotId(new URL(req.url).searchParams.get("botId"));
  if (!botId) return NextResponse.json({ error: "Invalid botId" }, { status: 400 });
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json(
      { error: "The AI browser is available only for Supercharge instances" },
      { status: 404 },
    );
  }
  try {
    const upstream = await proxyInbox(gate.inst, `/v1/computer/status?${computerBotQuery(botId)}`);
    const text = await upstream.text();
    if (botId !== "main" && upstream.ok) {
      let status: unknown;
      try { status = JSON.parse(text); } catch { status = null; }
      if (!matchesComputerBot(status, botId)) {
        return NextResponse.json({ error: "Agent desktop identity unavailable" }, { status: 409 });
      }
    }
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
