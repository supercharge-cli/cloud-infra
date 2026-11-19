"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import {
  defaultImageModel,
  imageModelsForProvider,
  imageProviderFormat,
  lookupProviderDefault,
  mergeCatalogModels,
  modelsForProviderDetailed,
  parseCatalogModels,
  providerNeedsBaseUrl,
  stockBaseUrl,
  type CatalogModel,
} from "@/lib/provider-defaults";
import { ModelPicker } from "@/components/model-picker";
import {
  API_WIRE_FORMATS,
  defaultApiWireFormat,
  normalizeApiWireFormat,
  type ApiWireFormat,
} from "@/lib/api-format";
import type { Instance } from "@/lib/store";
import { SandboxWorkspace } from "@/components/sandbox-workspace";
import { ManagedMcpCard } from "@/components/managed-mcp";
import { AgentChats } from '@/components/agent-chats';
import { AutopayNote, startAutopayCheckout, SubscriptionPanel } from '@/components/billing/subscription-panel';

type AgentRuntime = "xibecode" | "supercharge";

type SavedSlot = {
  id: string;
  provider: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyHint?: string;
  format?: ApiWireFormat;
};

type ConfigView = {
  runtime?: AgentRuntime;
  provider?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
  hasTelegramToken: boolean;
  hasDiscordToken?: boolean;
  hasSlackToken?: boolean;
  apiKey?: string;
  telegramBotToken?: string;
  discordBotToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  allowAllUsers?: boolean;
  apiKeyHint?: string;
  telegramHint?: string;
  discordHint?: string;
  slackHint?: string;
  savedProviders?: SavedSlot[];
  format?: ApiWireFormat;
  imageProvider?: string;
  imageModel?: string;
  imageBaseUrl?: string;
  imageFormat?: string;
  imageApiKey?: string;
  hasImageApiKey?: boolean;
  imageApiKeyHint?: string;
};

type PairingView = {
  pending: Array<{
    code: string;
    platform: string;
    userId: string;
    chatId: string;
  }>;
  approved: Array<{ platform: string; userId: string }>;
};

type DashboardInstance = Instance & {
  liveState?: string;
  resumable?: boolean;
  liveMessage?: string;
  paid?: boolean;
  isFree?: boolean;
  billingStatus?: string;
};

type PlanInfo = {
  priceInr: number;
  priceUsd: number;
  periodDays: number;
  label: string;
  currencies?: {
    INR: { priceLabel: string; buttonLabel: string; display: number };
    USD: { priceLabel: string; buttonLabel: string; display: number };
  };
};

type FreeQuota = {
  limit: number;
  used: number;
  available: number;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("No window"));
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Razorpay"));
    document.body.appendChild(s);
  });
}

export function Dashboard({ email }: { email: string }) {
  const [instances, setInstances] = useState<DashboardInstance[]>([]);
  const [plan, setPlan] = useState<PlanInfo>({
    priceInr: 0,
    priceUsd: 0,
    periodDays: 30,
    label: `${BRAND.plan.label} sandboxes`,
  });
  const [freeQuota, setFreeQuota] = useState<FreeQuota>({
    limit: 1,
    used: 0,
    available: 1,
  });
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingFree, setCreatingFree] = useState(false);
  const [name, setName] = useState("workspace");
  const [runtime, setRuntime] = useState<AgentRuntime>("supercharge");
  const [plans, setPlans] = useState<Array<{ id: string; name: string; priceInr: number; priceUsd: number; autopay?: boolean }>>([]);
  const [billingCfg, setBillingCfg] = useState<{ graceDays?: number; retentionDays?: number }>({});
  const [planId, setPlanId] = useState("hosting-2c4g");
  const [chatMode, setChatMode] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const [logs, setLogs] = useState("");
  const [logsSource, setLogsSource] = useState<
    "all" | "daemon" | "agent" | "system"
  >("all");
  const [logsLoading, setLogsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Opt-in CLI update offer (E2B / Vectra Cloud sandboxes). */
  const [cliUpdate, setCliUpdate] = useState<{
    current: string | null;
    latest: string | null;
    updateAvailable: boolean;
    runtime?: "xibecode" | "supercharge";
  } | null>(null);
  /** Dismissed latest version per instance (session memory). */
  const [cliDismissed, setCliDismissed] = useState<Record<string, string>>({});
  const [systemUpdate, setSystemUpdate] = useState<{
    current: string | null;
    latest: string | null;
    notes: string[];
    updateAvailable: boolean;
  } | null>(null);
  const [systemDismissed, setSystemDismissed] = useState<Record<string, string>>({});

  // form fields
  const [provider, setProvider] = useState("pollinations");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://gen.pollinations.ai/v1");
  const [model, setModel] = useState("openai");
  const [modelOptions, setModelOptions] = useState<CatalogModel[]>([]);
  const [telegramToken, setTelegramToken] = useState("");
  const [discordToken, setDiscordToken] = useState("");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [allowAll, setAllowAll] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [savedProviders, setSavedProviders] = useState<SavedSlot[]>([]);
  const [apiFormat, setApiFormat] = useState<ApiWireFormat>("chat_completions");
  const [byopReady, setByopReady] = useState(false);
  const [imageProvider, setImageProvider] = useState("pollinations");
  const [imageModel, setImageModel] = useState("flux");
  const [imageBaseUrl, setImageBaseUrl] = useState(
    "https://gen.pollinations.ai/v1",
  );
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageFormat, setImageFormat] = useState("pollinations");
  const [imageModelOptions, setImageModelOptions] = useState<string[]>(
    imageModelsForProvider("pollinations"),
  );

  // Command pane (shell in sandbox)
  const [cmdInput, setCmdInput] = useState("");
  const [cmdCwd, setCmdCwd] = useState("/home/user/workspace");
  const [cmdTimeout, setCmdTimeout] = useState(120);
  const [cmdRunning, setCmdRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<
    Array<{
      id: string;
      command: string;
      cwd: string;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      at: string;
      error?: string;
    }>
  >([]);
  const [cmdHistIdx, setCmdHistIdx] = useState(-1);

  const refresh = useCallback(async () => {
    setError("");
    const res = await fetch("/api/instances");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to load instances");
      setInstances([]);
      return;
    }
    setInstances(data.instances || []);
    if (data.plan) setPlan(data.plan);
    if (Array.isArray(data.plans)) setPlans(data.plans);
    if (data.billing && typeof data.billing === "object") setBillingCfg(data.billing);
    // Default 1 free if API omits freeQuota (old deploy) — never silently zero it.
    if (data.freeQuota && typeof data.freeQuota === "object") {
      const limit = Math.max(0, Math.floor(Number(data.freeQuota.limit)));
      const used = Math.max(0, Math.floor(Number(data.freeQuota.used)));
      const availRaw = data.freeQuota.available;
      const available =
        availRaw === undefined || availRaw === null
          ? Math.max(
              0,
              (Number.isFinite(limit) ? limit : 1) -
                (Number.isFinite(used) ? used : 0),
            )
          : Math.max(0, Math.floor(Number(availRaw)));
      setFreeQuota({
        limit: Number.isFinite(limit) ? limit : 1,
        used: Number.isFinite(used) ? used : 0,
        available: Number.isFinite(available) ? available : 1,
      });
    } else {
      setFreeQuota({ limit: 1, used: 0, available: 1 });
    }
  }, []);

  useEffect(() => {
    // Default INR for India (timezone / language), else USD
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      const lang = navigator.language || "";
      if (
        tz.includes("Kolkata") ||
        tz.includes("Calcutta") ||
        lang.toLowerCase().startsWith("hi")
      ) {
        setCurrency("INR");
      } else if (
        !tz.includes("Kolkata") &&
        !lang.toLowerCase().includes("IN")
      ) {
        // Keep INR as product default for this market; user can switch to USD
        setCurrency("INR");
      }
    } catch {
      setCurrency("INR");
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const pre = sp.get("selected");
      if (pre) setSelected(pre);
      if (sp.get("billing")) setChatMode(false);
    } catch {
      /* ignore */
    }
    fetch("/api/pollinations/start")
      .then((r) => r.json())
      .then((d) => setByopReady(Boolean(d.configured)))
      .catch(() => setByopReady(false));
    refresh()
      .then(() => {
        const pre = new URLSearchParams(window.location.search).get("selected");
        if (pre) return loadDetail(pre);
      })
      .finally(() => {
        setLoading(false);
        if (new URLSearchParams(window.location.search).get("billing")) {
          window.setTimeout(() => document.getElementById("billing")?.scrollIntoView({ behavior: "smooth" }), 300);
        }
      });
  }, [refresh]);

  const chosen = plans.find((item) => item.id === planId);
  const chosenInr = chosen?.priceInr || plan.priceInr;
  const chosenUsd = chosen?.priceUsd || plan.priceUsd;
  const priceLabel = currency === "USD" ? `$${chosenUsd}/mo` : `₹${chosenInr}/mo`;
  const buttonLabel = currency === "USD" ? `Pay $${chosenUsd}` : `Pay ₹${chosenInr}`;
  const chosenAutopay = Boolean(chosen?.autopay);
  const createLabel = chosenAutopay
    ? `Subscribe ${priceLabel} & create`
    : `${buttonLabel} & create`;
  const autopayPlanFor = (planIdForInst?: string) =>
    plans.find((p) => p.id === planIdForInst && p.autopay) || plans.find((p) => p.autopay);

  async function payWithRazorpay(opts: {
    purpose: "new_instance" | "renew";
    name?: string;
    instanceId?: string;
    runtime?: AgentRuntime;
  }) {
    setError("");
    await loadRazorpayScript();
    if (!window.Razorpay) throw new Error("Razorpay unavailable");

    const orderRes = await fetch("/api/billing/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: opts.purpose,
        name: opts.name,
        instanceId: opts.instanceId,
        runtime: opts.runtime || runtime,
        planId,
        currency,
      }),
    });
    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.error || "Could not create order");

    return new Promise<void>((resolve, reject) => {
      const descPrice = order.plan?.priceLabel || priceLabel;
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Vectra Cloud",
        description:
          opts.purpose === "renew"
            ? `Renew instance · ${descPrice}`
            : `New instance · ${descPrice}`,
        order_id: order.orderId,
        prefill: { email },
        theme: { color: "#ea580c" },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const vRes = await fetch("/api/billing/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(response),
            });
            const v = await vRes.json();
            if (!vRes.ok) throw new Error(v.error || "Payment verify failed");
            await refresh();
            if (v.instance?.id) {
              setSelected(v.instance.id);
              setLogs(
                `Payment OK · ${opts.purpose} · paid until ${v.paidUntil || v.instance.paidUntil || "—"}`,
              );
              if (opts.purpose === "new_instance") {
                await loadDetail(v.instance.id);
              }
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        },
        modal: {
          ondismiss: () => reject(new Error("Payment cancelled")),
        },
      });
      rzp.open();
    });
  }

  async function createFreeInstance() {
    setCreatingFree(true);
    setError("");
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, runtime }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.message || data.error || "Could not create free instance",
        );
      await refresh();
      if (data.instance?.id) {
        setSelected(data.instance.id);
        setLogs("Free instance created — configure AI + chat channels below.");
        await loadDetail(data.instance.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingFree(false);
    }
  }

  async function createInstance() {
    setCreating(true);
    setError("");
    try {
      if (chosenAutopay) {
        const v = await startAutopayCheckout({ planId, currency, email, name });
        await refresh();
        if (v.instance?.id) {
          setSelected(v.instance.id);
          await loadDetail(v.instance.id);
        } else {
          setLogs("Payment received. Your workspace is being created and appears here in a minute.");
        }
        return;
      }
      await payWithRazorpay({ purpose: "new_instance", name, runtime });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "Payment cancelled") setError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function renewInstance(id: string) {
    setBusy(true);
    setError("");
    try {
      const inst = instances.find((i) => i.id === id);
      const autopay = autopayPlanFor(inst?.plan);
      if (autopay) {
        // Expired one-off or lapsed autopay: move onto autopay (no forced migration before expiry).
        await startAutopayCheckout({ planId: autopay.id, currency, email, instanceId: id });
        await refresh();
        return;
      }
      await payWithRazorpay({ purpose: "renew", instanceId: id });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== "Payment cancelled") setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function loadDetail(id: string) {
    if (selected !== id) {
      setCmdHistory([]);
      setCmdInput("");
      setCmdHistIdx(-1);
      setCmdCwd("/home/user/workspace");
      setCliUpdate(null);
    }
    setSelected(id);
    setBusy(true);
    setLogs("");
    try {
      const cRes = await fetch(`/api/instances/${id}/config`);
      const cData = await cRes.json();
      if (cRes.ok) {
        const s = cData.sandbox as ConfigView | undefined;
        setRuntime(
          cData.runtime === "supercharge" || s?.runtime === "supercharge"
            ? "supercharge"
            : "xibecode",
        );
        setConfig(s || null);
        // Prefill form with whatever is already on the sandbox (env + profile).
        setProvider(s?.provider || "openai");
        setModel(s?.model || "");
        setBaseUrl(s?.baseUrl || stockBaseUrl(s?.provider || "openai"));
        setApiKey(s?.apiKey || "");
        setTelegramToken(s?.telegramBotToken || "");
        setDiscordToken(s?.discordBotToken || "");
        setSlackBotToken(s?.slackBotToken || "");
        setSlackAppToken(s?.slackAppToken || "");
        setAllowAll(Boolean(s?.allowAllUsers));
        setSavedProviders(
          Array.isArray(s?.savedProviders) ? s.savedProviders : [],
        );
        setApiFormat(
          normalizeApiWireFormat(s?.format, s?.provider || "openai"),
        );
        setModelOptions(modelsForProviderDetailed(s?.provider || "pollinations"));
        void refreshModelsForProvider(s?.provider || "pollinations");
        const imgP = s?.imageProvider || s?.provider || "pollinations";
        setImageProvider(imgP);
        setImageModel(s?.imageModel || defaultImageModel(imgP));
        setImageBaseUrl(
          s?.imageBaseUrl || stockBaseUrl(imgP) || s?.baseUrl || "",
        );
        setImageApiKey(s?.imageApiKey || "");
        setImageFormat(s?.imageFormat || imageProviderFormat(imgP));
        setImageModelOptions(imageModelsForProvider(imgP));
      } else {
        setConfig(null);
        setRuntime(
          instances.find((item) => item.id === id)?.runtime === "supercharge"
            ? "supercharge"
            : "xibecode",
        );
        setProvider("pollinations");
        setModel("openai");
        setBaseUrl(stockBaseUrl("pollinations"));
        setApiKey("");
        setTelegramToken("");
        setDiscordToken("");
        setSlackBotToken("");
        setSlackAppToken("");
        setAllowAll(false);
        setSavedProviders([]);
        setApiFormat("chat_completions");
        setError(cData.error || "Config load failed");
      }
      void fetch(`/api/instances/${id}/pairing`)
        .then(async (res) => (res.ok ? (await res.json()).pairing : null))
        .then((value) => value && setPairing(value))
        .catch(() => setPairing({ pending: [], approved: [] }));
      void fetch(`/api/instances/${id}/cli-version`)
        .then(async (res) => (res.ok ? await res.json() : null))
        .then((value) =>
          setCliUpdate(
            value
              ? {
                  current: value.current || null,
                  latest: value.latest || null,
                  runtime: value.runtime === "supercharge" ? "supercharge" : "xibecode",
                  updateAvailable: Boolean(value.updateAvailable),
                }
              : null,
          ),
        )
        .catch(() => setCliUpdate(null));
      void fetch(`/api/instances/${id}/system-version`)
        .then(async (res) => (res.ok ? await res.json() : null))
        .then((value) =>
          setSystemUpdate(
            value
              ? {
                  current: value.current || null,
                  latest: value.latest || null,
                  notes: Array.isArray(value.notes) ? value.notes : [],
                  updateAvailable: Boolean(value.updateAvailable),
                }
              : null,
          ),
        )
        .catch(() => setSystemUpdate(null));
    } finally {
      setBusy(false);
    }
  }

  async function applyCliUpdate() {
    if (!selected || !cliUpdate?.latest) return;
    setBusy(true);
    setLogs("");
    try {
      const res = await fetch(`/api/instances/${selected}/cli-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: cliUpdate.latest }),
      });
      const data = await res.json();
      setLogs(
        [
          data.ok
            ? `CLI update OK · ${data.from || "?"} → ${data.verified || data.to || "?"}`
            : data.error ||
              `CLI update failed · ${data.from || "?"} → ${data.verified || data.to || "?"} (wanted ${cliUpdate.latest})`,
          ...(data.logs || []),
        ].join("\n"),
      );
      if (res.status === 402) {
        setError(data.message || data.error || "Subscription expired");
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error ||
            `CLI still ${data.verified || data.from || "unknown"} after update (wanted ${cliUpdate.latest})`,
        );
      }
      setCliUpdate((prev) =>
        prev
          ? {
              ...prev,
              current: data.verified || data.to || prev.current,
              updateAvailable: false,
            }
          : prev,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyRecreateSandbox() {
    if (!selected) return;
    if (
      !window.confirm(
        "Move this workspace to a new sandbox from the latest template?\n\nChat, files, API keys, and settings come with you. node_modules is skipped. Preview links change. This takes 1–3 minutes.",
      )
    ) {
      return;
    }
    setBusy(true);
    setLogs("");
    try {
      const res = await fetch(`/api/instances/${selected}/recreate`, {
        method: "POST",
      });
      const data = await res.json();
      setLogs(
        [
          data.ok
            ? `Moved to new sandbox ${data.sandboxId || ""} (was ${data.oldSandboxId || "?"})`
            : data.error || "Move to new sandbox failed",
          ...(data.logs || []),
        ].join("\n"),
      );
      if (res.status === 402) {
        setError(data.message || data.error || "Subscription expired");
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Move to new sandbox failed");
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applySystemUpdateClick() {
    if (!selected || !systemUpdate?.latest) return;
    setBusy(true);
    setLogs("");
    try {
      const res = await fetch(`/api/instances/${selected}/system-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: systemUpdate.latest }),
      });
      const data = await res.json();
      const notes = Array.isArray(data.notes) ? data.notes.join("\n") : "";
      setLogs(
        [
          data.ok
            ? `System update OK · ${data.from || "none"} → ${data.to || systemUpdate.latest}`
            : data.error || "System update failed. Version stamp was left unchanged.",
          notes,
          ...(data.logs || []),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      if (!res.ok || !data.ok) throw new Error(data.error || "System update failed");
      setSystemUpdate((prev) =>
        prev ? { ...prev, current: data.to || prev.latest, updateAvailable: false, notes: data.notes || prev.notes } : prev,
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function dismissCliUpdate() {
    if (!selected || !cliUpdate?.latest) {
      setCliUpdate(null);
      return;
    }
    setCliDismissed((m) => ({ ...m, [selected]: cliUpdate.latest! }));
  }

  function slotId(p: string, url?: string) {
    const id = (p || "custom").trim().toLowerCase() || "custom";
    if (id === "custom" && url) {
      try {
        return `custom:${new URL(url).host}`;
      } catch {
        return "custom";
      }
    }
    return id;
  }

  function snapshotCurrent(): SavedSlot {
    const url = baseUrl.trim() || stockBaseUrl(provider);
    return {
      id: slotId(provider, url),
      provider: provider.trim() || "custom",
      model: model || undefined,
      baseUrl: url || undefined,
      apiKey: apiKey || undefined,
      format: apiFormat,
    };
  }

  function applyProviderPick(next: string) {
    setProvider(next);
    setApiFormat(defaultApiWireFormat(next));
    const def = lookupProviderDefault(next);
    const choices = modelsForProviderDetailed(next);
    setModelOptions(choices);
    if (def?.baseUrl) setBaseUrl(def.baseUrl);
    const current = model.trim();
    const ids = choices.map((m) => m.id);
    if (!current || (ids.length > 0 && !ids.includes(current))) {
      setModel(
        def?.defaultModel && ids.includes(def.defaultModel)
          ? def.defaultModel
          : choices[0]?.id || "",
      );
    }
    void refreshModelsForProvider(next);
  }

  function applyImageProviderPick(next: string) {
    setImageProvider(next);
    setImageFormat(imageProviderFormat(next));
    const def = lookupProviderDefault(next);
    if (def?.baseUrl) setImageBaseUrl(def.baseUrl);
    const choices = imageModelsForProvider(next);
    setImageModelOptions(choices);
    const current = imageModel.trim();
    if (!current || (choices.length > 0 && !choices.includes(current))) {
      setImageModel(defaultImageModel(next));
    }
  }

  async function refreshModelsForProvider(next: string) {
    const id = next.trim();
    if (!id || id === "custom") return;
    try {
      const res = await fetch(`/api/models?provider=${encodeURIComponent(id)}`);
      const data = await res.json();
      const live = parseCatalogModels(data.models);
      if (!live.length) return;
      setModelOptions((prev) =>
        mergeCatalogModels(live, prev, modelsForProviderDetailed(id)),
      );
    } catch {
      /* curated already set */
    }
  }

  function upsertLocal(list: SavedSlot[], slot: SavedSlot): SavedSlot[] {
    const idx = list.findIndex((s) => s.id === slot.id);
    if (idx < 0) return [...list, slot];
    const prev = list[idx]!;
    const next = {
      ...prev,
      ...slot,
      apiKey: slot.apiKey || prev.apiKey,
      baseUrl: slot.baseUrl ?? prev.baseUrl,
      model: slot.model ?? prev.model,
      format: slot.format ?? prev.format,
    };
    return list.map((s, i) => (i === idx ? next : s));
  }

  function addAnotherProvider() {
    const cur = snapshotCurrent();
    if (cur.provider) setSavedProviders((list) => upsertLocal(list, cur));
    setProvider("");
    setModel("");
    setBaseUrl("");
    setApiKey("");
  }

  function applySavedProvider(slot: SavedSlot) {
    setProvider(slot.provider);
    setModel(slot.model || "");
    setBaseUrl(slot.baseUrl || stockBaseUrl(slot.provider));
    if (slot.apiKey) setApiKey(slot.apiKey);
    setApiFormat(
      normalizeApiWireFormat(slot.format, slot.provider),
    );
    setModelOptions(modelsForProviderDetailed(slot.provider));
    void refreshModelsForProvider(slot.provider);
  }

  function removeSavedProvider(id: string) {
    setSavedProviders((list) => list.filter((s) => s.id !== id));
    if (slotId(provider, baseUrl) === id) {
      const next = savedProviders.find((s) => s.id !== id);
      if (next) applySavedProvider(next);
    }
  }

  async function saveConfig(restart: boolean) {
    if (!selected) return;
    setBusy(true);
    setLogs("");
    try {
      const current = snapshotCurrent();
      const slots = current.provider
        ? upsertLocal(savedProviders, current)
        : savedProviders;
      const res = await fetch(`/api/instances/${selected}/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: apiKey || undefined,
          baseUrl: baseUrl.trim() || stockBaseUrl(provider),
          model,
          format: apiFormat,
          savedProviders: slots,
          telegramBotToken: telegramToken || undefined,
          discordBotToken: discordToken || undefined,
          slackBotToken: slackBotToken || undefined,
          slackAppToken: slackAppToken || undefined,
          restart,
          allowAllUsers: allowAll,
          imageProvider,
          imageModel,
          imageBaseUrl: imageBaseUrl.trim() || stockBaseUrl(imageProvider),
          imageApiKey: imageApiKey || undefined,
          imageFormat: imageFormat || imageProviderFormat(imageProvider),
        }),
      });
      const data = await res.json();
      setLogs((data.logs || [data.error]).join("\n"));
      if (!res.ok) throw new Error(data.error || "Save failed");
      await refresh();
      await loadDetail(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restartOnly() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/instances/${selected}/restart`, {
        method: "POST",
      });
      const data = await res.json();
      setLogs((data.logs || [data.error]).join("\n"));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Pull daemon / agent / system logs from the sandbox (wakes if paused). */
  async function loadLogs(opts?: {
    source?: "all" | "daemon" | "agent" | "system";
    lines?: number;
  }) {
    if (!selected) return;
    const source = opts?.source || logsSource;
    const lines = opts?.lines ?? 200;
    setLogsLoading(true);
    setBusy(true);
    setError("");
    try {
      const q = new URLSearchParams({
        source,
        lines: String(lines),
      });
      const res = await fetch(
        `/api/instances/${selected}/logs?${q.toString()}`,
      );
      const data = await res.json();
      if (res.status === 402) {
        setError(data.message || data.error || "Subscription expired");
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Failed to load logs");
      }
      setLogsSource(source);
      setLogs(
        data.text ||
          (Array.isArray(data.logs) ? data.logs.join("\n") : "") ||
          "(no log output)",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogsLoading(false);
      setBusy(false);
    }
  }

  async function wakeInstance(id?: string) {
    const target = id || selected;
    if (!target) return;
    setBusy(true);
    setLogs("");
    setSelected(target);
    try {
      const res = await fetch(`/api/instances/${target}/wake`, {
        method: "POST",
      });
      const data = await res.json();
      setLogs(
        [
          data.ok
            ? `Wake OK · state=${data.state || "?"} resumed=${data.resumed ? "yes" : "no"}`
            : data.error || "Wake failed",
          ...(data.logs || []),
        ].join("\n"),
      );
      if (res.status === 402) {
        setError(
          data.message ||
            data.error ||
            "Subscription expired — renew to resume",
        );
        return;
      }
      if (!res.ok) throw new Error(data.error || "Wake failed");
      await refresh();
      await loadDetail(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approvePair(opts?: { platform?: string; code?: string }) {
    const code = (opts?.code || pairCode).trim();
    if (!selected || !code) return;
    setBusy(true);
    try {
      const match = pairing?.pending.find(
        (p) => p.code.toUpperCase() === code.toUpperCase(),
      );
      const platform = opts?.platform || match?.platform || "telegram";
      const res = await fetch(`/api/instances/${selected}/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, platform }),
      });
      const data = await res.json();
      setLogs((data.logs || [data.error || JSON.stringify(data)]).join("\n"));
      setPairCode("");
      await loadDetail(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function destroy(id: string) {
    if (!confirm("Destroy this sandbox? This cannot be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/instances/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      if (selected === id) {
        setSelected(null);
        setConfig(null);
        setPairing(null);
        setCmdHistory([]);
        setCmdInput("");
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(raw?: string) {
    if (!selected) return;
    const command = (raw ?? cmdInput).trim();
    if (!command || cmdRunning) return;

    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCmdRunning(true);
    setError("");
    setCmdHistIdx(-1);

    // Optimistic pending row
    setCmdHistory((h) =>
      [
        {
          id: entryId,
          command,
          cwd: cmdCwd,
          exitCode: null,
          stdout: "",
          stderr: "Running…",
          at: new Date().toISOString(),
        },
        ...h,
      ].slice(0, 50),
    );

    try {
      const res = await fetch(`/api/instances/${selected}/exec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          command,
          cwd: cmdCwd || "/home/user/workspace",
          timeout: cmdTimeout,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setError(
          data.message ||
            data.error ||
            "Subscription expired — renew to run commands",
        );
        setCmdHistory((h) =>
          h.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  exitCode: 1,
                  stderr: data.message || data.error || "Payment required",
                  error: data.error,
                }
              : e,
          ),
        );
        return;
      }

      if (!res.ok && data.exitCode === undefined) {
        throw new Error(data.error || `Exec failed (${res.status})`);
      }

      setCmdHistory((h) =>
        h.map((e) =>
          e.id === entryId
            ? {
                ...e,
                cwd: data.cwd || cmdCwd,
                exitCode:
                  typeof data.exitCode === "number"
                    ? data.exitCode
                    : res.ok
                      ? 0
                      : 1,
                stdout: data.stdout || "",
                stderr: data.stderr || data.message || data.error || "",
                error: res.ok ? undefined : data.error,
              }
            : e,
        ),
      );

      if (!raw) setCmdInput("");
      // Soft-refresh status after shell activity (may wake paused sandbox)
      void refresh();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      setCmdHistory((h) =>
        h.map((row) =>
          row.id === entryId
            ? { ...row, exitCode: 1, stderr: msg, error: msg }
            : row,
        ),
      );
    } finally {
      setCmdRunning(false);
    }
  }

  function onCmdKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void runCommand();
      return;
    }
    // Up/down cycle previous commands
    const prevCmds = cmdHistory.map((h) => h.command);
    if (e.key === "ArrowUp" && prevCmds.length) {
      e.preventDefault();
      const next = Math.min(cmdHistIdx + 1, prevCmds.length - 1);
      setCmdHistIdx(next);
      setCmdInput(prevCmds[next] || "");
    } else if (e.key === "ArrowDown" && cmdHistIdx >= 0) {
      e.preventDefault();
      const next = cmdHistIdx - 1;
      setCmdHistIdx(next);
      setCmdInput(next < 0 ? "" : prevCmds[next] || "");
    }
  }

  const quickCmds = [
    { label: "pwd", cmd: "pwd" },
    { label: "ls", cmd: "ls -la" },
    {
      label: "disk",
      cmd: "df -h /home/user 2>/dev/null; du -sh /home/user/workspace 2>/dev/null || true",
    },
    { label: "procs", cmd: "ps aux --sort=-%mem | head -20" },
    {
      label: "daemon log",
      cmd: 'tail -n 80 /tmp/xibecode-daemon.log 2>/dev/null || echo "no daemon log yet"',
    },
    {
      label: "xibecode -v",
      cmd: "xibecode --version 2>&1 || which xibecode || true",
    },
  ];

  const selectedInst = instances.find((i) => i.id === selected);
  const chatInstance = selectedInst?.runtime === 'supercharge' ? selectedInst : instances.find((instance) => instance.runtime === 'supercharge');
  if (!loading && chatMode && chatInstance) {
    return <AgentChats key={chatInstance.id} workspace={chatInstance} onSettings={() => { setChatMode(false); void loadDetail(chatInstance.id); }} />;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Workspace settings</h1>
          {chatInstance && <button type="button" className="mt-3 text-sm text-emerald-300 hover:underline" onClick={() => setChatMode(true)}>Back to agent chats</button>}
          <p className="mt-1 text-sm text-zinc-400">
            Signed in as <span className="text-zinc-200">{email}</span> · plan{" "}
            <span className="text-orange-400">{BRAND.plan.label}</span>
          </p>
        </div>
        <Link href="/docs" className="text-sm text-orange-400 hover:underline">
          Hosting docs →
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
          <button
            type="button"
            className="ml-3 text-red-200 underline"
            onClick={() => setError("")}
          >
            dismiss
          </button>
        </div>
      ) : null}

      {!loading && instances.length === 0 && <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Create sandbox</h2>
          <div className="flex items-center gap-2">
            {freeQuota.limit > 0 ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                Free: {freeQuota.available}/{freeQuota.limit} left
              </span>
            ) : null}
            <div className="flex rounded-full border border-zinc-700 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setCurrency("INR")}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  currency === "INR"
                    ? "bg-orange-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                ₹{chosenInr || "—"}
              </button>
              <button
                type="button"
                onClick={() => setCurrency("USD")}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  currency === "USD"
                    ? "bg-orange-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                ${chosenUsd || "—"}
              </button>
            </div>
            <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
              {priceLabel} · {plan.periodDays}d
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-2 flex flex-wrap gap-1">
              {(plans.length ? plans : [{ id: "hosting-2c4g", name: "2 vCPU · 4 GB", priceInr: chosenInr, priceUsd: chosenUsd }]).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPlanId(item.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    planId === item.id ? "bg-orange-600 text-white" : "border border-zinc-700 text-zinc-400"
                  }`}
                >
                  {item.name} · ₹{item.priceInr} / ${item.priceUsd}
                </button>
              ))}
            </div>
            <p className="max-w-xs text-[11px] text-zinc-500">
              USD is the rupee price at ₹95 per dollar, plus 8%. {plan.periodDays} days.
            </p>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="workspace name"
            className="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
          />
          {freeQuota.available > 0 && planId === "hosting-2c4g" ? (
            <button
              type="button"
              disabled={creatingFree || creating || busy}
              onClick={() => void createFreeInstance()}
              className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {creatingFree ? "Creating free…" : "Create free instance"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={creating || creatingFree || busy}
            onClick={createInstance}
            className="rounded-lg bg-orange-600 px-5 py-2 font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
          >
            {creating ? "Opening checkout…" : createLabel}
          </button>
        </div>
        {chosenAutopay ? <div className="mt-3 max-w-2xl"><AutopayNote /></div> : null}
        <p className="mt-2 text-xs text-zinc-500">
          {freeQuota.limit > 0 ? (
            <>
              Every account includes{" "}
              <strong className="text-zinc-400">{freeQuota.limit} free</strong>{" "}
              workspace (no expiry). Add agents inside your workspace. Hosting via Razorpay · India{" "}
              <strong className="text-zinc-400">₹{plan.priceInr || "—"}</strong>{" "}
              · International{" "}
              <strong className="text-zinc-400">${plan.priceUsd || "—"}</strong>{" "}
              · {plan.periodDays} days.
            </>
          ) : (
            <>
              Razorpay · India{" "}
              <strong className="text-zinc-400">₹{plan.priceInr || "—"}</strong>{" "}
              · International{" "}
              <strong className="text-zinc-400">${plan.priceUsd || "—"}</strong>{" "}
              · {plan.periodDays} days access · sandbox only after payment.
            </>
          )}
        </p>
      </div>}

      <p className="mb-3 text-xs text-zinc-500">
        Your sandboxes stay listed when{" "}
        <span className="text-amber-400">paused</span> (idle) — open them
        anytime and hit Resume. Only Destroy removes them.
      </p>

      {loading ? (
        <p className="text-zinc-500">Loading instances…</p>
      ) : instances.length === 0 ? (
        <p className="text-zinc-500">No instances yet. Create one above.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {instances.map((inst) => {
            const displayStatus = inst.liveState || inst.status;
            const isPaused =
              displayStatus === "paused" || inst.status === "paused";
            return (
              <div
                key={inst.id}
                className={`rounded-xl border p-4 transition ${
                  selected === inst.id
                    ? "border-orange-500/60 bg-orange-500/5"
                    : isPaused
                      ? "border-amber-800/50 bg-zinc-950"
                      : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                }`}
              >
                <button
                  type="button"
                  onClick={() => loadDetail(inst.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">
                      {inst.name}
                    </span>
                    <StatusPill status={displayStatus} />
                  </div>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {inst.id}
                    {inst.sandboxId ? ` · ${inst.sandboxId.slice(0, 12)}…` : ""}
                  </p>
                  <p className="mt-2 text-xs text-zinc-400">
                    AI {inst.aiConfigured ? "✓" : "—"} · Chat{" "}
                    {inst.telegramConfigured
                      ? [
                          inst.config?.hasTelegramToken ? "TG" : null,
                          inst.config?.hasDiscordToken ? "DC" : null,
                          inst.config?.hasSlackToken ? "SL" : null,
                        ]
                          .filter(Boolean)
                          .join("+") || "✓"
                      : "—"}
                    {inst.isFree ? (
                      <span className="ml-2 text-emerald-400">· free tier</span>
                    ) : inst.paid === false ||
                      inst.billingStatus === "past_due" ? (
                      <span className="ml-2 text-red-400">
                        · payment expired
                      </span>
                    ) : inst.billingStatus === "grace" ? (
                      <span className="ml-2 text-red-400">
                        · payment failed, retrying
                      </span>
                    ) : inst.paidUntil ? (
                      <span className="ml-2 text-zinc-500">
                        · {inst.subscriptionStatus === "active" && !inst.cancelAtCycleEnd ? "renews" : "paid until"}{" "}
                        {new Date(inst.paidUntil).toLocaleDateString()}
                      </span>
                    ) : null}
                    {isPaused ? (
                      <span className="ml-2 text-amber-400">
                        · idle paused — still yours
                      </span>
                    ) : null}
                  </p>
                </button>
                {!inst.isFree &&
                (inst.paid === false || inst.billingStatus === "past_due") ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void renewInstance(inst.id);
                    }}
                    className="mt-3 w-full rounded-lg bg-orange-600 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    {autopayPlanFor(inst.plan) ? "Subscribe to resume" : `Renew ${priceLabel}`}
                  </button>
                ) : isPaused && inst.resumable !== false ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void wakeInstance(inst.id);
                    }}
                    className="mt-3 w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Resume sandbox
                  </button>
                ) : null}
                {displayStatus === "missing" || displayStatus === "error" ? (
                  <p className="mt-2 text-xs text-red-400">
                    {inst.liveMessage ||
                      inst.lastError ||
                      "Sandbox missing on provider"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {selectedInst ? (
        <div className="mt-8 space-y-6">
          {!selectedInst.isFree &&
            (selectedInst.paid === false ||
              selectedInst.billingStatus === "past_due") && (
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-100/90">
                Subscription expired
                {selectedInst.paidUntil
                  ? ` (${new Date(selectedInst.paidUntil).toLocaleDateString()})`
                  : ""}
                . Renew for <strong>{priceLabel}</strong> (₹{plan.priceInr} / $
                {plan.priceUsd}) to wake and use this instance.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => renewInstance(selectedInst.id)}
                  className="ml-3 rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white"
                >
                  {autopayPlanFor(selectedInst.plan) ? "Subscribe" : "Renew now"}
                </button>
              </div>
            )}
          {selectedInst.isFree ? (
            <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100/90">
              This is your <strong>free tier</strong> instance — no payment
              required, no expiry. Need another sandbox? Use{" "}
              <strong>Pay & create</strong> above.
            </div>
          ) : null}
          <SubscriptionPanel
            key={selectedInst.id}
            instance={selectedInst}
            plans={plans}
            currency={currency}
            email={email}
            graceDays={billingCfg.graceDays}
            retentionDays={billingCfg.retentionDays}
            onChanged={refresh}
          />
          {(selectedInst.liveState === "paused" ||
            selectedInst.status === "paused") &&
            selectedInst.paid !== false && (
              <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90">
                This sandbox is <strong>paused</strong> (saved securely). Click{" "}
                <strong>Wake / resume</strong>, or DM the Telegram bot (first
                message wakes the VM — send again after the bot replies). Config
                and files are preserved.
              </div>
            )}
          {cliUpdate?.updateAvailable &&
            cliUpdate.latest &&
            cliDismissed[selectedInst.id] !== cliUpdate.latest && (
              <div className="rounded-xl border border-sky-800/50 bg-sky-950/30 px-4 py-3 text-sm text-sky-50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong className="text-white">
                      Supercharge update available
                    </strong>
                    <p className="mt-1 text-sky-100/90">
                      {cliUpdate.latest} available
                      {cliUpdate.current ? (
                        <>
                          {" "}
                          (you have{" "}
                          <code className="text-sky-200">
                            {cliUpdate.current}
                          </code>
                          )
                        </>
                      ) : null}
                      . Opt-in only — installs on this sandbox and restarts the
                      daemon. Workspace and{" "}
                      <code className="text-sky-200">
                        {cliUpdate.runtime === "supercharge" ? "~/.supercharge" : "~/.xibecode"}
                      </code>{" "}
                      secrets are kept.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void applyCliUpdate()}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      Update &amp; restart
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={dismissCliUpdate}
                      className="rounded-lg border border-sky-800/60 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-950/50 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}
          {systemUpdate?.updateAvailable &&
            systemUpdate.latest &&
            selectedInst.runtime === "supercharge" &&
            systemDismissed[selectedInst.id] !== systemUpdate.latest && (
              <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-50">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong className="text-white">Sandbox system update available</strong>
                    <p className="mt-1 text-emerald-100/90">
                      {systemUpdate.latest}
                      {systemUpdate.current ? ` (this sandbox has ${systemUpdate.current})` : " (this sandbox has no system stamp yet)"}
                      . The next wake installs it on this sandbox. You can also apply it now.
                      Your workspace stays.
                    </p>
                    {systemUpdate.notes.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-emerald-100/80">
                        {systemUpdate.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void applySystemUpdateClick()}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Update this sandbox
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setSystemDismissed((current) => ({
                          ...current,
                          [selectedInst.id]: systemUpdate.latest!,
                        }))
                      }
                      className="rounded-lg border border-emerald-800/60 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-950/50 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-white">
              Manage · {selectedInst.name}{" "}
              <span className="align-middle">
                <StatusPill
                  status={selectedInst.liveState || selectedInst.status}
                />
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void applyRecreateSandbox()}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
              >
                Move to new sandbox
              </button>
              {!selectedInst.isFree &&
                (selectedInst.paid === false ||
                  selectedInst.billingStatus === "past_due") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => renewInstance(selectedInst.id)}
                    className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    {autopayPlanFor(selectedInst.plan) ? "Subscribe" : `Renew ${buttonLabel}`}
                  </button>
                )}
              <button
                type="button"
                disabled={busy}
                onClick={() => wakeInstance()}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Wake / resume
              </button>
              <button
                type="button"
                disabled={busy || logsLoading}
                onClick={() => void loadLogs({ source: "all" })}
                className="rounded-lg border border-sky-800/60 bg-sky-950/40 px-3 py-1.5 text-sm font-medium text-sky-100 hover:bg-sky-900/40 disabled:opacity-50"
                title="Read daemon + agent logs from the sandbox (wakes if paused)"
              >
                {logsLoading ? "Loading logs…" : "View logs"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={restartOnly}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-50"
              >
                Restart daemon
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => destroy(selectedInst.id)}
                className="rounded-lg border border-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                Destroy
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 font-semibold text-white">
              AI + chat channels
            </h3>
            {config ? (
              <p className="mb-4 text-xs text-zinc-500">
                On sandbox: API {config.hasApiKey ? config.apiKeyHint : "none"}{" "}
                · TG {config.hasTelegramToken ? config.telegramHint : "—"} · DC{" "}
                {config.hasDiscordToken ? config.discordHint : "—"} · SL{" "}
                {config.hasSlackToken ? config.slackHint : "—"} ·{" "}
                {config.provider || "?"} / {config.model || "no model"} /{" "}
                {config.format || apiFormat}
              </p>
            ) : null}
            <div className="mb-3 rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-3 py-2.5">
              <p className="text-[11px] font-semibold tracking-wider text-emerald-400">
                BEST · CHEAPEST
              </p>
              <p className="mt-1 text-sm text-zinc-200">
                <strong className="text-white">Pollinations</strong> — huge
                model list (GPT, Claude, Gemini, Qwen…) on one cheap Pollen
                balance. Use this unless you already pay another API.
              </p>
            </div>
            <div className="mb-3">
              <a
                href="/pollinations"
                className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 sm:w-auto"
              >
                {byopReady
                  ? "Pollinations · connect once for every VM"
                  : "Open Pollinations"}
              </a>
              <p className="mt-1.5 text-xs text-zinc-500">
                One account connect applies to this workspace and every new one.
                Manage usage and disconnect there.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Provider">
                <input
                  list="ai-providers"
                  value={provider}
                  onChange={(e) => applyProviderPick(e.target.value)}
                  placeholder="pollinations (recommended), openai, openrouter…"
                  className="field"
                />
                <datalist id="ai-providers">
                  <option value="pollinations" />
                  <option value="openai" />
                  <option value="anthropic" />
                  <option value="routingrun" />
                  <option value="openrouter" />
                  <option value="grok" />
                  <option value="google" />
                  <option value="nous" />
                  <option value="deepseek" />
                  <option value="custom" />
                </datalist>
              </Field>
              <Field label="Model">
                <ModelPicker
                  value={model}
                  options={modelOptions}
                  onChange={setModel}
                  placeholder="Search by name or id"
                />
              </Field>
              {provider.trim().toLowerCase() === "pollinations" ? (
                <div className="sm:col-span-2">
                  <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                    <summary className="cursor-pointer text-xs text-zinc-400">
                      Or paste a secret key (sk_)
                    </summary>
                    <div className="mt-2">
                      <Field label="Pollinations secret key">
                        <input
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          type="text"
                          autoComplete="off"
                          placeholder="sk_… only if you already have one"
                          className="field"
                        />
                      </Field>
                    </div>
                  </details>
                </div>
              ) : (
                <Field label="API key">
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type="text"
                    autoComplete="off"
                    placeholder="sk-… or provider key"
                    className="field"
                  />
                </Field>
              )}
              <Field label="API format">
                <select
                  value={apiFormat}
                  onChange={(e) =>
                    setApiFormat(
                      normalizeApiWireFormat(e.target.value, provider),
                    )
                  }
                  className="field"
                >
                  {API_WIRE_FORMATS.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label} · {row.hint}
                    </option>
                  ))}
                </select>
              </Field>
              {providerNeedsBaseUrl(provider, baseUrl) ? (
                <Field label="Base URL">
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://…/v1"
                    className="field"
                  />
                </Field>
              ) : null}
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs text-zinc-500">
                  Saved providers keep their own key and URL (like Hermes). Add
                  another without wiping this one, then pick it from{" "}
                  <code>/model</code> or change protocol with{" "}
                  <code>/format</code> in the app.
                </p>
                <div className="flex flex-wrap gap-2">
                  {savedProviders.map((s) => {
                    const active = slotId(provider, baseUrl) === s.id;
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
                          active
                            ? "border-emerald-700 bg-emerald-950/40 text-emerald-200"
                            : "border-zinc-800 bg-zinc-900 text-zinc-300"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => applySavedProvider(s)}
                        >
                          {s.provider}
                          {s.model ? ` · ${s.model}` : ""}
                          {s.apiKeyHint ? ` · ${s.apiKeyHint}` : ""}
                        </button>
                        <button
                          type="button"
                          className="pl-1 text-zinc-500 hover:text-red-400"
                          onClick={() => removeSavedProvider(s.id)}
                          aria-label={`Remove ${s.provider}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addAnotherProvider}
                    className="rounded-full border border-dashed border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:border-emerald-700 hover:text-emerald-300"
                  >
                    + Add another provider
                  </button>
                </div>
              </div>
              {runtime === "supercharge" ? (
                <div className="sm:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                  <p className="mb-1 text-sm font-semibold text-white">
                    Image generation
                  </p>
                  <p className="mb-3 text-xs text-zinc-500">
                    Independent of chat. Writes{" "}
                    <code>[image_provider]</code> for <code>/imagine</code>.
                    In chat: <code>/isetup</code>, <code>/imodels</code>. Any
                    custom model id is allowed.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Image provider">
                      <input
                        list="image-providers"
                        value={imageProvider}
                        onChange={(e) => applyImageProviderPick(e.target.value)}
                        placeholder="pollinations, openai, custom…"
                        className="field"
                      />
                      <datalist id="image-providers">
                        <option value="pollinations" />
                        <option value="openai" />
                        <option value="openrouter" />
                        <option value="google" />
                        <option value="custom" />
                      </datalist>
                    </Field>
                    <Field label="Image model">
                      <input
                        list="image-models"
                        value={imageModel}
                        onChange={(e) => setImageModel(e.target.value)}
                        placeholder="flux or any custom id"
                        className="field"
                      />
                      <datalist id="image-models">
                        {imageModelOptions.map((id) => (
                          <option key={id} value={id} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label="Image format">
                      <select
                        value={imageFormat}
                        onChange={(e) => setImageFormat(e.target.value)}
                        className="field"
                      >
                        <option value="openai_images">openai_images</option>
                        <option value="pollinations">pollinations</option>
                        <option value="custom">custom</option>
                      </select>
                    </Field>
                    <Field label="Image API key (optional)">
                      <input
                        value={imageApiKey}
                        onChange={(e) => setImageApiKey(e.target.value)}
                        type="text"
                        autoComplete="off"
                        placeholder="empty = reuse chat key / none"
                        className="field"
                      />
                    </Field>
                    {providerNeedsBaseUrl(imageProvider, imageBaseUrl) ? (
                      <Field label="Image base URL">
                        <input
                          value={imageBaseUrl}
                          onChange={(e) => setImageBaseUrl(e.target.value)}
                          placeholder="https://…/v1"
                          className="field"
                        />
                      </Field>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <Field label="Telegram bot token">
                <input
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="123456:ABC… (BotFather)"
                  className="field"
                />
              </Field>
              <Field label="Discord bot token">
                <input
                  value={discordToken}
                  onChange={(e) => setDiscordToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="Discord bot token · Message Content Intent on"
                  className="field"
                />
              </Field>
              <Field label="Slack bot token (xoxb-)">
                <input
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="xoxb-…"
                  className="field"
                />
              </Field>
              <Field label="Slack app token (xapp-)">
                <input
                  value={slackAppToken}
                  onChange={(e) => setSlackAppToken(e.target.value)}
                  type="text"
                  autoComplete="off"
                  placeholder="xapp-… (Socket Mode)"
                  className="field"
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={allowAll}
                onChange={(e) => setAllowAll(e.target.checked)}
              />
              Allow all users on every channel (disable pairing)
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => saveConfig(true)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Save &amp; start bot
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveConfig(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-900 disabled:opacity-50"
              >
                Save env only
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-white">Command pane</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Run shell commands in this sandbox (wakes if paused). Same as{" "}
                  <code className="text-zinc-400">/cmd</code> in chat. Working directory defaults to{" "}
                  <span className="font-mono text-zinc-400">
                    /home/user/workspace
                  </span>
                  .
                </p>
              </div>
              <button
                type="button"
                disabled={!cmdHistory.length}
                onClick={() => setCmdHistory([])}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 disabled:opacity-40"
              >
                Clear history
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {quickCmds.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={
                    cmdRunning ||
                    busy ||
                    selectedInst.paid === false ||
                    selectedInst.billingStatus === "past_due"
                  }
                  onClick={() => void runCommand(q.cmd)}
                  className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-xs font-medium text-zinc-300 hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>

            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_100px]">
              <Field label="Working directory (cwd)">
                <input
                  value={cmdCwd}
                  onChange={(e) => setCmdCwd(e.target.value)}
                  placeholder="/home/user/workspace"
                  className="field font-mono text-sm"
                  spellCheck={false}
                />
              </Field>
              <Field label="Timeout (s)">
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={cmdTimeout}
                  onChange={(e) => setCmdTimeout(Number(e.target.value) || 120)}
                  className="field font-mono text-sm"
                />
              </Field>
            </div>

            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-orange-500">
                  $
                </span>
                <input
                  value={cmdInput}
                  onChange={(e) => {
                    setCmdInput(e.target.value);
                    setCmdHistIdx(-1);
                  }}
                  onKeyDown={onCmdKeyDown}
                  disabled={
                    cmdRunning ||
                    selectedInst.paid === false ||
                    selectedInst.billingStatus === "past_due"
                  }
                  placeholder="ls -la · git status · npm install · …  (Enter to run, ↑↓ history)"
                  className="field font-mono text-sm !pl-8"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <button
                type="button"
                disabled={
                  cmdRunning ||
                  !cmdInput.trim() ||
                  selectedInst.paid === false ||
                  selectedInst.billingStatus === "past_due"
                }
                onClick={() => void runCommand()}
                className="shrink-0 rounded-lg bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                {cmdRunning ? "Running…" : "Run"}
              </button>
            </div>

            <div className="mt-4 max-h-[28rem] space-y-3 overflow-auto rounded-xl border border-zinc-800 bg-black p-3">
              {cmdHistory.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-zinc-600">
                  No commands yet. Try a quick action or type a command above.
                </p>
              ) : (
                cmdHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="border-b border-zinc-900 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="text-orange-500">$</span>
                      <span className="text-zinc-100">{entry.command}</span>
                      <span className="text-zinc-600">· {entry.cwd}</span>
                      {entry.exitCode === null ? (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          …
                        </span>
                      ) : (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            entry.exitCode === 0
                              ? "bg-emerald-950 text-emerald-400"
                              : "bg-red-950 text-red-400"
                          }`}
                        >
                          exit {entry.exitCode}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {new Date(entry.at).toLocaleTimeString()}
                      </span>
                    </div>
                    {entry.stdout ? (
                      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
                        {entry.stdout}
                      </pre>
                    ) : null}
                    {entry.stderr ? (
                      <pre
                        className={`mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed ${
                          entry.exitCode === 0 || entry.exitCode === null
                            ? "text-zinc-500"
                            : "text-red-400/90"
                        }`}
                      >
                        {entry.stderr}
                      </pre>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <SandboxWorkspace
            instanceId={selectedInst.id}
            sandboxId={selectedInst.sandboxId}
            runtime={selectedInst.runtime || 'xibecode'}
            disabled={
              selectedInst.paid === false ||
              selectedInst.billingStatus === "past_due"
            }
          />

          {selectedInst.runtime === "supercharge" ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <h3 className="mb-3 font-semibold text-white">Managed MCP (isolated Plugin API)</h3>
              <p className="mb-3 text-sm text-zinc-400">
                Install a reviewed MCP definition into this sandbox&apos;s isolated
                Plugin API service and apply it to one bot conversation. Secrets
                stay inside the sandbox; mobile uses the same owner-checked route.
              </p>
              <ManagedMcpCard instanceId={selectedInst.id} />
            </div>
          ) : null}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 font-semibold text-white">Channel pairing</h3>
            <p className="mb-3 text-sm text-zinc-400">
              User messages Telegram / Discord / Slack → gets a code → approve
              here.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value)}
                placeholder="Paste pairing code"
                className="field min-w-[180px] flex-1"
              />
              <button
                type="button"
                disabled={busy || !pairCode.trim()}
                onClick={() => void approvePair()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => selected && loadDetail(selected)}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300"
              >
                Refresh
              </button>
            </div>
            {pairing ? (
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    Pending
                  </p>
                  {pairing.pending.length === 0 ? (
                    <p className="text-zinc-600">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {pairing.pending.map((p) => (
                        <li
                          key={`${p.platform}-${p.code}`}
                          className="font-mono text-amber-300"
                        >
                          <button
                            type="button"
                            className="underline decoration-amber-700/50 hover:text-amber-200"
                            onClick={() =>
                              void approvePair({
                                code: p.code,
                                platform: p.platform,
                              })
                            }
                          >
                            {p.code}
                          </button>{" "}
                          <span className="text-zinc-500">
                            ({p.platform} {p.userId})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                    Approved
                  </p>
                  {pairing.approved.length === 0 ? (
                    <p className="text-zinc-600">None</p>
                  ) : (
                    <ul className="space-y-1">
                      {pairing.approved.map((p, i) => (
                        <li key={i} className="font-mono text-emerald-300/90">
                          {p.platform}:{p.userId}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-white">Logs</h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Daemon, agent, and process output from the sandbox. Use this
                  when Telegram goes quiet or a run looks stuck.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["daemon", "Daemon"],
                    ["agent", "Agent"],
                    ["system", "System"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || logsLoading}
                    onClick={() => void loadLogs({ source: key })}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                      logsSource === key && logs
                        ? "bg-sky-600 text-white"
                        : "border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy || logsLoading || !logs}
                  onClick={() => {
                    void navigator.clipboard?.writeText(logs);
                  }}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  Copy
                </button>
                <button
                  type="button"
                  disabled={busy || logsLoading}
                  onClick={() =>
                    void loadLogs({ source: logsSource, lines: 400 })
                  }
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                >
                  {logsLoading ? "…" : "Refresh"}
                </button>
              </div>
            </div>
            {logs ? (
              <pre className="max-h-96 overflow-auto rounded-xl border border-zinc-800 bg-black p-4 text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
                {logs}
              </pre>
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-600">
                Click <strong className="text-zinc-400">View logs</strong> above
                (or a source filter) to load live logs from this sandbox.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(63 63 70);
          background: rgb(24 24 27);
          padding: 0.5rem 0.75rem;
          color: white;
          outline: none;
        }
        .field:focus {
          border-color: rgb(249 115 22);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-emerald-950 text-emerald-300 border-emerald-800"
      : status === "paused"
        ? "bg-amber-950 text-amber-300 border-amber-800"
        : status === "error" || status === "missing"
          ? "bg-red-950 text-red-300 border-red-900"
          : "bg-zinc-900 text-zinc-400 border-zinc-700";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${color}`}
    >
      {status}
    </span>
  );
}
