'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, Check, Plug, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import type { InstalledPlugin, MarketEntry } from './use-marketplace';
import { useMarketplace } from './use-marketplace';

export function PluginIcon({ entry }: { entry: { id: string; icon?: string } }) {
  const [failed, setFailed] = useState(false);
  const safeIcon = entry.icon?.startsWith('/managed-mcp/') ? entry.icon : undefined;
  return <span className="market-icon" aria-hidden="true">{safeIcon && !failed ? <Image src={safeIcon} width={48} height={48} alt="" unoptimized onError={() => setFailed(true)} /> : entry.id === 'vectra-echo' ? <Plug size={23} /> : <ShieldCheck size={23} />}</span>;
}

export function PluginDetail({ entry, installed, market, backHref }: {
  entry: MarketEntry; installed?: InstalledPlugin;
  market: ReturnType<typeof useMarketplace>; backHref: string;
}) {
  const [consent, setConsent] = useState(false);
  const [verifyConsent, setVerifyConsent] = useState(false);
  const [conversation, setConversation] = useState('');
  const [server, setServer] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const configForm = useRef<HTMLFormElement>(null);
  const { busy, loading, error, run, call, change } = market;
  const reviewedInstallation = !installed || installed.activeDigest === entry.releaseDigest;
  const disabled = !!busy || loading || !!error || !reviewedInstallation;
  const supportsVm = !entry.targets || entry.targets.includes('supercharge-e2b');
  const supportsRuntime = entry.id !== 'vectra-github' || market.allowedMcpOrigins.includes('https://api.githubcopilot.com');
  const manifest = installed?.manifest ?? entry.manifest;
  const config = Object.entries(manifest.userConfig);
  const configured = config.every(([key, field]) => !field.required || installed?.configuredKeys.includes(key));
  const servers = Object.keys(manifest.mcpServers);
  const serverId = servers.includes(server) ? server : servers[0];
  const selectedConversation = market.conversations.find((thread) => thread.sessionId === conversation);
  const binding = selectedConversation ? market.bindings[conversation] : undefined;
  const ours = binding?.pluginId === entry.id && binding.serverId === serverId;
  const echo = ours && entry.id === 'vectra-echo' && serverId === 'echo'
    ? binding.tools?.find((tool) => tool.description?.startsWith('vectra-echo/echo/echo:'))
    : undefined;
  const attached = ours && ['applied', 'ready'].includes(binding.status);
  const steps = [!!installed, !!installed && configured, !!installed?.trusted, !!installed?.enabled, !!attached, ours && binding.status === 'ready'];

  async function saveConfiguration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installed || !configForm.current) return;
    const values = Object.fromEntries([...new FormData(configForm.current)].filter(([, value]) => typeof value === 'string' && value.length));
    if (await run('Save configuration', () => change(installed, { action: 'configure', values }))) configForm.current?.reset();
  }

  return <article className="market-detail">
    <Link href={backHref} className="market-back"><ArrowLeft size={17} />All plugins</Link>
    <header className="market-detail-heading"><PluginIcon entry={entry} /><div><h2>{entry.name}</h2><p>{entry.publisher || 'Vectra'} · {entry.category || 'Developer Tools'} · {entry.version}</p></div><span className="market-badge">{installed ? (installed.enabled ? 'Enabled in this VM' : 'Installed in this VM') : 'Not installed'}</span></header>
    <p className="market-description">{entry.description}</p>
    {entry.id === 'vectra-github' && <p>Use a GitHub personal access token with only the repository permissions you want this bot to have. The token is sent to the selected VM as write-only configuration; this is not GitHub OAuth sign-in.</p>}
    {installed && !reviewedInstallation && <p role="alert">A different release uses this catalog plugin ID. Marketplace actions are blocked for it; manage the installation in Managed MCP settings. The archive hash below identifies only the reviewed catalog release.</p>}
    {installed && reviewedInstallation && <p role="status">The VM reports the reviewed release content digest. Review its installed permissions before approving it.</p>}
    <ol className="market-steps" aria-label="Plugin setup progress">{['Install', 'Configure', 'Approve', 'Enable', 'Attach', 'Verify'].map((label, i) => <li key={label} className={steps[i] ? 'complete' : ''}>{steps[i] ? <Check size={15} /> : <span>{i + 1}</span>}{label}</li>)}</ol>
    <div className="market-detail-grid"><div>
      <section className="market-section"><h3>Install to this bot</h3><p>The pinned release stays in this VM’s isolated plugin store. It starts disabled and requires your approval before it can run.</p>
        <button className="market-button primary" disabled={disabled || !!installed || entry.auth === 'oauth' || !supportsVm || !supportsRuntime} onClick={() => void run('Install plugin', () => call('installCatalog', { catalogId: entry.id, catalogSha256: entry.source.sha256, requestId: crypto.randomUUID() }))}>{busy === 'Install plugin' ? 'Installing…' : installed ? 'Installed' : 'Install plugin'}</button>
        {entry.auth === 'oauth' && <p role="status">This plugin requires an OAuth connection. Installation is unavailable until its secure provider connection is supported.</p>}
        {!supportsVm && <p role="status">This release does not support Supercharge VMs.</p>}
        {!loading && !supportsRuntime && <p role="status">This VM does not allow the GitHub MCP endpoint yet. Recreate the sandbox with the updated template before installing GitHub.</p>}
      </section>
      <section className="market-section"><h3>Authentication & configuration</h3>
        {!config.length ? <p>No account connection or secrets are required for this plugin.</p> : <form ref={configForm} onSubmit={(event) => void saveConfiguration(event)}>
          <p>Values are write-only and saved to this bot’s VM. Saved secrets are never displayed.</p>
          {config.map(([key, field]) => <label className="market-field" key={key}>{field.description || key}{field.required ? ' (required)' : ''}<input name={key} type={field.sensitive ? 'password' : 'text'} autoComplete="off" disabled={disabled || !installed} placeholder={installed?.configuredKeys.includes(key) ? 'Already configured; leave blank to keep' : 'Enter a value'} required={field.required && !installed?.configuredKeys.includes(key)} /></label>)}
          <button className="market-button" disabled={disabled || !installed}>Save configuration</button>
        </form>}
      </section>
      <section className="market-section"><h3>Review permissions</h3><ul className="market-permissions">{manifest.permissions.length ? manifest.permissions.map((permission) => <li key={permission}><ShieldCheck size={16} />{permission}</li>) : <li>No additional permissions requested.</li>}</ul>
        <p>Approval allows this plugin to execute under the isolated service account on your VM.</p>
        <label className="market-consent"><input type="checkbox" checked={consent} disabled={disabled || !installed || installed.trusted} onChange={(event) => setConsent(event.target.checked)} />I reviewed and approve these permissions.</label>
        <div className="market-actions"><button className="market-button" disabled={disabled || !installed || installed.trusted || !consent} onClick={() => { if (installed) void run('Approve permissions', async () => { await change(installed, { action: 'trust', permissions: manifest.permissions }); setConsent(false); }); }}>{installed?.trusted ? 'Permissions approved' : 'Approve permissions'}</button>
        <button className="market-button primary" disabled={disabled || !installed?.trusted || !configured || installed.enabled} onClick={() => { if (installed) void run('Enable plugin', () => change(installed, { action: 'enable' })); }}>{installed?.enabled ? 'Enabled' : 'Enable plugin'}</button></div>
      </section>
      <section className="market-section"><h3>Attach to a conversation</h3><p>Only the chosen conversation receives this plugin’s MCP tools. Enabling a plugin alone does not attach it.</p>
        <label className="market-field">Conversation<select value={selectedConversation?.sessionId ?? ''} disabled={disabled} onChange={(event) => { setConversation(event.target.value); setVerifyConsent(false); }}><option value="">Choose a conversation</option>{market.conversations.map((thread) => <option key={thread.sessionId} value={thread.sessionId}>{thread.title || thread.sessionId}</option>)}</select></label>
        {!loading && !market.conversations.length && <p>Create a direct conversation in <Link href="/dashboard">Chats</Link>, then refresh the VM status.</p>}
        {servers.length > 1 && <label className="market-field">MCP server<select value={serverId} onChange={(event) => { setServer(event.target.value); setVerifyConsent(false); }}>{servers.map((id) => <option key={id}>{id}</option>)}</select></label>}
        {binding?.configured && !ours && <p role="status">This conversation already uses another plugin bridge. Remove it in Managed MCP before attaching this plugin.</p>}
        <button className="market-button primary" disabled={disabled || !supportsRuntime || !installed?.enabled || !installed.trusted || !selectedConversation || !serverId || (!!binding?.configured && !ours) || !!attached || binding?.status === 'waiting'} onClick={() => void run('Attach plugin', () => call('apply', { pluginId: entry.id, serverId, sessionId: conversation, expectedRevision: binding?.revision ?? null }))}>{attached ? 'Attached' : binding?.status === 'waiting' ? 'Attaching…' : 'Attach plugin'}</button>
        {ours && binding.lastError && <p role="alert">{binding.lastError}</p>}
        {ours && binding.status === 'failed' && <button className="market-button" disabled={disabled || binding.revision == null} onClick={() => void run('Retry attachment', () => call('retry', { sessionId: conversation, expectedRevision: binding.revision }))}>Retry attachment</button>}
        {attached && binding.status !== 'ready' && (echo ? <div className="market-verification"><label className="market-consent"><input type="checkbox" checked={verifyConsent} disabled={disabled} onChange={(event) => setVerifyConsent(event.target.checked)} />I consent to one call of the discovered Echo tool. This executes plugin code in the selected VM.</label><button className="market-button" disabled={disabled || !verifyConsent || binding.revision == null} onClick={() => void run('Verify connection', async () => { await call('verify', { sessionId: conversation, expectedRevision: binding.revision, tool: echo.name, arguments: { text: 'Marketplace connection check' }, consent: true }); setVerifyConsent(false); })}>Verify connection</button></div> : <p>Attached. No safe echo test is available; the connection has not been verified.</p>)}
        {ours && binding.status === 'ready' && <p className="market-success" role="status"><Check size={17} />Verified in this conversation</p>}
        {ours && binding.configured && <button className="market-button" disabled={disabled || binding.revision == null || binding.status === 'removing'} onClick={() => void run('Detach plugin', () => call('remove', { sessionId: conversation, expectedRevision: binding.revision }))}>Detach from conversation</button>}
      </section>
    </div><aside className="market-release"><h3>Release details</h3><dl><dt>Publisher</dt><dd>{entry.publisher || 'Vectra'}</dd><dt>Version</dt><dd>{entry.version}</dd><dt>Includes</dt><dd>{Object.keys(manifest.mcpServers).length ? 'MCP tools' : 'Plugin components'}</dd><dt>Runs on</dt><dd>Selected VM / bot</dd><dt>SHA-256</dt><dd className="market-digest">{entry.source.sha256}</dd></dl><a href={entry.source.url} rel="noreferrer" target="_blank">View pinned archive</a>
      {installed && <div className="market-manage"><h3>Manage installation</h3><button className="market-button" disabled={disabled || !installed.enabled} onClick={() => void run('Disable plugin', () => change(installed, { action: 'disable' }))}>Disable plugin</button><p>Detach every conversation before uninstalling. Plugin data is preserved by the service.</p>{confirmRemove ? <div><p>Uninstall {entry.name} from this bot?</p><button className="market-button danger" disabled={disabled || Object.values(market.bindings).some((item) => item.pluginId === entry.id && item.configured)} onClick={() => void run('Uninstall plugin', async () => { await change(installed, { action: 'uninstall' }); setConfirmRemove(false); })}>Confirm uninstall</button><button className="market-button" onClick={() => setConfirmRemove(false)}>Cancel</button></div> : <button className="market-button" disabled={disabled} onClick={() => setConfirmRemove(true)}>Uninstall…</button>}</div>}
    </aside></div>
  </article>;
}
