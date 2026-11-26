'use client';

import { useEffect, useState } from 'react';

type Agent = { id: string; name: string; instructions: string; engine: string };
type Settings = { engine: string; workspaceRoot: string; previewPort: number; desktopUrl: string };

export function WorkspaceSettings({ instanceId, disabled }: { instanceId: string; disabled?: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [message, setMessage] = useState('Loading sandbox settings…');

  async function load() {
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/sandbox-state`);
    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Sandbox settings unavailable');
      return;
    }
    setAgents(data.agents || []);
    setSettings(data.settings);
    setMessage('');
  }

  useEffect(() => { if (!disabled) void load().catch((error: Error) => setMessage(error.message)); }, [disabled, instanceId]);

  async function addAgent() {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/sandbox-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { id, name: name.trim(), instructions, engine: 'supercharge' } }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error || 'Agent was not saved'); return; }
    setName('');
    setInstructions('');
    await load();
  }

  async function savePort(previewPort: number) {
    if (!settings) return;
    const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/sandbox-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings: { ...settings, previewPort, engine: 'supercharge' } }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error || 'Settings were not saved'); return; }
    setSettings(data.settings || data);
    setMessage('Saved. Engine stays Supercharge.');
  }

  return (
    <div className="grid gap-4 rounded-xl border border-zinc-800 bg-black p-4 text-sm text-zinc-200">
      {message ? <p className="text-xs text-zinc-400">{message}</p> : null}
      <div>
        <h4 className="font-medium text-white">Agents</h4>
        <p className="mt-1 text-xs text-zinc-500">Same list on this computer and on the phone. Every agent uses the Supercharge engine inside this sandbox.</p>
        <ul className="mt-2 space-y-1 text-xs">
          {agents.map((agent) => <li key={agent.id} className="rounded border border-zinc-800 px-2 py-1">{agent.name} · {agent.engine}</li>)}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Agent name" className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs" />
          <input value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Instructions" className="min-w-48 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs" />
          <button type="button" disabled={disabled || !name.trim()} onClick={() => void addAgent()} className="rounded bg-sky-700 px-3 py-1 text-xs text-white disabled:opacity-50">Add agent</button>
        </div>
      </div>
      {settings ? (
        <label className="text-xs text-zinc-400">Preview port
          <input defaultValue={settings.previewPort} type="number" min={1} max={65535} onBlur={(event) => void savePort(Number(event.target.value))} className="ml-2 w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-200" />
        </label>
      ) : null}
    </div>
  );
}
