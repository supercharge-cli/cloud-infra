import type { ReactNode } from 'react';

/** Home uses its own compact monitoring chrome. */
export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
