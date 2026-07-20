/** Product brand — closed-source product (not the XibeCode CLI OSS site). */
export const BRAND = {
  name: 'Vectra Cloud',
  shortName: 'Vectra',
  tagline: 'Managed AI coding sandboxes',
  description:
    'Spin up 4 vCPU / 8GB sandboxes with XibeCode preinstalled, configure AI + Telegram, and chat from anywhere.',
  plan: {
    id: 'hosting-4c8g',
    label: '4 vCPU · 8 GB · ₹399 / $4.59 mo',
    cpu: 4,
    memoryMb: 8192,
    priceInr: 399,
    priceUsd: 4.59,
  },
  /** Private product repo — do not advertise as open source. */
  github: null as string | null,
  docsHome: '/docs',
  dashboard: '/dashboard',
  login: '/login',
  signup: '/signup',
} as const;
