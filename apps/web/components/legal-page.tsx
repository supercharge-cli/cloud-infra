import Link from 'next/link';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { BRAND } from '@/lib/brand';
import { isLegalPlaceholder, LEGAL } from '@/lib/legal';

const LEGAL_NAV = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund', label: 'Refund & Cancellation' },
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

/** Renders a legal detail; unfilled placeholders are highlighted so they cannot ship unnoticed. */
export function LegalValue({ value }: { value: string }) {
  if (!isLegalPlaceholder(value)) return <>{value}</>;
  return (
    <mark className="rounded bg-amber-400/20 px-1 font-mono text-[13px] text-amber-200" title="Placeholder: fill in before launch">
      {value}
    </mark>
  );
}

function MailOrValue({ value }: { value: string }) {
  if (isLegalPlaceholder(value)) return <LegalValue value={value} />;
  return (
    <a href={`mailto:${value}`} className="text-orange-400 hover:underline">
      {value}
    </a>
  );
}

/** Contact and grievance officer block (Consumer Protection (E-Commerce) Rules, 2020; IT Rules, 2021). */
export function GrievanceSection({ number }: { number: number }) {
  return (
    <LegalSection title={`${number}. Contact and grievance officer`}>
      <p>
        The Service is operated by <LegalValue value={LEGAL.entityName} />, <LegalValue value={LEGAL.registeredAddress} />,
        India. Support: <MailOrValue value={LEGAL.supportEmail} />.
      </p>
      <p>
        Grievance officer: <LegalValue value={LEGAL.grievanceOfficerName} />, email{' '}
        <MailOrValue value={LEGAL.grievanceEmail} />, at the address above. We acknowledge complaints
        within 48 hours and aim to resolve them within one month of receipt, as required by the
        Consumer Protection (E-Commerce) Rules, 2020.
      </p>
    </LegalSection>
  );
}
