import Link from 'next/link';
import Image from 'next/image';
import { BRAND } from '@/lib/brand';

export function Footer() {
  return (
    <footer className="w-full border-t border-zinc-800 bg-zinc-950 px-4 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-white">
              <Image src="/logo.png" alt="" width={36} height={36} className="h-9 w-9 rounded-lg object-cover" />
              <span>Vectra<span className="text-orange-500">Cloud</span></span>
            </h3>
            <p className="text-sm leading-relaxed text-zinc-400">{BRAND.tagline}</p>
            <p className="mt-2 text-xs text-zinc-600">Proprietary · closed source</p>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-zinc-200">Product</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href={BRAND.signup} className="text-zinc-400 hover:text-orange-400">
                  Sign up
                </Link>
              </li>
              <li>
                <Link href={BRAND.login} className="text-zinc-400 hover:text-orange-400">
                  Log in
                </Link>
              </li>
              <li>
                <Link href={BRAND.dashboard} className="text-zinc-400 hover:text-orange-400">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-zinc-200">Docs</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/docs" className="text-zinc-400 hover:text-orange-400">
                  Getting started
                </Link>
              </li>
              <li>
                <Link href="/docs/dashboard" className="text-zinc-400 hover:text-orange-400">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/docs/billing" className="text-zinc-400 hover:text-orange-400">
                  Billing
                </Link>
              </li>
              <li>
                <Link href="/docs/telegram" className="text-zinc-400 hover:text-orange-400">
                  Telegram
                </Link>
              </li>
              <li>
                <Link href="/docs/pause-resume" className="text-zinc-400 hover:text-orange-400">
                  Pause & resume
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-zinc-200">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/terms" className="text-zinc-400 hover:text-orange-400">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-zinc-400 hover:text-orange-400">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/refund" className="text-zinc-400 hover:text-orange-400">
                  Refund Policy
                </Link>
              </li>
              <li>
                <a
                  href="mailto:hello@vectra.cloud"
                  className="text-zinc-400 hover:text-orange-400"
                >
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
          </p>
          <p className="text-xs text-zinc-600">
            <Link href="/terms" className="hover:text-zinc-400">
              Terms
            </Link>
            {' · '}
            <Link href="/privacy" className="hover:text-zinc-400">
              Privacy
            </Link>
            {' · '}
            <Link href="/refund" className="hover:text-zinc-400">
              No refunds
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
