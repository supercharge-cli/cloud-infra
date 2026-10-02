'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './managed-mcp.css';

type Tool = { name: string; description: string | null };
type Binding = {
  configured: boolean;
  revision: number | null;
  sessionId?: string;
  status: string;
  pluginId?: string;
  serverId?: string;
  lastError?: string | null;
  tools?: Tool[];
};
type Plugin = {
  id: string;
  revision: number;
  enabled: boolean;
  trusted: boolean;
  activeDigest: string;
  configuredKeys: string[];
  releases: Array<{ digest: string; version: string }>;
  manifest: {
    name: string;
    version: string;
    permissions: string[];
    mcpServers: Record<string, unknown>;
    userConfig: Record<string, { required?: boolean; sensitive?: boolean }>;
  };
};
type CatalogEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  source: { type: 'archive'; url: string; sha256: string };
  manifest: { permissions: string[]; mcpServers: Record<string, unknown>; userConfig: Record<string, { required?: boolean; sensitive?: boolean }> };
};
type Conversation = { sessionId: string; title: string; botId: string; source: string };

type Result = {
  binding?: Binding;
  bindings?: Record<string, Binding>;
  inventory?: { plugins?: Plugin[] };
  plugin?: Plugin;
  valid?: boolean;
};

const jsonObject = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Enter a JSON object.');
  }
  return parsed as Record<string, unknown>;
};

export function ManagedMcpCard({ instanceId }: { instanceId: string }) {
  const [bots, setBots] = useState<Array<{ id: string; name: string }>>([]);
  const [botId, setBotId] = useState('main');
  const [bindings, setBindings] = useState<Record<string, Binding>>({});
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [catalogId, setCatalogId] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pluginId, setPluginId] = useState('');
  const [serverId, setServerId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [manifestText, setManifestText] = useState('');
  const [trustConsent, setTrustConsent] = useState(false);
  const [verifyConsent, setVerifyConsent] = useState(false);
  const [verifyTool, setVerifyTool] = useState('');
  const [rollbackDigest, setRollbackDigest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const configRef = useRef<HTMLTextAreaElement>(null);
  const argumentsRef = useRef<HTMLTextAreaElement>(null);
  const statusSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/instances/${encodeURIComponent(instanceId)}/bots`)
      .then((response) => (response.ok ? response.json() : { bots: [] }))
      .then((data: { bots?: Array<{ id: string; name: string }> }) => {
        if (cancelled) return;
        const available = data.bots ?? [];
        setBots(available);
        setBotId((current) => available.some((bot) => bot.id === current) ? current : available[0]?.id ?? 'main');
      })
      .catch(() => { if (!cancelled) setError('Could not load the instance bots.'); });
    return () => { cancelled = true; };
  }, [instanceId]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<Result> => {
    const response = await fetch(
      `/api/instances/${encodeURIComponent(instanceId)}/bots/${encodeURIComponent(botId)}/plugin-api`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...extra }) },
    );
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error : `Managed MCP request failed (HTTP ${response.status}).`;
      throw new Error(message);
    }
    return data as Result;
  }, [instanceId, botId]);

  const load = useCallback(async () => {
    const sequence = ++statusSequence.current;
    try {
      const [data, listing, threads] = await Promise.all([
        call('status'),
        fetch('/api/managed-mcp/catalog').then((response) => response.ok ? response.json() : { plugins: [] }),
        fetch(`/api/instances/${encodeURIComponent(instanceId)}/chat/conversations?botId=${encodeURIComponent(botId)}`).then((response) => response.ok ? response.json() : { conversations: [] }),
      ]);
      if (sequence !== statusSequence.current) return;
      setCatalog(Array.isArray(listing.plugins) ? listing.plugins : []);
      setConversations(Array.isArray(threads.conversations) ? threads.conversations.filter((thread: Conversation) => thread.botId === botId && thread.source !== 'group') : []);
      setBindings(data.bindings ?? {});
      setPlugins(data.inventory?.plugins ?? []);
    } catch (failure) {
      if (sequence === statusSequence.current) setError((failure as Error).message);
    }
  }, [call, instanceId, botId]);

  useEffect(() => {
    const sequence = statusSequence;
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [load]);

  const binding = bindings[conversationId] ?? (!conversationId ? Object.values(bindings)[0] : undefined);
  const selectedCatalog = catalog.find((entry) => entry.id === catalogId) ?? catalog[0];
  const catalogInstalled = selectedCatalog ? plugins.find((plugin) => plugin.id === selectedCatalog.id) : undefined;
  const selectedPlugin = plugins.find((plugin) => plugin.id === pluginId) ?? catalogInstalled ?? plugins[0];
  const servers = Object.keys(selectedPlugin?.manifest.mcpServers ?? {});
  const selectedServer = servers.includes(serverId) ? serverId : servers[0];
  const echoTools = (binding?.tools ?? []).filter((tool) => tool.description?.includes('/echo:'));
  const selectedEcho = echoTools.some((tool) => tool.name === verifyTool) ? verifyTool : echoTools[0]?.name;
  const selectionMatches = !binding || binding.sessionId === conversationId;

  useEffect(() => {
    if (binding?.status !== 'waiting' && binding?.status !== 'removing') return;
    const timer = setInterval(() => { void load(); }, 1500);
    return () => clearInterval(timer);
  }, [binding?.status, load]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(`${(failure as Error).message} Refresh status before repeating a mutation with an unknown outcome.`);
    } finally {
      setBusy(null);
    }
  };

  const changePlugin = async (action: Record<string, unknown>) => {
    if (!selectedPlugin) return;
    const result = await call('pluginAction', {
      pluginId: selectedPlugin.id,
      pluginAction: { ...action, expectedRevision: selectedPlugin.revision },
      requestId: crypto.randomUUID(),
    });
    if (result.plugin) setPlugins((current) => current.map((plugin) => plugin.id === result.plugin?.id ? result.plugin : plugin));
  };

  return (
    <section className="mcp-card" aria-label="Managed MCP" data-testid="managed-mcp-card">
      <div className="mcp-card__head">
        <label className="mcp-field">Bot
          <select value={botId} onChange={(event) => {
            statusSequence.current++;
            setBotId(event.target.value);
            setConversationId('');
            setBindings({});
            setPlugins([]);
            setPluginId('');
            setError(null);
          }}>
            {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
          </select>
        </label>
        <span className={`mcp-state mcp-state--${binding?.status ?? 'removed'}`} role="status">
          {binding?.configured ? `Conversation: ${binding.status}` : 'No conversation binding'}
        </span>
      </div>
      {error && <p className="mcp-error" role="alert">{error}</p>}
      {binding?.lastError && <p className="mcp-error">{binding.lastError}</p>}
      {notice && <p className="mcp-notice" role="status">{notice}</p>}
      <button type="button" className="mcp-button" disabled={!!busy} onClick={() => { void load(); }}>Refresh target status</button>

      <div className="mcp-section">
        <h3>Shared reviewed catalog</h3>
        <p className="mcp-hint">The same catalog appears in Supercharge desktop and Vectra. Connecting installs this pinned release only into the selected bot VM; it does not copy desktop plugins or credentials.</p>
        <label className="mcp-field">Catalog plugin
          <select value={selectedCatalog?.id ?? ''} onChange={(event) => { setCatalogId(event.target.value); setPluginId(event.target.value); setTrustConsent(false); }}>
            {!catalog.length && <option value="">No reviewed releases available</option>}
            {catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.version}</option>)}
          </select>
        </label>
        {selectedCatalog && <>
          <p className="mcp-hint">{selectedCatalog.description} · permissions: {selectedCatalog.manifest.permissions.join(', ') || 'none'} · SHA-256 {selectedCatalog.source.sha256.slice(0, 16)}… · {catalogInstalled ? (catalogInstalled.enabled && catalogInstalled.trusted ? 'enabled' : 'installed; needs review') : 'not installed in this VM'}</p>
          <button type="button" className="mcp-button" disabled={!!busy || !!catalogInstalled} onClick={() => { void run('installCatalog', async () => {
            const result = await call('installCatalog', { catalogId: selectedCatalog.id, catalogSha256: selectedCatalog.source.sha256, requestId: crypto.randomUUID() });
            if (result.plugin?.id) setPluginId(result.plugin.id);
            setNotice('Installed disabled and untrusted in this bot VM. Review configuration and permissions below before attaching to a conversation.');
          }); }}>Connect: install in this VM</button>
        </>}
      </div>

      <details className="mcp-section">
        <summary>Install or update a reviewed MCP definition</summary>
        <p className="mcp-hint">Only an existing, approved stdio executable or Streamable HTTP MCP endpoint in this sandbox works here. Validation never runs the server. An arbitrary REST API is not an MCP server.</p>
        <label className="mcp-field">Inline plugin manifest (JSON)
          <textarea className="mcp-json" rows={7} spellCheck={false} value={manifestText} onChange={(event) => setManifestText(event.target.value)} placeholder='{"schemaVersion":1,"id":"reviewed-tools","name":"Reviewed Tools","version":"1.0.0","apiVersion":"1","permissions":["mcp:stdio"],"mcpServers":{"tools":{"transport":"stdio","command":"node","args":["/home/user/workspace/reviewed/server.mjs"]}}}' />
        </label>
        <div className="mcp-row">
          <button type="button" className="mcp-button" disabled={!!busy || !manifestText.trim()} onClick={() => { void run('validate', async () => {
            const result = await call('validate', { manifest: jsonObject(manifestText) });
            if (result.valid !== true) throw new Error('The definition was not validated.');
            setNotice('Static validation passed; no plugin code was run.');
          }); }}>Validate</button>
          <button type="button" className="mcp-button" disabled={!!busy || !manifestText.trim()} onClick={() => { void run('install', async () => {
            const result = await call('install', { manifest: jsonObject(manifestText), requestId: crypto.randomUUID() });
            if (result.plugin?.id) setPluginId(result.plugin.id);
            setManifestText('');
            setNotice('Installed disabled and untrusted. Review and approve before enabling.');
          }); }}>Install disabled</button>
          <button type="button" className="mcp-button" disabled={!!busy || !selectedCatalog || !catalogInstalled || catalogInstalled.manifest.version === selectedCatalog.version} onClick={() => { void run('update', async () => {
            if (!selectedCatalog || !catalogInstalled) return;
            await call('pluginAction', { pluginId: selectedCatalog.id, catalogId: selectedCatalog.id, catalogSha256: selectedCatalog.source.sha256, pluginAction: { action: 'update', expectedRevision: catalogInstalled.revision }, requestId: crypto.randomUUID() });
            setTrustConsent(false);
            setNotice('Pinned release installed. Review changed permissions before enabling.');
          }); }}>Update from catalog</button>
        </div>
      </details>

      <div className="mcp-section">
        <label className="mcp-field">Installed plugin
          <select value={selectedPlugin?.id ?? ''} disabled={!!busy || !plugins.length} onChange={(event) => { setPluginId(event.target.value); setServerId(''); setTrustConsent(false); }}>
            {!plugins.length && <option value="">No plugins installed</option>}
            {plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.manifest.name} ({plugin.id})</option>)}
          </select>
        </label>
        {selectedPlugin && <>
          <p className="mcp-hint">Version {selectedPlugin.manifest.version} · digest {selectedPlugin.activeDigest.slice(0, 16)}… · permissions: {selectedPlugin.manifest.permissions.join(', ') || 'none'} · {selectedPlugin.trusted ? 'trusted' : 'needs approval'} · {selectedPlugin.enabled ? 'enabled' : 'disabled'}</p>
          <label className="mcp-field">Write-only configuration values (JSON object)
            <textarea ref={configRef} className="mcp-json" rows={3} spellCheck={false} defaultValue="{}" autoComplete="off" aria-label="Plugin configuration values" />
          </label>
          <p className="mcp-hint">Declared fields: {Object.keys(selectedPlugin.manifest.userConfig).join(', ') || 'none'}. Configured keys: {selectedPlugin.configuredKeys.join(', ') || 'none'}. Secret values are never read back.</p>
          <div className="mcp-row">
            <button type="button" className="mcp-button" disabled={!!busy} onClick={() => { void run('configure', async () => {
              const values = jsonObject(configRef.current?.value ?? '{}');
              if (Object.entries(values).some(([key, value]) => !Object.hasOwn(selectedPlugin.manifest.userConfig, key) || typeof value !== 'string')) throw new Error('Configuration must contain only declared string fields.');
              await changePlugin({ action: 'configure', values });
              if (configRef.current) configRef.current.value = '{}';
            }); }}>Save configuration</button>
            <label className="mcp-consent"><input type="checkbox" checked={trustConsent} onChange={(event) => setTrustConsent(event.target.checked)} />I reviewed the permissions above.</label>
            <button type="button" className="mcp-button" disabled={!!busy || selectedPlugin.trusted || !trustConsent} onClick={() => { void run('trust', async () => {
              await changePlugin({ action: 'trust', permissions: selectedPlugin.manifest.permissions });
              setTrustConsent(false);
            }); }}>Trust reviewed permissions</button>
            <button type="button" className="mcp-button" disabled={!!busy || selectedPlugin.enabled || !selectedPlugin.trusted} onClick={() => { void run('enable', () => changePlugin({ action: 'enable' })); }}>Enable</button>
            <button type="button" className="mcp-button" disabled={!!busy || !selectedPlugin.enabled} onClick={() => { void run('disable', () => changePlugin({ action: 'disable' })); }}>Disable</button>
          </div>
          {selectedPlugin.releases.length > 1 && <div className="mcp-row">
            <label className="mcp-field">Rollback release
              <select value={rollbackDigest} onChange={(event) => setRollbackDigest(event.target.value)}>
                <option value="">Select an earlier release</option>
                {selectedPlugin.releases.filter((release) => release.digest !== selectedPlugin.activeDigest).map((release) => <option key={release.digest} value={release.digest}>{release.version} · {release.digest.slice(0, 16)}…</option>)}
              </select>
            </label>
            <button type="button" className="mcp-button" disabled={!!busy || !rollbackDigest} onClick={() => { void run('rollback', async () => {
              await changePlugin({ action: 'rollback', digest: rollbackDigest });
              setRollbackDigest('');
              setTrustConsent(false);
            }); }}>Rollback</button>
          </div>}
        </>}
      </div>

      <div className="mcp-section">
        <label className="mcp-field">Conversation
          <select value={conversations.some((thread) => thread.sessionId === conversationId) ? conversationId : ''} onChange={(event) => setConversationId(event.target.value)}>
            <option value="">Select an existing conversation</option>
            {conversations.map((thread) => <option key={thread.sessionId} value={thread.sessionId}>{thread.title || thread.sessionId} · {thread.sessionId.slice(0, 12)}…</option>)}
          </select>
        </label>
        {selectedPlugin && <label className="mcp-field">MCP server
          <select value={selectedServer ?? ''} onChange={(event) => setServerId(event.target.value)}>
            {servers.map((server) => <option key={server} value={server}>{server}</option>)}
          </select>
        </label>}
        <div className="mcp-row">
          <button type="button" className="mcp-button" disabled={!!busy || !conversationId || !selectedPlugin?.enabled || !selectedPlugin.trusted || !selectedServer} onClick={() => { void run('apply', async () => {
            const result = await call('apply', { sessionId: conversationId, pluginId: selectedPlugin.id, serverId: selectedServer, expectedRevision: binding?.revision ?? null });
            if (result.binding?.sessionId) setConversationId(result.binding.sessionId);
          }); }}>{binding ? 'Reapply / rotate bridge' : 'Apply to conversation'}</button>
          <button type="button" className="mcp-button" disabled={!!busy || !conversationId || !selectionMatches || binding?.status !== 'failed' || binding.revision == null} onClick={() => { void run('retry', async () => {
            await call('retry', { sessionId: conversationId, expectedRevision: binding!.revision });
          }); }}>Retry failed apply</button>
          <button type="button" className="mcp-button mcp-danger" disabled={!!busy || !binding?.configured || !selectionMatches || binding.revision == null || !conversationId} onClick={() => { void run('remove', async () => {
            await call('remove', { sessionId: conversationId, expectedRevision: binding!.revision });
          }); }}>Remove conversation bridge</button>
        </div>
        {binding?.status === 'applied' && <div className="mcp-verify">
          {selectedEcho ? <>
            <p className="mcp-hint">Only a discovered echo fixture is offered for the non-destructive verification call.</p>
            <label className="mcp-field">Echo fixture
              <select value={selectedEcho} onChange={(event) => setVerifyTool(event.target.value)}>
                {echoTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.description ?? tool.name}</option>)}
              </select>
            </label>
            <label className="mcp-field">Echo arguments (JSON object)
              <textarea ref={argumentsRef} className="mcp-json" rows={2} spellCheck={false} defaultValue='{"text":"managed MCP check"}' />
            </label>
            <label className="mcp-consent"><input type="checkbox" checked={verifyConsent} onChange={(event) => setVerifyConsent(event.target.checked)} />I consent to this one real echo call.</label>
            <button type="button" className="mcp-button" disabled={!!busy || !verifyConsent || !conversationId || !selectionMatches || binding.revision == null} onClick={() => { void run('verify', async () => {
              await call('verify', { sessionId: conversationId, expectedRevision: binding.revision, tool: selectedEcho, arguments: jsonObject(argumentsRef.current?.value ?? '{}'), consent: true });
              setVerifyConsent(false);
            }); }}>Verify discovered echo</button>
          </> : <p className="mcp-hint">Applied to this session. No echo fixture was discovered, so readiness has not been verified.</p>}
        </div>}
        {binding?.status === 'ready' && <p className="mcp-notice">Ready: this conversation discovered and safely called its bridge tool.</p>}
      </div>
    </section>
  );
}
