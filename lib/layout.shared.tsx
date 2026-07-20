import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BRAND } from '@/lib/brand';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-bold">
          Vectra<span className="text-orange-500">Cloud</span>
        </span>
      ),
    },
    links: [
      {
        text: 'Dashboard',
        url: BRAND.dashboard,
      },
      {
        text: 'Sign up',
        url: BRAND.signup,
      },
    ],
  };
}
