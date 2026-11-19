"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export type AutopayPlan = {
  id: string;
  name: string;
  priceInr: number;
  priceUsd: number;
  autopay?: boolean;
};

export type BillingInstance = {
  id: string;
  name: string;
  plan?: string;
  isFree?: boolean;
  paid?: boolean;
  paidUntil?: string | null;
  billingStatus?: string;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  nextChargeAt?: string | null;
  cancelAtCycleEnd?: boolean | null;
  pendingPlanId?: string | null;
  graceUntil?: string | null;
  billingSuspendedAt?: string | null;
  retainUntil?: string | null;
  deletionFlaggedAt?: string | null;
};

type SubscriptionView = {
  id: string;
  planId: string;
  pendingPlanId: string | null;
  currency: "INR" | "USD";
  status: string;
  cancelAtCycleEnd: boolean;
  currentEnd: string | null;
  nextChargeAt: string | null;
  startAt: string | null;
  lastPaymentFailedAt: string | null;
  paymentUrl: string | null;
};

type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void };

const LIVE = ["authenticated", "active", "pending", "halted", "paused"];

function loadCheckout(): Promise<RazorpayCtor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) return resolve(w.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Razorpay unavailable")));
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(s);
  });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

async function postJson<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Start autopay for a size and open Razorpay Checkout in subscription mode.
 * Resolves with the verify response once the first payment is signed.
 */
export async function startAutopayCheckout(opts: {
  planId: string;
  currency: "INR" | "USD";
  email: string;
  instanceId?: string;
  name?: string;
}): Promise<{ instance?: { id: string } | null; pending?: boolean }> {
  const created = await postJson<{
    subscription: { id: string; startAt: string | null };
    keyId: string;
    size: { name: string; priceInr: number; priceUsd: number };
  }>("/api/billing/subscriptions", {
    planId: opts.planId,
    currency: opts.currency,
    purpose: opts.instanceId ? "attach" : "new_instance",
    instanceId: opts.instanceId,
    name: opts.name,
  });
  const Razorpay = await loadCheckout();
  const price =
    created.subscription && opts.currency === "USD"
      ? `$${created.size.priceUsd}/mo`
      : `₹${created.size.priceInr}/mo`;
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: created.keyId,
      subscription_id: created.subscription.id,
      name: "Vectra Cloud",
      description: `${created.size.name} sandbox · ${price} autopay`,
      prefill: { email: opts.email },
      notes: { product: "vectra-cloud" },
      theme: { color: "#ea580c" },
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_subscription_id: string;
        razorpay_signature: string;
      }) => {
        try {
          resolve(await postJson("/api/billing/subscriptions/verify", response));
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    rzp.open();
  });
}

export function AutopayNote({ oneOff = false }: { oneOff?: boolean }) {
  return (
    <p className="text-[11px] leading-relaxed text-zinc-500">
      {oneOff ? (
        <>One-off payment for one period; it does not renew. Payments are not refunded. </>
      ) : (
        <>
          Autopay renews every month until you cancel. In India it needs a card that supports
          recurring payments, or UPI Autopay / e-mandate, which you approve once in your bank or UPI
          app. UPI and e-mandate subscriptions cannot change size; cancel and subscribe to the new
          size instead. Charges are not refunded; cancelling stops future charges and keeps access
          until the paid period ends.{" "}
        </>
      )}
      See the{" "}
      <Link href="/refund" className="text-orange-400 hover:underline">
        refund &amp; cancellation policy
      </Link>
      ,{" "}
      <Link href="/terms" className="text-orange-400 hover:underline">
        terms
      </Link>{" "}
      and{" "}
      <Link href="/privacy" className="text-orange-400 hover:underline">
        privacy policy
      </Link>
      .
    </p>
  );
}

function StatusBadge({ status, cancelling }: { status: string; cancelling: boolean }) {
  const label = cancelling
    ? "Cancels at period end"
    : ({
        created: "Awaiting payment",
        authenticated: "Autopay approved",
        active: "Autopay on",
        pending: "Payment retrying",
        halted: "Payment failed",
        paused: "Paused",
        cancelled: "Cancelled",
        completed: "Completed",
        expired: "Expired",
      } as Record<string, string>)[status] || status;
  const tone =
    status === "active" && !cancelling
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : status === "pending" || status === "halted"
        ? "border-red-500/30 bg-red-500/10 text-red-300"
        : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return <span className={`rounded-full border px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

/** Billing card for one workspace: status, next charge, size change, cancel / resume. */
export function SubscriptionPanel(props: {
  instance: BillingInstance;
  plans: AutopayPlan[];
  currency: "INR" | "USD";
  email: string;
  graceDays?: number;
  retentionDays?: number;
  onChanged: () => Promise<void> | void;
}) {
  const { instance, plans, currency, email, onChanged } = props;
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [sizeChoice, setSizeChoice] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const autopayPlans = plans.filter((p) => p.autopay);
  const subscriptionId = instance.subscriptionId || null;

  const load = useCallback(async () => {
    if (!subscriptionId) return;
    const res = await fetch(`/api/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
    const data = (await res.json().catch(() => ({}))) as { subscription?: SubscriptionView };
    setSub(res.ok && data.subscription ? data.subscription : null);
  }, [subscriptionId]);

  useEffect(() => {
    let cancelled = false;
    if (!subscriptionId) return;
    fetch(`/api/billing/subscriptions/${encodeURIComponent(subscriptionId)}`)
      .then((res) => res.json().then((data: { subscription?: SubscriptionView }) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!cancelled) setSub(ok && data.subscription ? data.subscription : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [subscriptionId, instance.subscriptionStatus, instance.nextChargeAt]);

  const sizeId = sizeChoice || sub?.pendingPlanId || sub?.planId || instance.plan || "hosting-4c8g";
  const setSizeId = setSizeChoice;

  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
      await onChanged();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "Payment cancelled") setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const view = subscriptionId ? sub : null;
  const live = view && LIVE.includes(view.status);
  const planName = (id?: string | null) => plans.find((p) => p.id === id)?.name || id || "—";
  const priceOf = (id?: string | null) => {
    const p = plans.find((x) => x.id === id);
    if (!p) return "";
    return currency === "USD" ? `$${p.priceUsd}/mo` : `₹${p.priceInr}/mo`;
  };
  const failed = view && (view.status === "pending" || view.status === "halted");
  const suspended = Boolean(instance.billingSuspendedAt);
  const paidUntilPast = instance.paidUntil ? Date.parse(instance.paidUntil) <= now : true;

  if (!autopayPlans.length && !instance.subscriptionId) return null;

  return (
    <section id="billing" className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-white">Billing</h3>
        {view ? <StatusBadge status={view.status} cancelling={view.cancelAtCycleEnd && view.status === "active"} /> : null}
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">{notice}</div>
      ) : null}

      {suspended ? (
        <div className="mb-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-100/90">
          This sandbox is <strong>paused for billing</strong>. Your files and settings are kept until{" "}
          <strong>{fmtDate(instance.retainUntil)}</strong>
          {instance.deletionFlaggedAt ? " and are now scheduled for deletion" : ""}. Pay or subscribe to resume it.
        </div>
      ) : failed ? (
        <div className="mb-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-100/90">
          <strong>Your last autopay payment failed.</strong> Razorpay retries automatically. The sandbox keeps
          working until <strong>{fmtDate(instance.graceUntil || instance.paidUntil)}</strong>, then it pauses.
          {sub?.paymentUrl ? (
            <a
              href={sub.paymentUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-block rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500"
            >
              Fix payment
            </a>
          ) : null}
        </div>
      ) : null}

      {live && sub ? (
        <div className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-zinc-500">Size</dt>
              <dd className="text-zinc-100">
                {planName(sub.planId)} · {priceOf(sub.planId)}
                {sub.pendingPlanId ? (
                  <span className="block text-xs text-amber-300">
                    Changes to {planName(sub.pendingPlanId)} on {fmtDate(sub.currentEnd)}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Paid until</dt>
              <dd className="text-zinc-100">{fmtDate(instance.paidUntil || sub.currentEnd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Next charge</dt>
              <dd className="text-zinc-100">
                {sub.cancelAtCycleEnd
                  ? "None (cancelled)"
                  : sub.status === "authenticated" && sub.startAt
                    ? `${fmtDate(sub.startAt)} (first charge)`
                    : fmtDate(sub.nextChargeAt)}
              </dd>
            </div>
          </dl>

          {sub.status === "active" && !sub.cancelAtCycleEnd && autopayPlans.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sizeId}
                onChange={(e) => setSizeId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                aria-label="Sandbox size"
              >
                {autopayPlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {currency === "USD" ? `$${p.priceUsd}` : `₹${p.priceInr}`}/mo
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || sizeId === sub.planId || sizeId === sub.pendingPlanId}
                onClick={() =>
                  void run(async () => {
                    const r = await postJson<{ scheduleChangeAt: string }>(
                      `/api/billing/subscriptions/${encodeURIComponent(sub.id)}/change`,
                      { planId: sizeId },
                    );
                    return r.scheduleChangeAt === "now"
                      ? `Billing moved to ${planName(sizeId)} now. Moving the running sandbox onto the larger machine is not automatic yet.`
                      : `${planName(sizeId)} starts on ${fmtDate(sub.currentEnd)}. You keep the current size until then.`;
                  })
                }
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 disabled:opacity-40"
              >
                Change size
              </button>
              <span className="text-[11px] text-zinc-500">Upgrades apply now. Downgrades apply at the next renewal.</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {sub.status === "paused" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await postJson(`/api/billing/subscriptions/${encodeURIComponent(sub.id)}/resume`);
                    return "Autopay resumed.";
                  })
                }
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Resume autopay
              </button>
            ) : null}
            {!sub.cancelAtCycleEnd && !confirmCancel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmCancel(true)}
                className="rounded-lg border border-red-900/60 px-4 py-2 text-sm font-medium text-red-300 hover:border-red-700 hover:text-red-200 disabled:opacity-50"
              >
                Cancel subscription
              </button>
            ) : null}
          </div>

          {confirmCancel ? (
            <div role="alertdialog" aria-labelledby="cancel-title" className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-100/90">
              <p id="cancel-title" className="font-semibold text-white">Cancel autopay for {instance.name}?</p>
              <p className="mt-1">
                There are no further charges. You keep the sandbox until{" "}
                <strong>{fmtDate(instance.paidUntil || sub.currentEnd)}</strong>, then it pauses. Files are kept for{" "}
                {props.retentionDays ?? 14} days after that. Payments already made are not refunded.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await postJson(`/api/billing/subscriptions/${encodeURIComponent(sub.id)}/cancel`);
                      setConfirmCancel(false);
                      return `Autopay cancelled. Access continues until ${fmtDate(instance.paidUntil || sub.currentEnd)}.`;
                    })
                  }
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {busy ? "Cancelling…" : "Yes, cancel subscription"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
                >
                  Keep autopay
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : autopayPlans.length ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            {instance.isFree
              ? "Upgrade this workspace with monthly autopay."
              : view && (view.status === "cancelled" || view.status === "completed")
                ? `Autopay ended. ${paidUntilPast ? "Subscribe to keep using this sandbox." : `Access continues until ${fmtDate(instance.paidUntil)}.`}`
                : paidUntilPast
                  ? "Your paid period has ended. Turn on monthly autopay to keep using this sandbox."
                  : `Paid until ${fmtDate(instance.paidUntil)}. Turn on autopay now and the first charge happens on that date.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sizeId}
              onChange={(e) => setSizeId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              aria-label="Sandbox size"
            >
              {autopayPlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {currency === "USD" ? `$${p.priceUsd}` : `₹${p.priceInr}`}/mo
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !autopayPlans.some((p) => p.id === sizeId)}
              onClick={() =>
                void run(async () => {
                  const r = await startAutopayCheckout({ planId: sizeId, currency, email, instanceId: instance.id });
                  return r.pending
                    ? "Payment received. Autopay turns on as soon as Razorpay confirms it."
                    : "Autopay is on.";
                })
              }
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {busy ? "Opening checkout…" : `Subscribe ${priceOf(sizeId)}`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <AutopayNote />
      </div>
    </section>
  );
}
