'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, MessageSquare, Puzzle, RefreshCw, Search, Server, ShieldCheck } from 'lucide-react';
import { marketJson, useMarketplace, useSkillMdCatalog, type MarketEntry } from './use-marketplace';
import { PluginDetail, PluginIcon } from './plugin-detail';
import { SkillMdDetail } from './skillmd-detail';
import './marketplace.css';

type Instance = { id: string; name: string; runtime?: string; status: string };
type Bot = { id: string; name: string };
type Skills = ReturnType<typeof useSkillMdCatalog>;

export function Marketplace({ pluginId, initialInstance = '', initialBot = '' }: { pluginId?: string; initialInstance?: string; initialBot?: string }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState(initialInstance);
  const [catalog, setCatalog] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const skills = useSkillMdCatalog();
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [targets, listing] = await Promise.all([
        marketJson<{ instances: Instance[] }>('/api/instances'),
        marketJson<{ plugins: MarketEntry[] }>('/api/managed-mcp/catalog'),
      ]);
      setInstances(targets.instances.filter((item) => item.runtime === 'supercharge' && item.status !== 'destroyed'));
      setCatalog(listing.plugins);
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const instance = instances.find((item) => item.id === selected) ?? instances[0];

  return <div className="market-shell">
    <aside className="market-nav"><Link className="market-brand" href="/dashboard">Vectra<span>Cloud workspace</span></Link><nav aria-label="Workspace navigation"><Link href="/dashboard"><MessageSquare size={18} />Chats</Link><Link href="/dashboard/marketplace" aria-current="page"><Puzzle size={18} />Marketplace</Link><Link href="/docs"><BookOpen size={18} />Documentation</Link></nav><div className="market-locality"><Server size={19} /><p>For your workspace<span>Review before enabling any skill.</span></p></div></aside>
    <main className="market-main"><header className="market-heading"><div><h1>Skills for your agents</h1><p>Explore skills from SkillMD. Review the full bundle, then install it in your selected VM and bot.</p></div><button className="market-button icon" aria-label="Refresh marketplace" disabled={loading || skills.loading} onClick={() => { void load(); skills.refresh(); }}><RefreshCw size={19} /></button></header>
      {error && <div className="market-error" role="alert"><p>Workspace details could not load. {error}</p><button className="market-button" onClick={() => void load()}>Retry workspace</button></div>}
      {loading ? <p className="market-empty" role="status">Loading workspace…</p> : instance ? <>
        <div className="market-target"><Server size={19} /><label className="market-field">Install location<select value={instance.id} onChange={(event) => setSelected(event.target.value)}>{instances.map((target) => <option key={target.id} value={target.id}>{target.name} · {target.status}</option>)}</select></label><span>Installed on this VM only</span></div>
        <BotMarketplace key={instance.id} instance={instance} catalog={catalog} skills={skills} pluginId={pluginId} initialBot={initialBot} />
      </> : <>{!error && <div className="market-no-vm"><Server size={20} /><div><strong>Browse now, install after creating a workspace</strong><p>A Supercharge VM and bot are needed to install and enable skills.</p></div><Link className="market-button" href="/dashboard">Open workspaces</Link></div>}<CatalogBrowser catalog={catalog} skills={skills} plugins={[]} instanceId="" /></>}
    </main>
  </div>;
}

function BotMarketplace({ instance, catalog, skills, pluginId, initialBot }: { instance: Instance; catalog: MarketEntry[]; skills: Skills; pluginId?: string; initialBot: string }) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selected, setSelected] = useState(initialBot);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setBots((await marketJson<{ bots: Bot[] }>(`/api/instances/${encodeURIComponent(instance.id)}/bots`)).bots); }
    catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  }, [instance.id]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const bot = bots.find((item) => item.id === selected) ?? bots[0];
  return <>
    {error && <div className="market-error" role="alert">Could not load bots. {error} <button className="market-button" onClick={() => void load()}>Retry bots</button></div>}
    {loading ? <p role="status">Loading bots…</p> : bot ? <><label className="market-field market-bot">Install for bot<select value={bot.id} onChange={(event) => setSelected(event.target.value)}>{bots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><TargetMarketplace key={`${instance.id}:${bot.id}`} instanceId={instance.id} botId={bot.id} catalog={catalog} skills={skills} pluginId={pluginId} /></> : <><p className="market-empty">Add an agent in Chats to install skills for it.</p><CatalogBrowser catalog={catalog} skills={skills} plugins={[]} instanceId="" /></>}
  </>;
}

function TargetMarketplace({ instanceId, botId, catalog, skills, pluginId }: { instanceId: string; botId: string; catalog: MarketEntry[]; skills: Skills; pluginId?: string }) {
  const market = useMarketplace(instanceId, botId);
  const entry = catalog.find((item) => item.id === pluginId);
  const skillMatch = /^skillmd:([A-Za-z0-9_.-]{1,80})\/([A-Za-z0-9_.-]{1,120})$/.exec(pluginId ?? '');
  const backHref = `/dashboard/marketplace?instance=${encodeURIComponent(instanceId)}&bot=${encodeURIComponent(botId)}`;
  const installed = market.plugins.find((item) => item.id === pluginId);
  const [runtime, setRuntime] = useState<{ ready: boolean; supported?: boolean } | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const checkRuntime = useCallback(async () => {
    try {
      setRuntime(await marketJson<{ ready: boolean; supported?: boolean }>(`/api/instances/${encodeURIComponent(instanceId)}/plugin-runtime`));
      setRuntimeError(null);
    } catch { setRuntimeError('Plugin support status could not be confirmed. Refresh VM status or retry.'); }
  }, [instanceId]);
  useEffect(() => { const timer = setTimeout(() => { void checkRuntime(); }, 0); return () => clearTimeout(timer); }, [checkRuntime]);
  const updateRuntime = async () => {
    if (!window.confirm('Update plugin support in this existing VM? Its sandbox ID, chats, workspace, and plugin data will be preserved.')) return;
    setUpdating(true); setRuntimeError(null);
    try {
      await marketJson(`/api/instances/${encodeURIComponent(instanceId)}/plugin-runtime`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ botId, confirm: true }),
      });
      await checkRuntime();
      await market.refresh();
    } catch { setRuntimeError('Update could not be confirmed. No VM was recreated. Refresh status before retrying.'); }
    finally { setUpdating(false); }
  };
  return <>
    {runtime?.supported === false && <div className="market-error" role="status">This VM image has no Plugin API runtime. An in-place plugin update is not available for this image; your VM and workspace have not been changed.</div>}
    {!market.loading && runtime !== null && runtime.supported !== false && (runtime.ready === false || (!market.allowedMcpOrigins.includes('https://api.githubcopilot.com') && !runtime?.ready)) && <div className="market-error" role="status"><p>This VM needs updated plugin support before GitHub MCP can be installed. This is an opt-in in-place update, not a new VM.</p><button className="market-button" disabled={updating} onClick={() => void updateRuntime()}>{updating ? 'Updating plugin support…' : 'Update plugin support in this VM'}</button></div>}
    {runtimeError && <div className="market-error" role="alert">{runtimeError} <button className="market-button" onClick={() => void checkRuntime()}>Retry status</button></div>}
    <div className="market-inventory-status"><span role="status">{market.busy ? `${market.busy}…` : market.loading ? 'Reading this bot’s installed plugins…' : `${market.plugins.length} installed for this bot`}</span><button className="market-button" disabled={!!market.busy || market.loading} onClick={() => void market.refresh()}><RefreshCw size={15} />Refresh VM status</button></div>
    {market.error && <div className="market-error" role="alert">{market.error}</div>}
    {pluginId ? entry ? <PluginDetail key={`${entry.id}:${installed?.activeDigest ?? 'new'}`} entry={entry} installed={installed} market={market} backHref={backHref} /> : skillMatch ? <SkillMdDetail owner={skillMatch[1]} name={skillMatch[2]} market={market} backHref={backHref} /> : <div className="market-empty"><h2>Plugin not found</h2><p>This plugin is not in the installable VM catalog.</p><Link className="market-back" href={backHref}><ArrowLeft size={17} />Back to marketplace</Link></div> : <CatalogBrowser catalog={catalog} skills={skills} plugins={market.plugins} instanceId={instanceId} botId={botId} />}
  </>;
}

function CatalogBrowser({ catalog, skills, plugins, instanceId, botId = '' }: { catalog: MarketEntry[]; skills: Skills; plugins: ReturnType<typeof useMarketplace>['plugins']; instanceId: string; botId?: string }) {
  const [tab, setTab] = useState<'skills' | 'installed' | 'mcp'>('skills');
  const [draft, setDraft] = useState(skills.query);
  const [searchHint, setSearchHint] = useState('');
  const link = (id: string) => `/dashboard/marketplace/${encodeURIComponent(id)}${instanceId ? `?instance=${encodeURIComponent(instanceId)}&bot=${encodeURIComponent(botId)}` : ''}`;
  const skillLink = (plugin: ReturnType<typeof useMarketplace>['plugins'][number]) => plugin.id.startsWith('skillmd-') && /^[A-Za-z0-9_.-]{1,80}\/[A-Za-z0-9_.-]{1,120}$/.test(plugin.manifest.name) ? link(`skillmd:${plugin.manifest.name}`) : link(plugin.id);
  const installedIds = new Set(plugins.map((plugin) => plugin.id));
  const reviewedIds = new Set(plugins.filter((plugin) => catalog.some((entry) => entry.id === plugin.id && entry.releaseDigest === plugin.activeDigest)).map((plugin) => plugin.id));
  return <div className="market-browser">
    <div className="market-tabs" role="group" aria-label="Marketplace sections"><button type="button" aria-pressed={tab === 'skills'} onClick={() => setTab('skills')}>Skills</button><button type="button" aria-pressed={tab === 'installed'} onClick={() => setTab('installed')}>Installed{plugins.length ? ` · ${plugins.length}` : ''}</button><button type="button" aria-pressed={tab === 'mcp'} onClick={() => setTab('mcp')}>MCP servers</button></div>
    {tab === 'skills' && <section className="market-skills" aria-labelledby="skills-title"><div className="market-list-heading"><div><h2 id="skills-title">Browse SkillMD</h2><p>Skills and bundles from SkillMD, loaded directly through the marketplace API. Review instructions and files before enabling.</p></div><span>{skills.loading && !skills.items.length ? 'Loading…' : `${skills.items.length} shown`}</span></div>
      <form className="market-search" onSubmit={(event) => { event.preventDefault(); const term = draft.trim(); if (term && term.length < 2) { setSearchHint('Enter at least two characters to search.'); return; } setSearchHint(''); skills.search(term); }}><Search size={19} /><input aria-label="Search skills" placeholder="Search SkillMD skills" value={draft} onChange={(event) => setDraft(event.target.value)} /><button type="submit">Search</button>{skills.query && <button type="button" onClick={() => { setDraft(''); setSearchHint(''); skills.search(''); }}>Clear</button>}</form>
      {searchHint && <p className="market-hint" role="alert">{searchHint}</p>}
      {skills.query && <p className="market-result-label">Results for “{skills.query}” <span>Search reaches beyond the browse pages; SkillMD returns up to 48 results.</span></p>}
      {skills.error && <div className="market-error" role="alert"><p>Skills could not load. {skills.error}</p><button className="market-button" onClick={skills.refresh}>Try again</button></div>}
      {skills.loading && !skills.items.length ? <p className="market-empty" role="status">Loading skills from SkillMD…</p> : !skills.loading && !skills.error && !skills.items.length ? <div className="market-empty"><Search size={26} /><h3>No skills found</h3><p>Try another search, or clear it to browse SkillMD.</p></div> : <div className="market-skills-list">{skills.items.map((item) => <article className="market-skill" key={item.id}><div className="market-skill-icon"><BookOpen size={22} /></div><div className="market-skill-body"><div className="market-skill-title"><h3>{item.name}</h3>{item.verified && <span className="market-verified"><ShieldCheck size={14} />Verified</span>}</div><p className="market-skill-meta">{item.owner} · {item.itemType === 'skill' ? 'Skill' : 'Bundle'}{item.category ? ` · ${item.category}` : ''}</p><p className="market-skill-description">{item.description || 'Open to review this skill and its included files.'}</p></div>{instanceId ? <Link className="market-button market-skill-action" href={link(item.id)}>Review <ArrowUpRight size={16} /></Link> : <a className="market-button market-skill-action" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">View source <ArrowUpRight size={16} /></a>}</article>)}</div>}
      {skills.nextOffset !== null && !skills.query && <button className="market-button market-load-more" type="button" disabled={skills.loading} onClick={skills.loadMore}>{skills.loading ? 'Loading more…' : 'Load more skills'}</button>}
      {!skills.nextOffset && !skills.loading && !skills.query && skills.items.length >= 1000 && <p className="market-catalog-note">You’ve reached SkillMD’s browse limit. Search to find other skills.</p>}
    </section>}
    {tab === 'installed' && <section className="market-installed"><div className="market-list-heading"><div><h2>Installed for this bot</h2><p>Skills and servers stay scoped to the selected VM and bot.</p></div></div>{plugins.length ? <div className="market-skills-list">{plugins.map((plugin) => <article className="market-skill" key={plugin.id}><PluginIcon entry={plugin} /><div className="market-skill-body"><h3>{plugin.manifest.name}</h3><p className="market-skill-meta">{plugin.enabled ? 'Enabled' : 'Disabled'} · {plugin.trusted ? 'Approved' : 'Awaiting review'}</p><p className="market-skill-description">{plugin.manifest.description || 'Review and manage this installation.'}</p></div><Link className="market-button market-skill-action" href={catalog.some((item) => item.id === plugin.id) ? link(plugin.id) : skillLink(plugin)}>Manage <ArrowUpRight size={16} /></Link></article>)}</div> : <div className="market-empty"><Check size={27} /><h3>Nothing installed yet</h3><p>Browse skills, review a bundle, then install it for this bot.</p><button className="market-button" onClick={() => setTab('skills')}>Browse skills</button></div>}</section>}
    {tab === 'mcp' && <section className="market-mcp"><div className="market-list-heading"><div><h2>Reviewed MCP servers</h2><p>These releases are reviewed and checksum-pinned. Their permissions and authentication are separate from SkillMD skills.</p></div></div>{catalog.length ? <div className="market-skills-list">{catalog.map((entry) => <article className="market-skill" key={entry.id}><PluginIcon entry={entry} /><div className="market-skill-body"><h3>{entry.name}</h3><p className="market-skill-meta">{entry.publisher || 'Vectra'} · {entry.category || 'Developer Tools'} · {entry.version}</p><p className="market-skill-description">{entry.description}</p></div>{instanceId ? <Link className="market-button market-skill-action" href={link(entry.id)}>{reviewedIds.has(entry.id) ? 'Manage' : installedIds.has(entry.id) ? 'Review conflict' : 'Review'} <ArrowUpRight size={16} /></Link> : <span className="market-skill-unavailable">Select a VM to install</span>}</article>)}</div> : <div className="market-empty"><Puzzle size={26} /><h3>No reviewed servers available</h3></div>}</section>}
  </div>;
}
