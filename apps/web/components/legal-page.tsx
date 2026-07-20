import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { BRAND } from '@/lib/brand';

const LEGAL_NAV = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund', label: 'Refund Policy' },
] as const;

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        <nav className="mb-8 flex flex-wrap gap-2 text-xs">
          {LEGAL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-zinc-400 transition hover:border-orange-500/40 hover:text-orange-400"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-orange-500/90">
          Legal
        </p>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-white md:text-4xl">
          {title}
        </h1>
        <p className="mb-10 text-sm text-zinc-500">
          Last updated: {updated} · {BRAND.name}
        </p>

        <article className="legal-prose space-y-6 text-[15px] leading-relaxed text-zinc-300">
          {children}
        </article>

        <div className="mt-12 border-t border-zinc-800 pt-8 text-sm text-zinc-500">
          Questions?{' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>
        </div>
      </div>
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-3 text-zinc-300">{children}</div>
    </section>
  );
}
