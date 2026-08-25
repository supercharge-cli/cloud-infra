import { NextResponse } from "next/server";
import { proxyInbox, requireChatInstance } from "@/lib/app-chat";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json({ error: "Browser handoff is available only for Supercharge instances" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; minutes?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "start" && action !== "stop") {
    return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });
  }
  try {
    const upstream = await proxyInbox(gate.inst, "/v1/computer/handoff", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action, minutes: body.minutes }),
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
