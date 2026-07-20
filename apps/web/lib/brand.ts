/**
 * Client-safe brand constants only.
 * Live checkout prices come from getPlan() /api/billing/config (server env).
 * Do NOT call getPlan() here — server BILLING_* env vs client defaults
 * causes React hydration error #418 (text mismatch).
 */
export const BRAND = {
  name: 'Vectra Cloud',
  shortName: 'Vectra',
  tagline: 'Managed AI coding sandboxes',
  description:
    'Spin up 4 vCPU / 8GB sandboxes with XibeCode preinstalled, configure AI + Telegram, and chat from anywhere.',
  plan: {
    id: 'hosting-4c8g',
    /** Marketing label — no prices (prices are env-driven and loaded via API). */
    label: '4 vCPU · 8 GB',
    cpu: 4,
    memoryMb: 8192,
  },
  /** Private product repo — do not advertise as open source. */
  github: null as string | null,
  docsHome: '/docs',
  dashboard: '/dashboard',
  login: '/login',
  signup: '/signup',
  terms: '/terms',
  privacy: '/privacy',
  refund: '/refund',
} as const;
