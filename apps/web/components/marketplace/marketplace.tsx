'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, MessageSquare, Puzzle, RefreshCw, Search, Server, Settings2 } from 'lucide-react';
import { marketJson, useMarketplace, type MarketEntry } from './use-marketplace';
import { PluginDetail, PluginIcon } from './plugin-detail';
import './marketplace.css';

type Instance = { id: string; name: string; runtime?: string; status: string };
type Bot = { id: string; name: string };

export function Marketplace({ pluginId, initialInstance = '', initialBot = '' }: { pluginId?: string; initialInstance?: string; initialBot?: string }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState(initialInstance);
  const [catalog, setCatalog] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    <aside className="market-nav"><Link className="market-brand" href="/dashboard">Vectra<span>Cloud workspace</span></Link><nav aria-label="Workspace navigation"><Link href="/dashboard"><MessageSquare size={18} />Chats</Link><Link href="/dashboard/marketplace" aria-current="page"><Puzzle size={18} />Plugin Marketplace</Link><Link href="/docs"><BookOpen size={18} />Documentation</Link></nav><div className="market-locality"><Server size={19} /><p>Installed on your VM<span>Separate from your desktop plugins.</span></p></div></aside>
    <main className="market-main"><header className="market-heading"><div><h1>Plugin Marketplace</h1><p>Give your VM new tools. Browse plugins, review access, and connect them to your agents.</p></div><button className="market-button icon" aria-label="Refresh marketplace" disabled={loading} onClick={() => void load()}><RefreshCw size={19} /></button></header>
      {error && <div className="market-error" role="alert"><p>Could not load the marketplace. {error}</p><button className="market-button" onClick={() => void load()}>Try again</button></div>}
      {loading ? <p className="market-empty" role="status">Loading marketplace…</p> : !error && <>
        {instance ? <><div className="market-target"><Server size={19} /><label className="market-field">Install location<select value={instance.id} onChange={(event) => setSelected(event.target.value)}>{instances.map((target) => <option key={target.id} value={target.id}>{target.name} · {target.status}</option>)}</select></label><span>VM only</span></div><BotMarketplace key={instance.id} instance={instance} catalog={catalog} pluginId={pluginId} initialBot={initialBot} /></> : <div className="market-empty"><Server size={30} /><h2>A Supercharge VM is needed</h2><p>Create a Supercharge workspace to install plugins. Desktop installations are managed separately in Supercharge.</p><Link className="market-button primary" href="/dashboard">Open workspaces</Link><CatalogBrowser catalog={catalog} plugins={[]} instanceId="" /></div>}
      </>}
    </main>
  </div>;
}

function BotMarketplace({ instance, catalog, pluginId, initialBot }: { instance: Instance; catalog: MarketEntry[]; pluginId?: string; initialBot: string }) {
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
    {error && <div className="market-error" role="alert">Could not load bots. {error}<button className="market-button" onClick={() => void load()}>Retry bots</button></div>}
    {loading ? <p role="status">Loading bots…</p> : bot ? <><label className="market-field market-bot">Bot<select value={bot.id} onChange={(event) => setSelected(event.target.value)}>{bots.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><TargetMarketplace key={`${instance.id}:${bot.id}`} instanceId={instance.id} botId={bot.id} catalog={catalog} pluginId={pluginId} /></> : !error && <p className="market-empty">No bots are available in this workspace. Add an agent in Chats, then refresh.</p>}
  </>;
}

function TargetMarketplace({ instanceId, botId, catalog, pluginId }: { instanceId: string; botId: string; catalog: MarketEntry[]; pluginId?: string }) {
  const market = useMarketplace(instanceId, botId);
  const entry = catalog.find((item) => item.id === pluginId);
  const backHref = `/dashboard/marketplace?instance=${encodeURIComponent(instanceId)}&bot=${encodeURIComponent(botId)}`;
  const installed = market.plugins.find((item) => item.id === pluginId);
  return <>
    <div className="market-inventory-status"><span role="status">{market.busy ? `${market.busy}…` : market.loading ? 'Reading this bot’s installed plugins…' : `${market.plugins.length} installed in this bot`}</span><button className="market-button" disabled={!!market.busy || market.loading} onClick={() => void market.refresh()}><RefreshCw size={15} />Refresh VM status</button></div>
    {market.error && <div className="market-error" role="alert">{market.error}</div>}
    {pluginId ? entry ? <PluginDetail key={`${entry.id}:${installed?.activeDigest ?? 'new'}`} entry={entry} installed={installed} market={market} backHref={backHref} /> : <div className="market-empty"><h2>Plugin not found</h2><p>This plugin is not in the reviewed VM catalog.</p><Link className="market-back" href={backHref}><ArrowLeft size={17} />Back to marketplace</Link></div> : <CatalogBrowser catalog={catalog} plugins={market.plugins} instanceId={instanceId} botId={botId} />}
  </>;
}

function CatalogBrowser({ catalog, plugins, instanceId, botId = '' }: { catalog: MarketEntry[]; plugins: ReturnType<typeof useMarketplace>['plugins']; instanceId: string; botId?: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const link = (id: string) => `/dashboard/marketplace/${encodeURIComponent(id)}${instanceId ? `?instance=${encodeURIComponent(instanceId)}&bot=${encodeURIComponent(botId)}` : ''}`;
  const installedIds = new Set(plugins.map((plugin) => plugin.id));
  const reviewedIds = new Set(plugins.filter((plugin) => catalog.some((entry) => entry.id === plugin.id && entry.releaseDigest === plugin.activeDigest)).map((plugin) => plugin.id));
  const entries = catalog.filter((entry) => `${entry.name} ${entry.description} ${entry.publisher ?? ''} ${entry.category ?? ''}`.toLowerCase().includes(query.toLowerCase()) && (filter !== 'installed' || installedIds.has(entry.id)));
  const categories = [...new Set(entries.map((entry) => entry.category || 'Developer Tools'))];
  return <div className="market-browser"><label className="market-search"><Search size={19} /><input aria-label="Search plugins" placeholder="Search plugins" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button type="button" onClick={() => setQuery('')}>Clear</button>}</label>
    <section className="market-installed"><div className="market-section-title"><h2>Installed</h2><Link href="/dashboard"><Settings2 size={16} />Open workspace</Link></div>{plugins.length ? <div className="market-installed-strip">{plugins.map((plugin) => <Link key={plugin.id} href={catalog.some((item) => item.id === plugin.id) ? link(plugin.id) : '/dashboard'} title={plugin.manifest.name}><PluginIcon entry={plugin} /><span>{plugin.manifest.name}</span><small>{plugin.enabled ? 'Enabled' : 'Disabled'}</small></Link>)}</div> : <p>No plugins installed in this bot yet. Choose a plugin below to get started.</p>}</section>
    <div className="market-filters" role="group" aria-label="Filter plugins"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Browse plugins</button><button aria-pressed={filter === 'installed'} onClick={() => setFilter('installed')}>My plugins</button></div>
    {!entries.length && <div className="market-empty"><Puzzle size={28} /><h2>{query ? 'No matching plugins' : filter === 'installed' ? 'Your plugins will appear here' : 'No reviewed plugins available'}</h2><p>{query ? 'Try another name, publisher, or category.' : 'Only reviewed, pinned releases can be installed on your VM.'}</p>{query && <button className="market-button" onClick={() => setQuery('')}>Clear search</button>}</div>}
    {categories.map((category) => <section className="market-category" key={category}><h2>{category}</h2><div className="market-grid">{entries.filter((entry) => (entry.category || 'Developer Tools') === category).map((entry) => <article className="market-plugin" key={entry.id}><Link className="market-plugin-info" href={link(entry.id)}><PluginIcon entry={entry} /><div><h3>{entry.name}</h3><span>{entry.publisher || 'Vectra'} · {entry.version}</span><p>{entry.description}</p></div></Link><Link className="market-button" href={link(entry.id)} aria-label={`${reviewedIds.has(entry.id) ? 'Manage' : installedIds.has(entry.id) ? 'Review conflict for' : 'View'} ${entry.name}`}>{reviewedIds.has(entry.id) ? 'Manage' : installedIds.has(entry.id) ? 'Review conflict' : 'View plugin'}</Link></article>)}</div></section>)}
    <p className="market-catalog-note">VM installs use reviewed, checksum-pinned releases. Skills and other plugin types appear here when their VM integration is supported; desktop marketplace sources are managed independently.</p>
  </div>;
}
