import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPlan, hasInstanceAccess } from "@/lib/billing";
import { readSandboxLogs } from "@/lib/gateway-client";
import { getInstance } from "@/lib/store";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/instances/:id/logs?lines=200&source=all|daemon|agent|system
 * Pulls diagnostic logs from the sandbox (wakes if paused).
 */
export async function GET(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (inst.status === "destroyed") {
    return NextResponse.json({ error: "Instance destroyed" }, { status: 410 });
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: "Subscription expired",
        message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to read logs.`,
        code: "PAYMENT_REQUIRED",
        paidUntil: inst.paidUntil || null,
      },
      { status: 402 },
    );
  }

  const url = new URL(req.url);
  const linesRaw = Number(url.searchParams.get("lines") || "200");
  const lines = Number.isFinite(linesRaw) ? linesRaw : 200;
  const sourceParam = (url.searchParams.get("source") || "all").toLowerCase();
  const source = (
    ["all", "daemon", "agent", "system"].includes(sourceParam)
      ? sourceParam
      : "all"
  ) as "all" | "daemon" | "agent" | "system";

  try {
    const result = await readSandboxLogs(inst.sessionId, {
      sandboxId: inst.sandboxId,
      runtime: inst.runtime || "xibecode",
      lines,
      source,
    });
    return NextResponse.json({
      ok: result.ok,
      instanceId: inst.id,
      sandboxId: inst.sandboxId,
      source: result.source,
      lines,
      text: result.text,
      logs: result.logs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, ok: false },
      { status: 502 },
    );
  }
}
