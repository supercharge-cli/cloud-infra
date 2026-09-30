import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPlan, hasInstanceAccess } from "@/lib/billing";
import { wakeSession } from "@/lib/gateway-client";
import { getInstance, publicInstance, updateInstance } from "@/lib/store";
import { applySystemUpdate } from "@/lib/system-update";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  if (inst.status === "destroyed") {
    return NextResponse.json({ error: "Instance destroyed" }, { status: 410 });
  }
  if ((inst.runtime || "xibecode") !== "supercharge") {
    return NextResponse.json({ error: "System update is only for Supercharge sandboxes" }, { status: 400 });
  }
  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      { error: "Subscription expired", code: "PAYMENT_REQUIRED", message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to update this sandbox.` },
      { status: 402 },
    );
  }
  let body: { version?: string; desktopOptIn?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const version = body.version?.trim().replace(/^v/, "") || "";
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }
  try {
    const wake = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      runtime: "supercharge",
      restartDaemon: false,
    });
    const result = await applySystemUpdate(inst.sessionId, inst.sandboxId, version, { desktopOptIn: body.desktopOptIn === true });
    const logs = [
      wake.ok === false ? `wake: ${wake.message || "not ok"}` : "wake: ok",
      ...(wake.logs || []),
      ...result.logs,
    ];
    await updateInstance(user.id, inst.id, {
      status: result.ok ? "running" : "error",
      lastError: result.ok ? undefined : logs.join("\n").slice(0, 500),
    }).catch(() => undefined);
    return NextResponse.json(
      { ok: result.ok, from: result.from, to: result.to, notes: result.notes, logs, instance: publicInstance(inst), ...(result.ok ? {} : { error: "System update did not finish. The version stamp was left unchanged." }) },
      { status: result.ok ? 200 : 502 },
    );
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
