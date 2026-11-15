"use client";

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, AtSign, CheckCheck, CircleUserRound, ExternalLink, Github, LoaderCircle, MessageSquare, Plug, Plus, RefreshCw, Search, Settings2, StopCircle, Users } from 'lucide-react';
import { SandboxWorkspace } from './sandbox-workspace';
import { GitHubCliAuth } from './github-cli-auth';
import './agent-chats.css';

type Bot = { id: string; name: string; icon: string; instructions?: string; defaultFolder?: string };
type Message = { id: string; text: string; senderBotId?: string | null; sessionId?: string; createdAt: number; pending?: boolean; failed?: boolean; sensitive?: boolean };
type Activity = { botId: string; sessionId: string; state: string; groupMessageId?: string | null };
type Workspace = { id: string; name: string; sandboxId?: string; status: string };

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function Avatar({ bot, instance }: { bot: Bot; instance: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const version = /^avatar:([0-9a-f-]{36})$/.exec(bot.icon)?.[1];
  const src = version ? `/api/instances/${instance}/bots/${encodeURIComponent(bot.id)}/avatar?v=${version}` : bot.icon.startsWith('data:image/') ? bot.icon : undefined;
  return <span className="agent-avatar">{src && failedSrc !== src ? <img src={src} alt="" onError={() => setFailedSrc(src)} /> : bot.icon === 'github' ? <Github size={25} aria-hidden="true" /> : <CircleUserRound size={25} aria-hidden="true" />}</span>;
}

export function AgentChats({ workspace, onSettings }: { workspace: Workspace; onSettings: () => void }) {
  const base = `/api/instances/${encodeURIComponent(workspace.id)}`;
  const [bots, setBots] = useState<Bot[]>([]);
  const [selected, setSelected] = useState<string>('group');
  const [thread, setThread] = useState<string | null>(null);
  const [threadSelection, setThreadSelection] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState<{ id: string; text: string; mentions: string[] } | null>(null);
  const [mobileThread, setMobileThread] = useState(false);
  const [newAgent, setNewAgent] = useState(false);
  const [githubLoginOpen, setGithubLoginOpen] = useState(false);
  const githubLoginButton = useRef<HTMLButtonElement>(null);
  const [agentName, setAgentName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  const refreshAfterSend = useRef<() => void>(() => {});
  const scroller = useRef<HTMLDivElement>(null);
  const draft = drafts[selected] ?? '';
  const current = bots.find((bot) => bot.id === selected);
  const group = selected === 'group';
  const currentActivity = activity.find((item) => !group && item.botId === selected && item.sessionId === thread);
  const running = currentActivity?.state === 'working';
  const groupRunning = activity.filter((item) => item.groupMessageId && item.state === 'working');
  const mentionedBots = bots.filter((bot) => draft.includes(`@${bot.name}`));
  const groupTargets = mentionedBots.length
    ? groupRunning.filter((item) => mentionedBots.some((bot) => bot.id === item.botId))
    : groupRunning;
  const steerTarget = group
    ? !retry && groupTargets.length === 1 ? groupTargets[0] : undefined
    : running ? currentActivity : undefined;

  function submitDraft() {
    if (steerTarget) void steerTurn(steerTarget);
    else void send();
  }

  const refreshBots = useCallback(async () => {
    try { setBots((await json(`${base}/bots`)).bots || []); } catch (error) { setError((error as Error).message); }
  }, [base]);
  useEffect(() => { const timer = setTimeout(() => { void refreshBots(); }, 0); return () => clearTimeout(timer); }, [refreshBots]);

  useEffect(() => {
    const selection = ++generation.current;
    let stopped = false;
    let pending = false;
    let refreshQueued = false;
    const resetTimer = setTimeout(() => {
      setMessages([]); setThread(null); setLoading(true); setSending(false); setError(''); setMentions([]); setRetry(null);
    }, 0);
    async function refresh() {
      if (pending || stopped || document.hidden) return;
      pending = true;
      try {
        if (selected === 'group') {
          const data = await json(`${base}/group`);
          if (stopped || generation.current !== selection) return;
          setActivity(data.activity || []);
          if (!data.paused) setMessages((previous) => {
            const remote: Message[] = data.messages || [];
            return [...remote, ...previous.filter((row) => row.pending && !remote.some((item) => item.id === row.id))];
          });
        } else {
          let conversation = await json(`${base}/chat/conversations?botId=${encodeURIComponent(selected)}`);
          if (!threadSelection) conversation.conversations = (conversation.conversations || []).filter((row: { source?: string }) => row.source !== 'group');
          if (!conversation.conversations?.length) conversation = await json(`${base}/chat/conversations`, { method: 'POST', body: JSON.stringify({ botId: selected }) });
          const preferred = threadSelection;
          const id = conversation.conversations?.find((row: { sessionId: string }) => row.sessionId === preferred)?.sessionId || conversation.conversations?.find((row: { sessionId: string }) => row.sessionId === conversation.active)?.sessionId || conversation.conversations?.[0]?.sessionId;
          if (!id) throw new Error('No conversation is available for this agent.');
          const [data, status] = await Promise.all([
            json(`${base}/chat/conversations/${encodeURIComponent(id)}?botId=${encodeURIComponent(selected)}`),
            json(`${base}/chat/status?sessionId=${encodeURIComponent(id)}`),
          ]);
          if (stopped || generation.current !== selection) return;
          setThread(id);
          setMessages((data.messages || []).map((row: { id: string; role: string; content: string; sensitive?: boolean }) => ({ id: row.id, text: row.content, senderBotId: row.role === 'user' ? null : selected, sessionId: id, createdAt: 0, sensitive: row.sensitive === true })));
          setActivity((status.conversations || []).filter((row: { busy?: boolean; queued?: boolean }) => row.busy || row.queued).map((row: { botId: string; sessionId: string; busy: boolean }) => ({ botId: row.botId, sessionId: row.sessionId, state: row.busy ? 'working' : 'queued' })));
        }
        setLoading(false);
      } catch (error) {
        if (!stopped && generation.current === selection) { setError((error as Error).message); setLoading(false); }
      } finally {
        pending = false;
        if (refreshQueued && !stopped) { refreshQueued = false; void refresh(); }
      }
    }
    refreshAfterSend.current = () => { if (pending) refreshQueued = true; else void refresh(); };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    const foreground = () => { if (!document.hidden) { void refresh(); void refreshBots(); } };
    document.addEventListener('visibilitychange', foreground);
    return () => { stopped = true; refreshAfterSend.current = () => {}; clearTimeout(resetTimer); clearInterval(timer); document.removeEventListener('visibilitychange', foreground); };
  }, [base, selected, threadSelection, refreshBots]);

  useEffect(() => {
    const list = scroller.current;
    if (list && (sending || list.scrollHeight - list.scrollTop - list.clientHeight < 220 || messages.length < 4)) list.scrollTop = list.scrollHeight;
  }, [messages, sending]);

  function select(id: string, session?: string) {
    if (id !== selected || (session ?? null) !== threadSelection) { generation.current++; setMessages([]); setThread(null); setLoading(true); setSending(false); }
    if (session) { const url = new URL(window.location.href); url.searchParams.set('thread', session); history.replaceState(null, '', url); }
    else { const url = new URL(window.location.href); url.searchParams.delete('thread'); history.replaceState(null, '', url); }
    setThreadSelection(session ?? null); setSelected(id); setMobileThread(true);
  }

  async function send(retrying = false) {
    const text = retrying ? retry?.text ?? '' : draft.trim();
    if (!text || sending || loading) return;
    const selection = generation.current;
    const id = retrying ? retry!.id : crypto.randomUUID();
    const tagged = retrying ? retry!.mentions : mentions.filter((id) => text.includes(`@${bots.find((bot) => bot.id === id)?.name}`));
    setSending(true); setError('');
    if (!retrying) { setMessages((rows) => [...rows, { id, text, createdAt: Date.now(), pending: true }]); setDrafts((all) => ({ ...all, [selected]: '' })); }
    try {
      await json(group ? `${base}/group` : `${base}/chat`, { method: 'POST', body: JSON.stringify(group ? { text, requestId: id, mentions: tagged } : { text, botId: selected, chatId: thread }) });
      if (generation.current !== selection) return;
      setRetry(null); setMentions([]); setMentionOpen(false);
      setMessages((rows) => rows.map((row) => row.id === id ? { ...row, pending: false } : row));
      refreshAfterSend.current();
    } catch (error) {
      if (generation.current !== selection) return;
      setError((error as Error).message);
      if (group) setRetry({ id, text, mentions: tagged });
      else setDrafts((all) => ({ ...all, [selected]: text }));
    } finally { if (generation.current === selection) setSending(false); }
  }

  async function stopTurn(target: Activity) {
    if (sending) return;
    const selection = generation.current;
    setSending(true); setError('');
    try {
      const result = await json(`${base}/chat/stop`, { method: 'POST', body: JSON.stringify({ botId: target.botId, chatId: target.sessionId }) });
      if (result.ok !== true) throw new Error(result.error || 'Could not stop the agent.');
      if (generation.current === selection) setActivity((items) => items.filter((item) => item.sessionId !== target.sessionId));
    } catch (error) { if (generation.current === selection) setError((error as Error).message); }
    finally { if (generation.current === selection) setSending(false); }
  }

  async function steerTurn(target: Activity) {
    const text = draft.trim();
    if (target.state !== 'working' || !text || sending) return;
    const selection = generation.current;
    const draftKey = selected;
    setSending(true); setError('');
    try {
      const result = await json(`${base}/chat/steer`, { method: 'POST', body: JSON.stringify({ text, botId: target.botId, chatId: target.sessionId }) });
      if (result.ok !== true || result.steered !== true) throw new Error(result.error || 'Agent did not accept the steer.');
      if (generation.current === selection) setDrafts((all) => ({ ...all, [draftKey]: all[draftKey]?.trim() === text ? '' : all[draftKey] }));
    } catch (error) { if (generation.current === selection) setError((error as Error).message); }
    finally { if (generation.current === selection) setSending(false); }
  }

  async function continueAfterControl(notes: string) {
    const prompt = 'Manual desktop control is complete. Use desktop_observe to inspect the current window and browser tab in the SAME E2B desktop, then continue the original task without replaying manual actions or exposing secrets.' +
      (notes ? `\n\nUser notes about the manual changes:\n${notes}` : '');
    if (!group && !thread) throw new Error('No conversation is selected');
    await json(group ? `${base}/group` : `${base}/chat`, { method: 'POST', body: JSON.stringify(group
      ? { text: prompt, requestId: crypto.randomUUID(), mentions: ['main'] }
      : { text: prompt, botId: selected, chatId: thread }) });
  }

  async function createAgent() {
    if (!agentName.trim() || creating) return;
    setCreating(true); setError('');
    try {
      await json(`${base}/bots`, { method: 'POST', body: JSON.stringify({ name: agentName.trim(), instructions, icon: '🤖', createKey: crypto.randomUUID() }) });
      await refreshBots(); setNewAgent(false); setAgentName(''); setInstructions('');
    } catch (error) { setError((error as Error).message); }
    finally { setCreating(false); }
  }

  return <section className={`agent-chats ${mobileThread ? 'agent-thread-open' : ''}`} aria-label="Agent chats">
    <aside className="agent-contacts">
      <header><h1>Chats</h1><button type="button" aria-label="Create agent" onClick={() => setNewAgent(true)}><Plus size={20} /></button></header>
      <label className="agent-search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents" aria-label="Search agents" /></label>
      <div className="agent-workspace"><span className="agent-state-dot" />{workspace.name}<button type="button" onClick={onSettings} aria-label="Workspace settings"><Settings2 size={17} /></button></div>
      <button ref={githubLoginButton} type="button" className="agent-workspace-action" onClick={() => setGithubLoginOpen(true)}><Github size={19} /><span><strong>Connect GitHub CLI</strong><small>Sign in on this VM</small></span><ExternalLink size={15} /></button>
      <button type="button" className={`agent-contact ${group ? 'selected' : ''}`} onClick={() => select('group')}><span className="agent-avatar group"><Users size={23} /></span><span><strong>Agent group</strong><small>{bots.length} agents · @ to mention</small></span></button>
      <h2>Direct messages</h2>
      <div className="agent-list">{bots.filter((bot) => bot.name.toLowerCase().includes(search.toLowerCase())).map((bot) => <button type="button" key={bot.id} className={`agent-contact ${selected === bot.id ? 'selected' : ''}`} onClick={() => select(bot.id)}><Avatar bot={bot} instance={workspace.id} /><span><strong>{bot.name}</strong><small>{activity.some((item) => item.botId === bot.id && item.state === 'working') ? 'Working…' : bot.id === 'main' ? 'Your main assistant' : 'Direct message'}</small></span></button>)}</div>
      <footer><Link href={`/dashboard/marketplace?instance=${encodeURIComponent(workspace.id)}`}><Plug size={17} />Skills Marketplace</Link><button type="button" onClick={onSettings}><Settings2 size={17} />Workspace settings</button></footer>
    </aside>
    <div className="agent-thread">
      <header><button type="button" className="agent-back" aria-label="Back to chats" onClick={() => setMobileThread(false)}><ArrowLeft size={20} /></button>{group ? <span className="agent-avatar group"><Users size={22} /></span> : current ? <Avatar bot={current} instance={workspace.id} /> : null}<div><h2>{group ? 'Agent group' : current?.name ?? 'Agent'}</h2><p>{group ? 'Everyone can read · Chief replies unless tagged' : 'Direct conversation · separate from the group'}</p></div><button type="button" aria-label="Refresh agents" onClick={() => void refreshBots()}><RefreshCw size={18} /></button></header>
      {error && <div className="agent-error" role="alert">{error}{retry && <button type="button" onClick={() => void send(true)}>Retry message</button>}</div>}
      {!!activity.length && <div className="agent-activity">{activity.map((item, index) => <div key={`${item.sessionId}-${index}`}><button type="button" onClick={() => select(item.botId, item.sessionId)}>{item.state === 'working' && <LoaderCircle size={13} className="agent-working" />}{bots.find((bot) => bot.id === item.botId)?.name ?? item.botId} · {item.state}<ExternalLink size={12} /></button>{group && item.groupMessageId && <button type="button" aria-label={`Stop ${item.botId}`} title={`Stop ${item.botId}`} disabled={sending} onClick={() => void stopTurn(item)}><StopCircle size={17} /></button>}</div>)}</div>}
      <div className="agent-messages" ref={scroller} aria-live="polite">{loading ? <p className="agent-empty">Opening {group ? 'group chat' : current?.name ?? 'agent'}…</p> : !messages.length ? <div className="agent-empty"><MessageSquare size={42} /><h3>Your agents, together</h3><p>Ask a question or tag an agent with @. Group messages are shared; direct chats stay separate.</p></div> : messages.map((message) => { const bot = bots.find((bot) => bot.id === message.senderBotId); return <article key={message.id} className={`agent-message ${!message.senderBotId ? 'mine' : ''}`}>{message.senderBotId && <button type="button" className="agent-author" onClick={() => select(message.senderBotId!, message.sessionId)}>{bot?.name ?? message.senderBotId}<ExternalLink size={11} /></button>}<div>{message.sensitive && <strong className="agent-sensitive-label">Sensitive credential · saved in this private chat</strong>}{message.text}</div><small>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}{!message.senderBotId && <CheckCheck size={13} />}</small></article>; })}</div>
      {mentionOpen && <div className="agent-mentions">{bots.map((bot) => <button type="button" key={bot.id} onClick={() => { setDrafts((all) => ({ ...all, [selected]: `${draft.replace(/@[^@\n]*$/, '')}@${bot.name} ` })); setMentions((ids) => [...new Set([...ids, bot.id])]); setMentionOpen(false); }}><Avatar bot={bot} instance={workspace.id} />{bot.name}</button>)}</div>}
      <form className="agent-composer" onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>{group && <button type="button" aria-label="Mention an agent" onClick={() => setMentionOpen(!mentionOpen)}><AtSign size={20} /></button>}<textarea aria-label={group ? 'Message the group' : `Message ${current?.name ?? 'agent'}`} placeholder={group ? 'Message the group · @ to mention' : 'Write a message…'} value={draft} rows={1} onChange={(e) => { setDrafts((all) => ({ ...all, [selected]: e.target.value })); if (group) setMentionOpen(/@[^@\n ]*$/.test(e.target.value)); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submitDraft(); } }} />{currentActivity && <button type="button" aria-label="Stop running agent" title="Stop agent" disabled={sending} onClick={() => void stopTurn(currentActivity)}><StopCircle size={20} /></button>}<button className="agent-send" type="submit" aria-label={steerTarget ? `Steer ${steerTarget.botId}` : 'Send message'} title={steerTarget ? `Steer ${steerTarget.botId}` : 'Send message'} disabled={!draft.trim() || loading || sending}>{sending ? <LoaderCircle size={20} /> : <ArrowUp size={20} />}</button></form>
    </div>
    <aside className="agent-computer"><SandboxWorkspace key={`${workspace.id}-${group ? 'main' : selected}`} instanceId={workspace.id} botId={group ? 'main' : selected} sandboxId={workspace.sandboxId} runtime="supercharge" onContinue={continueAfterControl} /></aside>
    {githubLoginOpen && <GitHubCliAuth base={base} onClose={() => { setGithubLoginOpen(false); githubLoginButton.current?.focus(); }} />}
    {newAgent && <div className="agent-dialog-backdrop"><form role="dialog" aria-modal="true" aria-labelledby="new-agent-title" onSubmit={(e) => { e.preventDefault(); void createAgent(); }}><h2 id="new-agent-title">New agent</h2><label>Name<input value={agentName} onChange={(e) => setAgentName(e.target.value)} maxLength={80} required autoFocus /></label><label>Instructions<textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={16000} rows={5} /></label><p>Agents share this workspace. Folders organize files, but are not security boundaries.</p><div><button type="button" onClick={() => setNewAgent(false)} disabled={creating}>Cancel</button><button type="submit" disabled={creating || !agentName.trim()}>{creating ? 'Creating…' : 'Create agent'}</button></div></form></div>}
  </section>;
}
