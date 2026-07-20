'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BRAND } from '@/lib/brand';

type Stats = {
  users: number;
  admins: number;
  instances: number;
  running: number;
  paused: number;
  paidActive: number;
  ordersPaid: number;
  ordersTotal: number;
};

type AdminUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  instanceCount?: number;
};

type AdminInstance = {
  id: string;
  userId: string;
  ownerEmail?: string | null;
  name: string;
  status: string;
  sandboxId?: string;
  sessionId?: string;
  paidUntil?: string;
  paid?: boolean;
  isFree?: boolean;
  billingStatus?: string;
  createdAt: string;
  lastError?: string;
};

type AdminOrder = {
  id: string;
  email: string;
  purpose: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt?: string;
  razorpayOrderId: string;
  instanceId?: string;
};

export function AdminPanel({ email }: { email: string }) {
  const [tab, setTab] = useState<'overview' | 'users' | 'instances' | 'orders'>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [instances, setInstances] = useState<AdminInstance[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showDestroyed, setShowDestroyed] = useState(false);
  const [logs, setLogs] = useState('');

  // Provision form
  const [provUserId, setProvUserId] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provName, setProvName] = useState('workspace');
  const [provDays, setProvDays] = useState(30);
  const [provCreateUser, setProvCreateUser] = useState(false);
  const [provPassword, setProvPassword] = useState('');

  // Create user form
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  // Selected instance for command / detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cmdInput, setCmdInput] = useState('');
  const [cmdOut, setCmdOut] = useState('');
  const [reassignUserId, setReassignUserId] = useState('');
  const [renameVal, setRenameVal] = useState('');

  const selected = instances.find((i) => i.id === selectedId) || null;

  const load = useCallback(async () => {
    setError('');
    try {
      const [sRes, uRes, iRes, oRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users'),
        fetch(`/api/admin/instances${showDestroyed ? '?destroyed=1' : ''}`),
        fetch('/api/admin/orders'),
      ]);
      const s = await sRes.json();
      const u = await uRes.json();
      const i = await iRes.json();
      const o = await oRes.json();
      if (!sRes.ok) throw new Error(s.error || 'Stats failed');
      if (!uRes.ok) throw new Error(u.error || 'Users failed');
      if (!iRes.ok) throw new Error(i.error || 'Instances failed');
      if (!oRes.ok) throw new Error(o.error || 'Orders failed');
      setStats(s.stats);
      setUsers(u.users || []);
      setInstances(i.instances || []);
      setOrders(o.orders || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showDestroyed]);

  useEffect(() => {
    void load();
  }, [load]);

  function flashOk(msg: string) {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(''), 4000);
  }

  async function setRole(userId: string, role: 'admin' | 'user') {
    if (!confirm(`Set role to ${role}?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      flashOk(`Role updated`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createUser() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      setNewEmail('');
      setNewPassword('');
      flashOk(`User ${data.user?.email} created`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(userId: string, hard: boolean) {
    const msg = hard
      ? 'Delete user AND hard-remove all their instances from DB + kill sandboxes?'
      : 'Delete user and destroy all their sandboxes?';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ id: userId });
      if (hard) q.set('hard', '1');
      const res = await fetch(`/api/admin/users?${q}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      flashOk(`User deleted · ${data.destroyedInstances || 0} instances removed`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function provision() {
    setBusy(true);
    setError('');
    setLogs('');
    try {
      const res = await fetch('/api/admin/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: provUserId || undefined,
          email: provEmail || undefined,
          name: provName,
          days: provDays,
          createUserIfMissing: provCreateUser,
          password: provCreateUser ? provPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Provision failed');
      flashOk(
        `Instance ${data.instance?.id} created for ${data.owner?.email}${
          data.createdUser ? ' (new user)' : ''
        }`,
      );
      setLogs(JSON.stringify(data, null, 2));
      setTab('instances');
      if (data.instance?.id) setSelectedId(data.instance.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function instanceAction(
    instanceId: string,
    action: string,
    extra?: Record<string, unknown>,
  ) {
    setBusy(true);
    setError('');
    setLogs('');
    try {
      const res = await fetch('/api/admin/instances', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed');
      if (data.logs) setLogs(Array.isArray(data.logs) ? data.logs.join('\n') : String(data.logs));
      if (action === 'exec') {
        setCmdOut(
          [
            `exit ${data.exitCode}`,
            data.stdout || '',
            data.stderr || '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } else {
        flashOk(`OK · ${action}`);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function destroyInstance(id: string, hard: boolean) {
    const msg = hard
      ? 'HARD delete: kill sandbox and remove from database forever?'
      : 'Destroy sandbox (mark destroyed, remove from customer list)?';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ id });
      if (hard) q.set('hard', '1');
      const res = await fetch(`/api/admin/instances?${q}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Destroy failed');
      if (selectedId === id) setSelectedId(null);
      flashOk(hard ? 'Instance hard-deleted' : 'Instance destroyed');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'users' as const, label: `Users (${users.length})` },
    { id: 'instances' as const, label: `Instances (${instances.length})` },
    { id: 'orders' as const, label: `Orders (${orders.length})` },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-orange-500">
            Admin · full control
          </p>
          <h1 className="text-3xl font-bold text-white">Control panel</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Signed in as <span className="text-zinc-200">{email}</span> · provision, manage, remove
            anything
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Refresh
          </button>
          <Link
            href={BRAND.dashboard}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            My dashboard
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => setError('')}>
            dismiss
          </button>
        </div>
      ) : null}
      {okMsg ? (
        <div className="mb-4 rounded-lg border border-emerald-900/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
          {okMsg}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t.id
                ? 'bg-orange-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-500">Loading admin data…</p>
      ) : tab === 'overview' && stats ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Users" value={stats.users} sub={`${stats.admins} admin`} />
            <StatCard
              label="Instances"
              value={stats.instances}
              sub={`${stats.running} running · ${stats.paused} paused`}
            />
            <StatCard label="Paid active" value={stats.paidActive} sub="subscription valid" />
            <StatCard
              label="Orders paid"
              value={stats.ordersPaid}
              sub={`${stats.ordersTotal} total`}
            />
          </div>

          {/* Quick provision on overview */}
          <div className="rounded-2xl border border-orange-500/20 bg-zinc-950 p-5">
            <h2 className="mb-1 text-lg font-semibold text-white">Provision instance (free)</h2>
            <p className="mb-4 text-xs text-zinc-500">
              Creates a real sandbox via gateway for any user — no Razorpay. Requires gateway online.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-xs text-zinc-400">
                Owner user id
                <select
                  value={provUserId}
                  onChange={(e) => setProvUserId(e.target.value)}
                  className="field mt-1"
                >
                  <option value="">— or use email below —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email} ({u.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-zinc-400">
                Owner email
                <input
                  value={provEmail}
                  onChange={(e) => setProvEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="field mt-1"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Instance name
                <input
                  value={provName}
                  onChange={(e) => setProvName(e.target.value)}
                  className="field mt-1"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Paid days
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={provDays}
                  onChange={(e) => setProvDays(Number(e.target.value) || 30)}
                  className="field mt-1"
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={provCreateUser}
                  onChange={(e) => setProvCreateUser(e.target.checked)}
                />
                Create user if email missing
              </label>
              {provCreateUser ? (
                <label className="block text-xs text-zinc-400">
                  New user password
                  <input
                    type="text"
                    value={provPassword}
                    onChange={(e) => setProvPassword(e.target.value)}
                    className="field mt-1"
                    placeholder="min 8 chars"
                  />
                </label>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy || (!provUserId && !provEmail)}
              onClick={() => void provision()}
              className="mt-4 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {busy ? 'Provisioning…' : 'Create sandbox now'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'users' ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <h3 className="mb-3 font-semibold text-white">Create user</h3>
            <div className="flex flex-wrap gap-3">
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email"
                className="field min-w-[200px] flex-1"
              />
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="password"
                className="field min-w-[160px] flex-1"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                className="field w-auto"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
              <button
                type="button"
                disabled={busy || !newEmail || newPassword.length < 8}
                onClick={() => void createUser()}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Instances</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-zinc-900/80 hover:bg-zinc-950/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{u.email}</div>
                      <div className="font-mono text-[11px] text-zinc-600">{u.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          u.role === 'admin'
                            ? 'border-orange-800 bg-orange-950 text-orange-300'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{u.instanceCount ?? 0}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(u.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {u.role === 'admin' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setRole(u.id, 'user')}
                            className="text-xs text-zinc-400 hover:text-white disabled:opacity-50"
                          >
                            Demote
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setRole(u.id, 'admin')}
                            className="text-xs text-orange-400 hover:text-orange-300 disabled:opacity-50"
                          >
                            Make admin
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setProvUserId(u.id);
                            setProvEmail(u.email);
                            setTab('overview');
                          }}
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          + Instance
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void deleteUser(u.id, false)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void deleteUser(u.id, true)}
                          className="text-xs text-red-500 hover:text-red-400"
                        >
                          Hard delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'instances' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={showDestroyed}
                onChange={(e) => setShowDestroyed(e.target.checked)}
              />
              Include destroyed
            </label>
            <button
              type="button"
              onClick={() => setTab('overview')}
              className="text-sm text-orange-400 hover:underline"
            >
              + Provision new instance
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Instance</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Paid until</th>
                  <th className="px-4 py-3">Select</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr
                    key={inst.id}
                    className={`border-b border-zinc-900/80 hover:bg-zinc-950/60 ${
                      selectedId === inst.id ? 'bg-orange-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{inst.name}</div>
                      <div className="font-mono text-[11px] text-zinc-600">
                        {inst.id}
                        {inst.sandboxId ? ` · sbx ${inst.sandboxId.slice(0, 12)}…` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {inst.ownerEmail || inst.userId}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300">
                        {inst.status}
                      </span>
                      {inst.isFree ? (
                        <span className="ml-1 text-[11px] text-emerald-400">free</span>
                      ) : inst.paid === false ? (
                        <span className="ml-1 text-[11px] text-red-400">unpaid</span>
                      ) : (
                        <span className="ml-1 text-[11px] text-emerald-500/80">paid</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {inst.paidUntil ? new Date(inst.paidUntil).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(inst.id);
                          setRenameVal(inst.name);
                          setCmdOut('');
                        }}
                        className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-orange-400 hover:bg-zinc-900"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {instances.length === 0 ? (
              <p className="p-6 text-center text-sm text-zinc-600">
                No instances — provision one from Overview
              </p>
            ) : null}
          </div>

          {selected ? (
            <div className="rounded-2xl border border-orange-500/30 bg-zinc-950 p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    Manage · {selected.name}
                  </h3>
                  <p className="font-mono text-xs text-zinc-500">
                    {selected.id} · owner {selected.ownerEmail || selected.userId}
                    {selected.sandboxId ? ` · ${selected.sandboxId}` : ''}
                  </p>
                  {selected.lastError ? (
                    <p className="mt-1 text-xs text-red-400">{selected.lastError}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-xs text-zinc-500 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <ActionBtn
                  disabled={busy}
                  onClick={() => void instanceAction(selected.id, 'wake')}
                  className="bg-emerald-600 text-white"
                >
                  Wake / resume
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void instanceAction(selected.id, 'restart')}
                >
                  Restart daemon
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void instanceAction(selected.id, 'extend', { days: 7 })}
                  className="border-emerald-800 text-emerald-400"
                >
                  +7d
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void instanceAction(selected.id, 'extend', { days: 30 })}
                  className="border-emerald-800 text-emerald-400"
                >
                  +30d
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void instanceAction(selected.id, 'extend', { days: 365 })}
                  className="border-emerald-800 text-emerald-400"
                >
                  +1y
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void instanceAction(selected.id, 'mark_unpaid')}
                >
                  Mark unpaid
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void destroyInstance(selected.id, false)}
                  className="border-red-900/50 text-red-400"
                >
                  Destroy
                </ActionBtn>
                <ActionBtn
                  disabled={busy}
                  onClick={() => void destroyInstance(selected.id, true)}
                  className="border-red-800 bg-red-950/40 text-red-300"
                >
                  Hard delete
                </ActionBtn>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="flex gap-2">
                  <input
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    placeholder="Rename"
                    className="field flex-1"
                  />
                  <button
                    type="button"
                    disabled={busy || !renameVal.trim()}
                    onClick={() =>
                      void instanceAction(selected.id, 'rename', { name: renameVal.trim() })
                    }
                    className="rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300"
                  >
                    Rename
                  </button>
                </div>
                <div className="flex gap-2">
                  <select
                    value={reassignUserId}
                    onChange={(e) => setReassignUserId(e.target.value)}
                    className="field flex-1"
                  >
                    <option value="">Reassign to user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || !reassignUserId}
                    onClick={() =>
                      void instanceAction(selected.id, 'reassign', {
                        newUserId: reassignUserId,
                      })
                    }
                    className="rounded-lg border border-zinc-700 px-3 text-sm text-zinc-300"
                  >
                    Reassign
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Admin command pane (no payment check)
                </p>
                <div className="flex gap-2">
                  <input
                    value={cmdInput}
                    onChange={(e) => setCmdInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && cmdInput.trim()) {
                        void instanceAction(selected.id, 'exec', { command: cmdInput.trim() });
                      }
                    }}
                    placeholder="shell command…"
                    className="field flex-1 font-mono text-sm"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    disabled={busy || !cmdInput.trim()}
                    onClick={() =>
                      void instanceAction(selected.id, 'exec', { command: cmdInput.trim() })
                    }
                    className="rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Run
                  </button>
                </div>
                {cmdOut ? (
                  <pre className="mt-3 max-h-64 overflow-auto rounded-xl border border-zinc-800 bg-black p-3 font-mono text-[11px] text-zinc-300 whitespace-pre-wrap">
                    {cmdOut}
                  </pre>
                ) : null}
              </div>
            </div>
          ) : null}

          {logs ? (
            <pre className="max-h-48 overflow-auto rounded-xl border border-zinc-800 bg-black p-3 text-xs text-zinc-400 whitespace-pre-wrap">
              {logs}
            </pre>
          ) : null}
        </div>
      ) : null}

      {tab === 'orders' ? (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-zinc-900/80 hover:bg-zinc-950/60">
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    {new Date(o.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-zinc-200">{o.email}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {o.purpose}
                    {o.instanceId ? (
                      <span className="block font-mono text-[10px] text-zinc-600">
                        {o.instanceId}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-zinc-300">
                    {o.currency} {(o.amountCents / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        o.status === 'paid'
                          ? 'bg-emerald-950 text-emerald-300'
                          : 'bg-zinc-900 text-zinc-400'
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-600">No orders yet</p>
          ) : null}
        </div>
      ) : null}

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(63 63 70);
          background: rgb(24 24 27);
          padding: 0.5rem 0.75rem;
          color: white;
          outline: none;
          font-size: 0.875rem;
        }
        .field:focus {
          border-color: rgb(249 115 22);
        }
      `}</style>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-white">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  disabled,
  className = 'border-zinc-700 text-zinc-300',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
