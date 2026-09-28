import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPlan, hasInstanceAccess } from "@/lib/billing";
import { wakeSession } from "@/lib/gateway-client";
import { ensureInbox } from "@/lib/app-chat";
import { getInstance, updateInstance } from "@/lib/store";
import { applySystemUpdate, getSystemVersionInfo } from "@/lib/system-update";
import { syncTelegramWakeWebhook } from "@/lib/telegram-webhook";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const inst = await getInstance(user.id, id);
  if (!inst) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (!hasInstanceAccess(inst)) {
    const plan = getPlan();
    return NextResponse.json(
      {
        error: "Subscription expired",
        message: `Renew for ₹${plan.priceInr} or $${plan.priceUsd}/month to resume this instance.`,
        code: "PAYMENT_REQUIRED",
        paidUntil: inst.paidUntil || null,
      },
      { status: 402 },
    );
  }

  try {
    const result = await wakeSession(inst.sessionId, {
      sandboxId: inst.sandboxId,
      runtime: inst.runtime || "xibecode",
      restartDaemon: inst.runtime !== "supercharge",
    });
    const logs = [...(result.logs || [])];
    if (result.ok && inst.runtime === "supercharge") {
      const system = await getSystemVersionInfo(inst.sessionId, inst.sandboxId).catch(
        () => null,
      );
      if (system?.updateAvailable && system.latest) {
        const applied = await applySystemUpdate(
          inst.sessionId,
          inst.sandboxId,
          system.latest,
        ).catch((error: Error) => ({
          ok: false,
          from: system.current,
          to: null as string | null,
          notes: system.notes,
          logs: [error.message],
        }));
        logs.push(
          applied.ok
            ? `system update ${applied.from || "none"} -> ${applied.to}`
            : "system update failed; stamp left unchanged",
        );
        logs.push(...applied.logs.slice(0, 20));
      }
      await ensureInbox(inst);
    }
    const fullyUp = result.ok && result.daemonOk !== false;

    // Sandbox webhook mode: keep Telegram on sandbox public URL (E2B auto-resume).
    // Host mode: clear when running (long-poll); arm when wake incomplete.
    if (inst.telegramBotToken) {
      const mode =
        inst.telegramWebhookMode ||
        (inst.sandboxTelegramWebhookUrl ? "sandbox" : "host");
      const tg = await syncTelegramWakeWebhook({
        botToken: inst.telegramBotToken,
        instanceId: inst.id,
        wakeSecret: inst.wakeSecret,
        sandboxState: fullyUp ? "running" : "paused",
        mode,
        sandboxId: inst.sandboxId,
        sandboxWebhookUrl: inst.sandboxTelegramWebhookUrl,
        telegramWebhookSecret: inst.telegramWebhookSecret,
      });
      if (tg) logs.push(tg);
    }

    const next = await updateInstance(user.id, inst.id, {
      status: fullyUp ? "running" : result.ok ? "running" : "error",
      lastError: fullyUp
        ? undefined
        : (result.message || logs.join("\n") || "wake incomplete").slice(
            0,
            500,
          ),
    });
    const { publicInstance } = await import("@/lib/store");
    return NextResponse.json(
      {
        ok: fullyUp,
        state: result.state || (result.ok ? "running" : undefined),
        resumed: result.resumed,
        daemonOk: result.daemonOk,
        logs,
        instance: next ? publicInstance(next) : null,
      },
      { status: fullyUp ? 200 : 502 },
    );
  } catch (e) {
    await updateInstance(user.id, inst.id, {
      status: "error",
      lastError: (e as Error).message.slice(0, 500),
    });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
