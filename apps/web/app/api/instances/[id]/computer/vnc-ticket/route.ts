import { NextResponse } from "next/server";
import { ensureInbox, proxyInbox, requireChatInstance } from "@/lib/app-chat";
import {
  browserVncWebSocketUrl,
  createBrowserVncTicket,
  ensureGatewaySession,
} from "@/lib/gateway-client";

type Ctx = { params: Promise<{ id: string }> };

function playwrightVncUrl(sandboxId: string, ticket: string): string {
  const domain = (
    process.env.XIBECODE_E2B_PREVIEW_DOMAIN ||
    process.env.E2B_DOMAIN ||
    "e2b.dev"
  )
    .trim()
    .replace(/^\.+/, "");
  // Port 8790 is the Supercharge daemon, which relays only the Playwright
  // Xvfb display — not the whole-OS desktop on 6080-{sandbox}.e2b.dev.
  return `wss://8790-${sandboxId}.${domain}/v1/computer/browser/vnc?ticket=${encodeURIComponent(ticket)}`;
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json(
      { error: "The AI browser is available only for Supercharge instances" },
      { status: 404 },
    );
  }
  const sandboxId = gate.inst.sandboxId || "";
  try {
    await ensureGatewaySession(
      gate.inst.sessionId,
      sandboxId,
      "supercharge",
    );
    const ticket = await createBrowserVncTicket(gate.inst.sessionId);
    return NextResponse.json(
      {
        ...ticket,
        wsUrl: browserVncWebSocketUrl(gate.inst.sessionId, ticket.ticket),
        source: "gateway",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (gatewayError) {
    try {
      await ensureInbox(gate.inst);
      const upstream = await proxyInbox(gate.inst, "/v1/computer/vnc-ticket");
      const data = (await upstream.json().catch(() => ({}))) as {
        ticket?: string;
        error?: string;
      };
      if (!upstream.ok || !data.ticket || !sandboxId) {
        throw new Error(
          data.error ||
            (gatewayError as Error).message ||
            "Playwright VNC ticket was not issued",
        );
      }
      return NextResponse.json(
        {
          ticket: data.ticket,
          expiresInSeconds: 300,
          wsUrl: playwrightVncUrl(sandboxId, data.ticket),
          source: "daemon",
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 502 },
      );
    }
  }
}
