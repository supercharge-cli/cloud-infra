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
};

type AdminInstance = {
  id: string;
  userId: string;
  ownerEmail?: string | null;
  name: string;
  status: string;
  sandboxId?: string;
  paidUntil?: string;
  paid?: boolean;
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showDestroyed, setShowDestroyed] = useState(false);

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
    try {
      const res = await fetch('/api/admin/instances', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function destroyInstance(id: string) {
    if (!confirm('Destroy this sandbox for the customer? Cannot be undone.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/instances?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Destroy failed');
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
            Admin
          </p>
          <h1 className="text-3xl font-bold text-white">Control panel</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Signed in as <span className="text-zinc-200">{email}</span> · {BRAND.name}
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Users" value={stats.users} sub={`${stats.admins} admin`} />
          <StatCard label="Instances" value={stats.instances} sub={`${stats.running} running · ${stats.paused} paused`} />
          <StatCard label="Paid active" value={stats.paidActive} sub="subscription valid" />
          <StatCard label="Orders paid" value={stats.ordersPaid} sub={`${stats.ordersTotal} total`} />
        </div>
      ) : null}

      {tab === 'users' ? (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
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
                  <td className="px-4 py-3 text-zinc-400">
                    {new Date(u.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'instances' ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={showDestroyed}
              onChange={(e) => setShowDestroyed(e.target.checked)}
            />
            Include destroyed
          </label>
          <div className="overflow-x-auto rounded-2xl border border-zinc-800">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Instance</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Paid until</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.id} className="border-b border-zinc-900/80 hover:bg-zinc-950/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{inst.name}</div>
                      <div className="font-mono text-[11px] text-zinc-600">
                        {inst.id}
                        {inst.sandboxId ? ` · ${inst.sandboxId.slice(0, 10)}…` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {inst.ownerEmail || inst.userId}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300">
                        {inst.status}
                      </span>
                      {inst.paid === false ? (
                        <span className="ml-1 text-[11px] text-red-400">unpaid</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {inst.paidUntil
                        ? new Date(inst.paidUntil).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void instanceAction(inst.id, 'extend', { days: 30 })}
                          className="rounded border border-emerald-900/50 px-2 py-0.5 text-[11px] text-emerald-400 hover:bg-emerald-950/40 disabled:opacity-50"
                        >
                          +30d
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void instanceAction(inst.id, 'mark_unpaid')}
                          className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-900 disabled:opacity-50"
                        >
                          Unpaid
                        </button>
                        {inst.status !== 'destroyed' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void destroyInstance(inst.id)}
                            className="rounded border border-red-900/50 px-2 py-0.5 text-[11px] text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                          >
                            Destroy
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {instances.length === 0 ? (
              <p className="p-6 text-center text-sm text-zinc-600">No instances</p>
            ) : null}
          </div>
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
