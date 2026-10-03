'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogEntry } from '@/lib/managed-mcp/catalog';

export type MarketEntry = CatalogEntry & {
  icon?: string; publisher?: string; category?: string;
  auth?: 'none' | 'oauth' | 'secrets'; capabilities?: string[];
};
export type InstalledPlugin = {
  id: string; revision: number; enabled: boolean; trusted: boolean;
  activeDigest: string; configuredKeys: string[];
  manifest: MarketEntry['manifest'] & { name: string; version: string; description?: string };
};
export type Binding = {
  configured: boolean; revision: number | null; status: string;
  sessionId?: string; pluginId?: string; serverId?: string; lastError?: string;
  tools?: Array<{ name: string; description?: string }>;
};
export type Conversation = { sessionId: string; title: string; botId: string; source: string };
type Inventory = { inventory?: { plugins?: InstalledPlugin[] }; bindings?: Record<string, Binding> };

export async function marketJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`);
  return data as T;
}

export function useMarketplace(instanceId: string, botId: string) {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sequence = useRef(0);
  const mutation = useRef(false);
  const base = `/api/instances/${encodeURIComponent(instanceId)}`;
  const call = useCallback(<T,>(action: string, extra: Record<string, unknown> = {}) => marketJson<T>(
    `${base}/bots/${encodeURIComponent(botId)}/plugin-api`,
    { method: 'POST', body: JSON.stringify({ action, ...extra }) },
  ), [base, botId]);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const [inventory, threads] = await Promise.all([
        call<Inventory>('status'),
        marketJson<{ conversations: Conversation[] }>(`${base}/chat/conversations?botId=${encodeURIComponent(botId)}`),
      ]);
      if (sequence.current !== current) return;
      setPlugins(inventory.inventory?.plugins ?? []);
      setBindings(inventory.bindings ?? {});
      setConversations((threads.conversations ?? []).filter((row) => row.botId === botId && row.source !== 'group'));
    } catch (failure) {
      if (sequence.current === current) setError((failure as Error).message);
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  }, [call, base, botId]);

  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    const foreground = () => { if (!document.hidden && !mutation.current) void refresh(); };
    window.addEventListener('focus', foreground);
    return () => { clearTimeout(timer); window.removeEventListener('focus', foreground); };
  }, [refresh]);
  const waiting = Object.values(bindings).some((binding) => ['waiting', 'removing'].includes(binding.status));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { if (!mutation.current) void refresh(); }, 1500);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  async function run(name: string, action: () => Promise<unknown>) {
    if (mutation.current) return false;
    mutation.current = true;
    setBusy(name); setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (failure) {
      setError(`${(failure as Error).message} Refresh the VM status before retrying an action whose outcome is unknown.`);
      return false;
    } finally { mutation.current = false; setBusy(null); }
  }
  const change = (plugin: InstalledPlugin, action: Record<string, unknown>) => call('pluginAction', {
    pluginId: plugin.id, requestId: crypto.randomUUID(),
    pluginAction: { ...action, expectedRevision: plugin.revision },
  });
  return { plugins, bindings, conversations, loading, error, busy, refresh, call, run, change };
}
