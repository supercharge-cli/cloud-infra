import { NextResponse } from "next/server";
import { requireChatInstance } from "@/lib/app-chat";
import {
  browserVncWebSocketUrl,
  createBrowserVncTicket,
  ensureGatewaySession,
} from "@/lib/gateway-client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json({ error: "Browser handoff is available only for Supercharge instances" }, { status: 404 });
  }
  try {
    await ensureGatewaySession(gate.inst.sessionId, gate.inst.sandboxId, "supercharge");
    const ticket = await createBrowserVncTicket(gate.inst.sessionId);
    return NextResponse.json(
      { ...ticket, wsUrl: browserVncWebSocketUrl(gate.inst.sessionId, ticket.ticket) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
