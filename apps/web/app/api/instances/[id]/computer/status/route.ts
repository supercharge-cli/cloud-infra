import { NextResponse } from "next/server";
import { proxyInbox, requireChatInstance } from "@/lib/app-chat";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireChatInstance(id);
  if (!gate.ok) return gate.response;
  if ((gate.inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json(
      { error: "The AI browser is available only for Supercharge instances" },
      { status: 404 },
    );
  }
  try {
    const upstream = await proxyInbox(gate.inst, "/v1/computer/status");
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
