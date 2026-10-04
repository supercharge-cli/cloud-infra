import { NextResponse } from "next/server";
import { proxyInbox, requireChatInstance } from "@/lib/app-chat";
import { browserVncWebSocketUrl, createBrowserVncTicket, ensureGatewaySession } from "@/lib/gateway-client";
import { computerBotId, computerBotQuery } from "@/lib/computer-target";

type Ctx = { params: Promise<{ id: string }> };

function desktopVncUrl(sandboxId: string, ticket: string): string {
  const domain = (process.env.XIBECODE_E2B_PREVIEW_DOMAIN || process.env.E2B_DOMAIN || "e2b.app").trim().replace(/^\.+/, "");
  return `wss://8790-${sandboxId}.${domain}/v1/computer/browser/vnc?ticket=${encodeURIComponent(ticket)}`;
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json({ error: "Desktop control is available only for Supercharge E2B instances" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({})) as { handoffId?: unknown; botId?: unknown };
  if (typeof body.handoffId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(body.handoffId)) {
    return NextResponse.json({ error: "A current handoffId is required" }, { status: 400 });
  }
  const botId = computerBotId(body.botId);
  if (!botId) return NextResponse.json({ error: "Invalid botId" }, { status: 400 });
  const sandboxId = gate.inst.sandboxId || "";
  if (sandboxId) {
    try {
      const upstream = await proxyInbox(gate.inst, `/v1/computer/vnc-ticket?handoffId=${encodeURIComponent(body.handoffId)}&${computerBotQuery(botId)}`);
      const data = await upstream.json() as { ticket?: string; expiresInSeconds?: number; handoffId?: string; botId?: string; error?: string };
      if (!upstream.ok) return NextResponse.json({ error: data.error || "Take control before opening the desktop. Update an older sandbox explicitly." }, { status: upstream.status });
      if (!data.ticket || data.handoffId !== body.handoffId || (data.botId || "main") !== botId) return NextResponse.json({ error: "The sandbox did not issue a bot-bound ticket. Update it explicitly before taking control." }, { status: 409 });
      return NextResponse.json({ ...data, wsUrl: desktopVncUrl(sandboxId, data.ticket), source: "daemon" }, { headers: { "cache-control": "no-store" } });
    } catch {
      // Network failure may use the gateway, which obtains the same handoff-bound daemon ticket.
    }
  }
  try {
    await ensureGatewaySession(gate.inst.sessionId, sandboxId, "supercharge");
    const ticket = await createBrowserVncTicket(gate.inst.sessionId, body.handoffId, botId);
    return NextResponse.json({ ...ticket, handoffId: body.handoffId, wsUrl: browserVncWebSocketUrl(gate.inst.sessionId, ticket.ticket), source: "gateway" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
