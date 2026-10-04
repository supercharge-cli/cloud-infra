import { NextResponse } from "next/server";
import { proxyInbox, requireChatInstance } from "@/lib/app-chat";
import { computerBotId, computerBotQuery, matchesComputerBot } from "@/lib/computer-target";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json({ error: "Browser handoff is available only for Supercharge instances" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; minutes?: unknown; handoffId?: unknown; botId?: unknown; sessionId?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });
  }
  if (typeof body.handoffId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(body.handoffId)) {
    return NextResponse.json({ error: "A unique handoffId is required. Update the app before taking control." }, { status: 400 });
  }
  const botId = computerBotId(body.botId);
  if (!botId) return NextResponse.json({ error: "Invalid botId" }, { status: 400 });
  try {
    if (botId !== "main" && action === "start") {
      const status = await proxyInbox(gate.inst, `/v1/computer/status?${computerBotQuery(botId)}`);
      if (!status.ok) return NextResponse.json({ error: "Agent desktop unavailable" }, { status: status.status });
      if (!matchesComputerBot(await status.json(), botId)) {
        return NextResponse.json({ error: "Agent desktop identity unavailable" }, { status: 409 });
      }
    }
    const upstream = await proxyInbox(gate.inst, "/v1/computer/handoff", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action, minutes: body.minutes, handoffId: body.handoffId, botId, sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined }),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
