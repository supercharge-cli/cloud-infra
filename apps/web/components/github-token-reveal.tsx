'use client';

import { useState } from 'react';

type Props = { instanceId: string; chatId: string; onReveal: () => void };

export function GitHubTokenReveal({ instanceId, chatId, onReveal }: Props) {
  const [confirm, setConfirm] = useState<'cli' | 'mcp' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reveal() {
    if (busy || !confirm) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/github-token`, {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botId: 'github', chatId, source: confirm, confirmation: 'Send token to this chat', requestId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok || data.saved !== true) throw new Error(data.error || 'The token is unavailable.');
      onReveal();
      setConfirm(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="agent-github-token" aria-label="GitHub token disclosure">
    <button type="button" disabled={busy} onClick={() => setConfirm((value) => value === 'cli' ? null : 'cli')}>Show my GitHub CLI token in chat</button>
    <button type="button" disabled={busy} onClick={() => setConfirm((value) => value === 'mcp' ? null : 'mcp')}>Show my GitHub MCP token in chat</button>
    {confirm && <div role="group" aria-label="Confirm token disclosure">
      <p>Your GitHub {confirm === 'cli' ? 'CLI' : 'MCP'} token grants account access. Sending it here saves an encrypted copy in this direct chat history, where it can be seen by anyone with access to your account and may appear in exports. Revoke it on GitHub if exposed. It is never posted to group chat.</p>
      <button type="button" disabled={busy} onClick={() => void reveal()}>{busy ? 'Checking VM…' : 'Send token to this chat'}</button>
      <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
