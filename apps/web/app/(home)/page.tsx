'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  ExternalLink,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react';

const activity = [3, 2, 4, 3, 5, 4, 6];
const dates = ['Jun 3', 'Jun 4', 'Jun 5', 'Jun 6', 'Jun 7', 'Jun 8', 'Jun 9'];

function relativeCheckedLabel(minutes: number) {
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  return `${minutes} min ago`;
}

function ActivityGraph() {
  const points = activity
    .map((value, index) => {
      const x = 66 + index * 95;
      const y = 224 - value * 2.5;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-black">
      <div className="relative aspect-[2.35/1] min-h-64 w-full">
        <svg
          viewBox="0 0 720 270"
          role="img"
          aria-label="Seven day activity graph with values near zero from June 3 to June 9"
          className="h-full w-full"
          preserveAspectRatio="none"
        >
          <rect x="58" y="32" width="628" height="192" fill="#ffffff" />
          <g stroke="#bfdbfe" strokeWidth="1">
            <line x1="58" y1="48" x2="686" y2="48" />
            <line x1="58" y1="92" x2="686" y2="92" />
            <line x1="58" y1="136" x2="686" y2="136" />
            <line x1="58" y1="180" x2="686" y2="180" />
            <line x1="58" y1="224" x2="686" y2="224" />
            <line x1="58" y1="32" x2="58" y2="224" />
            <line x1="686" y1="32" x2="686" y2="224" />
          </g>

          <g fill="#64748b" fontSize="11" fontFamily="ui-sans-serif, system-ui">
            <text x="18" y="52">100</text>
            <text x="26" y="96">75</text>
            <text x="26" y="140">50</text>
            <text x="26" y="184">25</text>
            <text x="34" y="228">0</text>
            <text x="694" y="52">100</text>
            <text x="694" y="96">75</text>
            <text x="694" y="140">50</text>
            <text x="694" y="184">25</text>
            <text x="694" y="228">0</text>
          </g>

          <text
            x="75"
            y="78"
            fill="#0f172a"
            fontSize="52"
            fontWeight="700"
            fontFamily="ui-sans-serif, system-ui"
          >
            0
          </text>

          <polyline
            points={points}
            fill="none"
            stroke="#22c55e"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {activity.map((value, index) => {
            const x = 66 + index * 95;
            const y = 224 - value * 2.5;
            return (
              <circle
                key={dates[index]}
                cx={x}
                cy={y}
                r="4"
                fill="#22c55e"
                stroke="#052e16"
                strokeWidth="2"
              />
            );
          })}
        </svg>
      </div>
      <div className="grid grid-cols-7 border-t border-slate-800 px-10 py-3 text-center text-[11px] font-medium text-slate-500 sm:text-xs">
        {dates.map((date) => (
          <span key={date}>{date}</span>
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [lastCheckedMinutes, setLastCheckedMinutes] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLastCheckedMinutes((current) => current + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const checkedLabel = useMemo(
    () => relativeCheckedLabel(lastCheckedMinutes),
    [lastCheckedMinutes],
  );

  function refreshDashboard() {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => {
      setLastCheckedMinutes(0);
      setCacheCleared(false);
      setRefreshing(false);
    }, 650);
  }

  return (
    <div className="monitoring-dashboard min-h-screen bg-slate-100 text-slate-950">
      <header className="w-full border-b border-slate-800 bg-black text-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-0">
          <div className="flex items-center gap-3 lg:h-16">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500 text-black">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Monitoring dashboard
            </span>
          </div>

          <nav
            aria-label="Dashboard sections"
            className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm text-slate-300"
          >
            <a
              href="#system-overview"
              className="whitespace-nowrap rounded-md px-3 py-2 transition-colors hover:bg-slate-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400"
            >
              System overview
            </a>
            <a
              href="#checks"
              className="whitespace-nowrap rounded-md px-3 py-2 transition-colors hover:bg-slate-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400"
            >
              Checks
            </a>
            <a
              href="#instance"
              className="ml-auto inline-flex whitespace-nowrap items-center gap-2 rounded-md px-3 py-2 font-medium text-green-300 transition-colors hover:bg-slate-900 hover:text-green-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-400"
            >
              <span className="h-2 w-2 rounded-full bg-green-400" aria-hidden="true" />
              Instance online
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <section id="system-overview" aria-labelledby="dashboard-title">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h1
                  id="dashboard-title"
                  className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl"
                >
                  Dashboard
                </h1>
                <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-200">
                  <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                  All systems operational
                </span>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                Live service health, check activity, and instance connectivity.
              </p>
            </div>

            <div className="flex items-center gap-3 sm:pt-1">
              <span className="text-sm text-slate-500" aria-live="polite">
                Last checked: {checkedLabel}
              </span>
              <button
                type="button"
                onClick={refreshDashboard}
                disabled={refreshing}
                aria-label="Refresh dashboard status"
                title="Refresh status"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ['Monitoring success', '3'],
              ['Monitoring backlog', '0'],
              ['Monitoring errors', '0'],
            ].map(([label, value]) => (
              <article
                key={label}
                className="rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-sm"
              >
                <p className="text-sm font-medium text-slate-500">{label}</p>
                <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-slate-950">
                  {value}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="checks"
          aria-label="Monitoring checks"
          className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.75fr)_minmax(260px,0.85fr)]"
        >
          <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-950">
                    Monitoring activity
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Successful checks over the last seven days
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800 ring-1 ring-inset ring-green-200">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Monitoring success
                </span>
              </div>
            </div>
            <div className="px-4 py-4 sm:px-6 sm:py-6">
              <ActivityGraph />
            </div>
          </article>

          <aside className="grid content-start gap-6">
            <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">Current system status</p>
                  <p className="mt-3 text-2xl font-bold text-slate-950">All systems operational</p>
                </div>
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
              </div>
            </article>

            <article className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <Server className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
                <div>
                  <h2 className="text-base font-bold text-slate-950">API connection</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    API connection is currently available.
                  </p>
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Monitored service
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-800">GitHub</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                        Successful
                      </span>
                    </div>
                  </div>
                  <a
                    href="https://www.githubstatus.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 inline-flex items-center gap-2 rounded-md bg-blue-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    View status
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </article>
          </aside>
        </section>

        <section
          id="instance"
          aria-labelledby="instance-title"
          className="mt-6 border border-slate-200 border-t-4 border-t-green-500 bg-white p-6 shadow-sm sm:p-7"
        >
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
              <div>
                <h2 id="instance-title" className="text-lg font-bold text-slate-950">
                  System status
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {cacheCleared
                    ? 'Cached monitoring result cleared. The next scheduled run will fetch fresh data.'
                    : 'Instance is online and checks are reporting normally.'}
                </p>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-sm font-semibold text-slate-700">Next scheduled run</p>
              <p className="mt-1 text-sm text-slate-500">in about 44 minutes</p>
            </div>
          </div>
          <div className="mt-6 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={() => setCacheCleared(true)}
              disabled={cacheCleared}
              className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:border-red-400 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-default disabled:border-red-100 disabled:text-red-300 disabled:hover:bg-white"
            >
              {cacheCleared ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {cacheCleared ? 'Cached result cleared' : 'Clear cached result'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
