'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Cloud,
  Cpu,
  MessageCircle,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { SiteHeader } from '@/components/site-header';

const features = [
  {
    icon: Cpu,
    title: '4 vCPU · 8 GB sandboxes',
    desc: 'Dedicated E2B VMs with XibeCode preinstalled — ready for real coding agents, not toy containers.',
  },
  {
    icon: Bot,
    title: 'AI + Telegram in one flow',
    desc: 'Paste your LLM key and bot token. We write config into the sandbox and start the daemon.',
  },
  {
    icon: Shield,
    title: 'Pairing by default',
    desc: 'Users DM the bot, get a code, you approve in the dashboard. Or open access if you prefer.',
  },
  {
    icon: MessageCircle,
    title: 'Chat from anywhere',
    desc: 'Your agent keeps running in the cloud. Talk over Telegram while it edits code on the sandbox.',
  },
  {
    icon: Zap,
    title: 'Lifecycle managed',
    desc: 'Gateway auto-pause / cycle so idle sandboxes do not burn budget forever.',
  },
  {
    icon: Terminal,
    title: 'Built on XibeCode',
    desc: 'Same open-source agent engine as the CLI — modes, tools, memory — hosted for you.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-hidden bg-black text-zinc-100">
      <SiteHeader />

      <section className="relative mx-auto max-w-7xl px-4 pb-24 pt-20 text-center md:pt-28">
        <div className="pointer-events-none absolute left-1/2 top-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-orange-600/15 blur-[120px]" />

        <div className="relative z-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-4 py-1.5 text-xs font-mono text-zinc-400">
            <Cloud className="h-3.5 w-3.5 text-orange-500" />
            Managed AI coding infrastructure
          </div>

          <h1 className="mb-6 text-5xl font-bold tracking-tight md:text-7xl">
            <span className="bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent">
              Cloud sandboxes for
            </span>
            <br />
            <span className="text-orange-500">agents that ship</span>
          </h1>

          <p className="mx-auto mb-10 max-w-2xl text-lg text-zinc-400">
            {BRAND.description} Sign up, create an instance, connect Telegram — done.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href={BRAND.signup}
              className="inline-flex items-center gap-2 rounded-full bg-orange-600 px-8 py-3.5 font-semibold text-white shadow-lg shadow-orange-600/25 transition hover:bg-orange-500"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={BRAND.docsHome}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-8 py-3.5 font-semibold text-zinc-200 transition hover:border-orange-500/40"
            >
              Read the docs
            </Link>
          </div>

          <p className="mt-6 text-sm text-zinc-600">
            Plan: <span className="text-zinc-400">{BRAND.plan.label}</span>
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-900 bg-zinc-950/40 py-20">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-12 text-center">
            <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-sm text-orange-400">
              <Sparkles className="h-4 w-4" />
              Product
            </span>
            <h2 className="text-3xl font-bold text-white md:text-4xl">
              Everything in the dashboard
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 transition hover:border-orange-500/40"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
                  <f.icon className="h-6 w-6 text-orange-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-900 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="mb-4 text-2xl font-bold text-white">How it works</h2>
          <ol className="space-y-4 text-left text-zinc-400">
            <li className="rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
              <strong className="text-orange-400">1.</strong> Sign up with email → open dashboard
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
              <strong className="text-orange-400">2.</strong> Create instance → sandbox boots via
              gateway
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
              <strong className="text-orange-400">3.</strong> Save API key + Telegram token →
              restart daemon
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
              <strong className="text-orange-400">4.</strong> Approve pairing codes from Telegram
              DMs
            </li>
          </ol>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href={BRAND.signup}
              className="rounded-full bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500"
            >
              Create account
            </Link>
            <Link
              href={BRAND.docsHome}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-6 py-3 font-semibold text-zinc-300 hover:border-orange-500/40"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
