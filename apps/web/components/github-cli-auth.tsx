'use client';

import { useEffect, useRef, useState } from 'react';

 type AuthState = { status: string; code?: string; url?: string; expiresAt?: number; username?: string };

export function GitHubCliAuth({ base, conversationId }: { base: string; conversationId: string | null }) {
  const [auth, setAuth] = useState<AuthState>({ status: 'idle' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  const endpoint = `${base}/github-auth`;
  useEffect(() => {
    if (!conversationId) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store' });
        const data = await response.json();
        if (active && response.ok) setAuth(data);
      } catch { /* Try again on the next poll. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [endpoint, conversationId]);

  async function act(action: 'start' | 'done' | 'cancel') {
    if (busy || !conversationId) return;
    setBusy(true); setError('');
    try {
      if (action === 'start') requestId.current = crypto.randomUUID();
      const response = await fetch(endpoint, {
        method: action === 'cancel' ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: action === 'cancel' ? undefined : JSON.stringify(action === 'start' ? { action, conversationId, requestId: requestId.current } : { action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'GitHub CLI login failed');
      setAuth(data);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="agent-github-auth" aria-label="GitHub CLI login">
    <strong>GitHub CLI · this VM</strong>
    <p>GitHub CLI login is separate from GitHub MCP (which requires its own credential).</p>
    {auth.status === 'idle' || auth.status === 'cancelled' || auth.status === 'expired' || auth.status === 'failed' ? <button type="button" disabled={busy} onClick={() => void act('start')}>{busy ? 'Starting…' : 'Connect GitHub CLI'}</button> : null}
    {auth.status === 'starting' && <p>Waiting for a device code from the VM…</p>}
    {auth.status === 'pending' && <div><p>Open <a href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">github.com/login/device</a> in your own browser and enter this code: <strong>{auth.code}</strong></p><p>Only click Done after authorizing on GitHub. Expires {auth.expiresAt ? new Date(auth.expiresAt).toLocaleTimeString() : 'soon'}.</p></div>}
    {(auth.status === 'starting' || auth.status === 'pending') && <div><button type="button" disabled={busy} onClick={() => void act('done')}>Done — verify in VM</button><button type="button" disabled={busy} onClick={() => void act('cancel')}>Cancel</button></div>}
    {auth.status === 'delivered' && <div><p>GitHub CLI verified as {auth.username}. The GitHub bot has been asked to continue this conversation. GitHub MCP is not connected by this login.</p><button type="button" disabled={busy} onClick={() => void act('start')}>Start a new login</button></div>}
    {(auth.status === 'uncertain' || auth.status === 'delivering') && <p>GitHub CLI verified as {auth.username}, but delivery could not be confirmed. This handoff will not be sent again automatically; check the conversation before retrying the task.</p>}
    {auth.status === 'verified' && <button type="button" disabled={busy} onClick={() => void act('done')}>Continue verified login</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
