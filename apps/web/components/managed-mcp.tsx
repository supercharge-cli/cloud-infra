'use client';

import { useCallback, useEffect, useState } from 'react';

type Tool = { name: string; description: string | null };
type Binding = {
  configured: boolean;
  revision: number | null;
  status: string;
  serverName?: string | null;
  agentSessionId?: string | null;
  pluginId?: string | null;
  serverId?: string | null;
  lastError?: string | null;
  tools?: Tool[];
};

const STATES = ['saved', 'waiting', 'applied', 'ready', 'failed', 'removing', 'removed'] as const;

/**
 * Managed MCP (isolated Plugin API) card for one owned instance.
 * Talks only to owner-checked Vectra routes; credentials, target
 * identity, and the bridge live entirely inside the sandbox.
 */
export function ManagedMcpCard({ instanceId }: { instanceId: string }) {
  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [botId, setBotId] = useState('main');
  const [binding, setBinding] = useState<Binding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manifestText, setManifestText] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [verifyTool, setVerifyTool] = useState('');
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/instances/${encodeURIComponent(instanceId)}/bots`)
      .then((res) => (res.ok ? res.json() : { bots: [] }))
      .then((data: { bots?: Array<{ id: string; name: string }> }) => {
        if (cancelled) return;
        const list = data.bots ?? [];
        setBots(list);
        if (list.length && !list.some((bot) => bot.id === botId)) setBotId(list[0]!.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const call = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/bots/${encodeURIComponent(botId)}/plugin-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`);
      return data as { binding?: Binding; bindings?: Record<string, Binding>; plugin?: { id?: string } };
    },
    [instanceId, botId],
  );

  const run = useCallback(
    async (key: string, task: () => Promise<void>) => {
      if (busy) return;
      setBusy(key);
      setError(null);
      try {
        await task();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [busy],
  );

  const load = useCallback(() => {
    void run('status', async () => {
      const data = await call('status');
      const all = data.bindings ?? {};
      const values = Object.entries(all);
      const picked = conversationId
        ? values.find(([sessionId]) => sessionId === conversationId)?.[1]
        : values[0]?.[1];
      setBinding(picked ?? null);
    });
  }, [call, run, conversationId]);

  useEffect(load, [load]);

  const poll = binding && ['waiting', 'removing'].includes(binding.status);
  useEffect(() => {
    if (!poll) return;
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [poll, load]);

  const stateTone = (status: string | undefined) =>
    status === 'ready' ? 'ok' : status === 'failed' ? 'bad' : status === 'removed' || !status ? 'idle' : 'wait';

  return (
    <div className="mcp-card" data-testid="managed-mcp-card">
      <header className="mcp-card__head">
        <label className="mcp-field">
          <span>Bot</span>
          <select value={botId} onChange={(e) => { setBotId(e.target.value); setBinding(null); }}>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>{bot.name}</option>
            ))}
          </select>
        </label>
        <span className={`mcp-state mcp-state--${stateTone(binding?.status)}`} role="status">
          {binding?.configured ? `Sandbox state: ${binding.status}` : 'Not configured'}
        </span>
      </header>
      {error ? <p className="mcp-error" role="alert">{error}</p> : null}
      {binding?.lastError ? <p className="mcp-error">{binding.lastError}</p> : null}

      <details className="mcp-section">
        <summary>Install a reviewed MCP definition</summary>
        <textarea
          className="mcp-json"
          rows={8}
          spellCheck={false}
          placeholder='{"schemaVersion":1,"id":"my-mcp","name":"My MCP","version":"1.0.0","apiVersion":"1","permissions":["mcp:stdio"],"mcpServers":{"main":{"transport":"stdio","command":"/usr/bin/node","args":["server.mjs"]}},"userConfig":{}}'
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
        />
        <div className="mcp-row">
          <button
            type="button"
            disabled={!!busy || !manifestText.trim()}
            onClick={() =>
              void run('validate', async () => {
                await call('validate', { manifest: JSON.parse(manifestText) });
              })
            }
          >
            {busy === 'validate' ? 'Validating…' : 'Validate (no install)'}
          </button>
          <button
            type="button"
            disabled={!!busy || !manifestText.trim()}
            onClick={() =>
              void run('install', async () => {
                const data = await call('install', {
                  manifest: JSON.parse(manifestText),
                  requestId: crypto.randomUUID(),
                });
                setManifestText('');
                load();
                void data;
              })
            }
          >
            {busy === 'install' ? 'Installing disabled…' : 'Install disabled'}
          </button>
        </div>
        <p className="mcp-hint">Installs disabled and untrusted. Configure, trust, and enable it below before applying.</p>
      </details>

      <div className="mcp-section">
        <label className="mcp-field">
          <span>Conversation to apply to</span>
          <input
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value.trim())}
            placeholder="Open a chat with this bot, then paste its session id"
            spellCheck={false}
          />
        </label>
        <div className="mcp-row">
          <button
            type="button"
            disabled={!!busy || !conversationId || !binding?.configured}
            onClick={() =>
              void run('apply', async () => {
                const data = await call('apply', { sessionId: conversationId, expectedRevision: binding?.revision ?? null });
                setBinding(data.binding ?? binding);
              })
            }
          >
            {busy === 'apply' ? 'Applying…' : 'Apply to conversation'}
          </button>
          {binding?.configured && binding.revision != null ? (
            <button
              type="button"
              className="mcp-danger"
              disabled={!!busy}
              onClick={() =>
                void run('remove', async () => {
                  const data = await call('remove', { sessionId: conversationId || binding.agentSessionId || '', expectedRevision: binding.revision! });
                  setBinding(data.binding ?? null);
                })
              }
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          ) : null}
        </div>
        {binding?.status === 'applied' && binding.tools?.length ? (
          <div className="mcp-verify">
            <label className="mcp-field">
              <span>Verification call (one real, consented tool call)</span>
              <select value={verifyTool || binding.tools[0]!.name} onChange={(e) => setVerifyTool(e.target.value)}>
                {binding.tools.map((tool) => (
                  <option key={tool.name} value={tool.name}>{tool.description ? `${tool.name} — ${tool.description}` : tool.name}</option>
                ))}
              </select>
            </label>
            <label className="mcp-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I reviewed this tool and consent to one real call.</span>
            </label>
            <button
              type="button"
              disabled={!!busy || !consent}
              onClick={() =>
                void run('verify', async () => {
                  const data = await call('verify', {
                    sessionId: binding.agentSessionId ? conversationId : conversationId,
                    expectedRevision: binding.revision!,
                    tool: verifyTool || binding.tools![0]!.name,
                    arguments: {},
                    consent: true,
                  });
                  setBinding(data.binding ?? binding);
                  setConsent(false);
                })
              }
            >
              {busy === 'verify' ? 'Verifying…' : 'Run verification call'}
            </button>
          </div>
        ) : null}
        {binding?.status === 'ready' ? <p className="mcp-hint">Ready: the exact bot conversation discovered the bridge and completed a consented call.</p> : null}
        {!binding?.configured ? <p className="mcp-hint">Install a definition first; a conversation cannot be applied before that.</p> : null}
      </div>
    </div>
  );
}
