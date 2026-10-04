'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { marketJson, type SkillMdItem, useMarketplace } from './use-marketplace';

export function SkillMdDetail({ owner, name, market, backHref }: {
  owner: string; name: string; market: ReturnType<typeof useMarketplace>; backHref: string;
}) {
  const [item, setItem] = useState<SkillMdItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    let live = true;
    marketJson<SkillMdItem>(`/api/marketplace/items/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`)
      .then((result) => { if (live) setItem(result); })
      .catch((failure) => { if (live) setError((failure as Error).message); });
    return () => { live = false; };
  }, [owner, name]);
  const installed = market.plugins.find((plugin) => plugin.id === item?.pluginId);
  const disabled = market.loading || !!market.busy || !!market.error;
  return <article className="market-detail">
    <Link href={backHref} className="market-back"><ArrowLeft size={17} />All plugins</Link>
    {error && <p className="market-error" role="alert">{error}</p>}
    {!item && !error && <p role="status">Loading SkillMD details…</p>}
    {item && <>
      <header className="market-detail-heading"><span className="market-icon" aria-hidden="true"><ShieldCheck size={23} /></span><div><h2>{item.name}</h2><p>{item.owner} · {item.itemType === 'skill' ? 'Skill' : 'Skill bundle'} · SkillMD</p></div><span className="market-badge">{installed ? installed.enabled ? 'Enabled in this VM' : 'Installed in this VM' : 'Not installed'}</span></header>
      <p className="market-description">{item.description || 'No description provided by SkillMD.'}</p>
      <div className="market-detail-grid"><div>
        <section className="market-section"><h3>Install to this bot</h3><p>Downloads the complete SkillMD ZIP in the selected VM, validates its files, and installs it in the isolated Plugin API store disabled and untrusted. No downloaded script runs during installation.</p>
          <button className="market-button primary" disabled={disabled || !!installed || !item.installable} onClick={() => void market.run('Install SkillMD skill', () => market.call('installSkillMd', { owner, name, requestId: crypto.randomUUID() }))}>{market.busy === 'Install SkillMD skill' ? 'Installing…' : installed ? 'Installed' : 'Install skill bundle'}</button>
          {!item.installable && <p role="status">This item does not provide a complete, supported bundle. Installation is unavailable; no partial SKILL.md will be installed.</p>}
        </section>
        <section className="market-section"><h3>Review and enable</h3><p>This bundle requests no Plugin API execution permissions or account credentials. Read its instructions and included files before approving. Approval does not execute its scripts.</p>
          <label className="market-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={disabled || !installed || installed.trusted} />I reviewed this community bundle and approve its instructions.</label>
          <div className="market-actions"><button className="market-button" disabled={disabled || !installed || installed.trusted || !consent} onClick={() => { if (installed) void market.run('Approve skill', async () => { await market.change(installed, { action: 'trust', permissions: installed.manifest.permissions }); setConsent(false); }); }}>{installed?.trusted ? 'Approved' : 'Approve'}</button>
          <button className="market-button primary" disabled={disabled || !installed?.trusted || installed.enabled} onClick={() => { if (installed) void market.run('Enable skill', () => market.change(installed, { action: 'enable' })); }}>{installed?.enabled ? 'Enabled' : 'Enable'}</button></div>
          <p>This installation does not register MCP servers. After approval and enablement, this bot can use the skill in its existing conversations without a restart; disabling it removes the skill from discovery.</p>
        </section>
        {installed && <section className="market-section"><h3>Manage installation</h3><button className="market-button" disabled={disabled || !installed.enabled} onClick={() => void market.run('Disable skill', () => market.change(installed, { action: 'disable' }))}>Disable</button> {confirmRemove ? <><button className="market-button danger" disabled={disabled || installed.enabled} onClick={() => void market.run('Uninstall skill', async () => { await market.change(installed, { action: 'uninstall' }); setConfirmRemove(false); })}>Confirm uninstall</button><button className="market-button" onClick={() => setConfirmRemove(false)}>Cancel</button></> : <button className="market-button" disabled={disabled || installed.enabled} onClick={() => setConfirmRemove(true)}>Uninstall…</button>}</section>}
      </div><aside className="market-release"><h3>SkillMD details</h3><dl><dt>Publisher</dt><dd>{item.owner}</dd><dt>Type</dt><dd>{item.itemType === 'skill' ? 'Single skill' : 'Bundle with supporting files'}</dd>{item.license && <><dt>License</dt><dd>{item.license}</dd></>}{item.commitSha && <><dt>Source revision</dt><dd className="market-digest">{item.commitSha}</dd></>}{item.verified !== undefined && <><dt>SkillMD verified</dt><dd>{item.verified ? 'Yes' : 'No'}</dd></>}</dl>
        {item.files && <><h3>Included files</h3><ul className="market-permissions"><li>SKILL.md</li>{item.files.map((file) => <li key={file.path}>{file.path}{file.isScript ? ' · script (not run on install)' : ''}</li>)}</ul></>}
        {item.sourceRepo && <a href={item.sourceRepo} rel="noreferrer" target="_blank">View source repository</a>}{' '}<a href={item.sourceUrl} rel="noreferrer" target="_blank">View on SkillMD</a>
      </aside></div>
    </>}
  </article>;
}
