import { getPlan } from './billing';

/** Product brand — closed-source product (not the XibeCode CLI OSS site). */
export const BRAND = {
  name: 'Vectra Cloud',
  shortName: 'Vectra',
  tagline: 'Managed AI coding sandboxes',
  description:
    'Spin up 4 vCPU / 8GB sandboxes with XibeCode preinstalled, configure AI + Telegram, and chat from anywhere.',
  /** Live plan (prices from env via getPlan()). */
  get plan() {
    const p = getPlan();
    return {
      id: p.id,
      label: p.label,
      cpu: 4,
      memoryMb: 8192,
      priceInr: p.priceInr,
      priceUsd: p.priceUsd,
      periodDays: p.periodDays,
    };
  },
  /** Private product repo — do not advertise as open source. */
  github: null as string | null,
  docsHome: '/docs',
  dashboard: '/dashboard',
  login: '/login',
  signup: '/signup',
};
