'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';

const DEVICE_URL = 'https://github.com/login/device';
type AuthState = { status: string; code?: string; expiresAt?: number; username?: string };

export function GitHubCliAuth({ base, onClose }: { base: string; onClose: () => void }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'starting' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);
  const requestId = useRef<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const endpoint = `${base}/github-auth`;

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setCopied(false); setAuth({ status: 'starting' });
    try {
      requestId.current ??= crypto.randomUUID();
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', requestId: requestId.current }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'GitHub login could not start.');
      setAuth(data);
    } catch (reason) { setError((reason as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }, [endpoint]);

  useEffect(() => {
    closeButton.current?.focus();
    let active = true;
    const refresh = async (initial = false) => {
      if (busyRef.current) return;
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not check GitHub login.');
        if (!active || busyRef.current) return;
        if (initial && ['idle', 'cancelled', 'expired', 'failed'].includes(data.status)) void start();
        else setAuth(data);
      } catch (reason) { if (active && initial) setError((reason as Error).message); }
    };
    void refresh(true);
    const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [endpoint, start]);

  async function act(action: 'done' | 'cancel') {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: action === 'cancel' ? 'DELETE' : 'POST', headers: { 'content-type': 'application/json' }, body: action === 'cancel' ? undefined : JSON.stringify({ action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'GitHub login could not be verified.');
      setAuth(data);
    } catch (reason) { setError((reason as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function copyLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(DEVICE_URL);
    } catch {
      const field = document.createElement('textarea');
      field.value = DEVICE_URL; field.style.position = 'fixed'; field.style.opacity = '0';
      document.body.appendChild(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      if (!copied) { setError('Could not copy the link. Open it directly instead.'); return; }
    }
    setCopied(true); setError('');
  }

  return <div className="agent-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="agent-github-dialog" role="dialog" aria-modal="true" aria-labelledby="github-login-title" onKeyDown={(event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button ref={closeButton} className="agent-github-close" type="button" aria-label="Close GitHub login" onClick={onClose}><X size={19} /></button>
      <span className="agent-github-mark"><ExternalLink size={22} aria-hidden="true" /></span>
      <h2 id="github-login-title">Connect GitHub</h2>
      <p className="agent-github-intro">Authorize GitHub CLI in this workspace’s VM. GitHub MCP uses a separate connection.</p>
      {auth.status === 'starting' && !error && <p role="status">Getting a login code from the VM…</p>}
      {auth.status === 'pending' && <div className="agent-github-steps">
        <p>Open the link and enter this code on GitHub:</p>
        <strong className="agent-github-code">{auth.code}</strong>
        <div className="agent-github-link"><a href={DEVICE_URL} target="_blank" rel="noopener noreferrer">github.com/login/device <ExternalLink size={14} /></a><button type="button" onClick={() => void copyLink()} aria-label="Copy GitHub verification link">{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied' : 'Copy link'}</button></div>
        <p className="agent-github-hint">After approving on GitHub, return here and select Verify. Code expires {auth.expiresAt ? new Date(auth.expiresAt).toLocaleTimeString() : 'soon'}.</p>
        <button className="agent-github-primary" type="button" disabled={busy} onClick={() => void act('done')}>{busy ? 'Checking…' : 'Verify connection'}</button>
        <button className="agent-github-secondary" type="button" disabled={busy} onClick={() => void act('cancel')}>Cancel login</button>
      </div>}
      {auth.status === 'verified' && <button className="agent-github-primary" type="button" disabled={busy} onClick={() => void act('done')}>{busy ? 'Checking…' : 'Verify connection'}</button>}
      {auth.status === 'delivered' && <div className="agent-github-success" role="status"><Check size={22} /><strong>Done! GitHub connected as {auth.username}.</strong><p>GitHub CLI is ready in this workspace’s VM.</p></div>}
      {['delivering', 'uncertain'].includes(auth.status) && <p role="status">GitHub CLI verified as {auth.username}, but the bot handoff could not be confirmed. Check the GitHub conversation before retrying the task.</p>}
      {['cancelled', 'expired', 'failed', 'idle', 'delivered'].includes(auth.status) && <button className="agent-github-secondary" type="button" disabled={busy} onClick={() => { requestId.current = null; void start(); }}>{auth.status === 'delivered' ? 'Start a new login' : 'Try again'}</button>}
      {error && <p className="agent-github-error" role="alert">{error}</p>}
      {error && auth.status === 'starting' && <button className="agent-github-secondary" type="button" disabled={busy} onClick={() => void start()}>Try again</button>}
    </section>
  </div>;
}
