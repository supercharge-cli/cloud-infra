import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export function Footer() {
  return (
    <footer className="w-full border-t border-zinc-800 bg-zinc-950 px-4 py-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <h3 className="mb-3 text-lg font-bold text-white">
              Vectra<span className="text-orange-500">Cloud</span>
            </h3>
            <p className="text-sm leading-relaxed text-zinc-400">{BRAND.tagline}</p>
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
                <Link href="/docs/telegram" className="text-zinc-400 hover:text-orange-400">
                  Telegram pairing
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-zinc-200">Open source</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href={BRAND.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-orange-400"
                >
                  cloud-infra
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/iotserver24/Xibecode"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-orange-400"
                >
                  XibeCode agent
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-zinc-800 pt-6">
          <p className="text-xs text-zinc-500">
            © {new Date().getFullYear()} {BRAND.name}. Separate product from the XibeCode CLI
            docs site.
          </p>
        </div>
      </div>
    </footer>
  );
}
