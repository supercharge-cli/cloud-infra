/** Product brand — separate from XibeCode CLI marketing site. */
export const BRAND = {
  name: 'Vectra Cloud',
  shortName: 'Vectra',
  tagline: 'Managed AI coding sandboxes',
  description:
    'Spin up 4 vCPU / 8GB sandboxes with XibeCode preinstalled, configure AI + Telegram, and chat from anywhere.',
  plan: {
    id: 'hosting-4c8g',
    label: '4 vCPU · 8 GB RAM',
    cpu: 4,
    memoryMb: 8192,
  },
  github: 'https://github.com/iotserver24/cloud-infra',
  docsHome: '/docs',
  dashboard: '/dashboard',
  login: '/login',
  signup: '/signup',
} as const;
