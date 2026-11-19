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
    'Spin up a Supercharge sandbox from 2 vCPU / 4 GB. The first workspace is the free base size.',
  plan: {
    id: 'hosting-2c4g',
    /** Marketing label — no prices (prices are env-driven and loaded via API). */
    label: '2 vCPU · 4 GB',
    cpu: 2,
    memoryMb: 4096,
  },
  /** Private product repo — do not advertise as open source. */
  github: null as string | null,
  docsHome: '/docs',
  dashboard: '/dashboard',
  admin: '/admin',
  login: '/login',
  signup: '/signup',
  terms: '/terms',
  privacy: '/privacy',
  refund: '/refund',
} as const;
