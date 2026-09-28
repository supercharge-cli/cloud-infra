import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPlan, hasInstanceAccess } from "@/lib/billing";
import { getInstance } from "@/lib/store";
import { getSystemVersionInfo } from "@/lib/system-update";

export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  if (inst.status === "destroyed") {
    return NextResponse.json({ error: "Instance destroyed" }, { status: 410 });
  }
  if ((inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json({ updateAvailable: false, runtime: inst.runtime || "xibecode" });
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      { error: "Subscription expired", code: "PAYMENT_REQUIRED", message: `Renew to check the system update (₹${plan.priceInr} / $${plan.priceUsd}).` },
      { status: 402 },
    );
  }
  try {
    const info = await getSystemVersionInfo(inst.sessionId, inst.sandboxId);
    return NextResponse.json({ instanceId: inst.id, runtime: "supercharge", ...info });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
