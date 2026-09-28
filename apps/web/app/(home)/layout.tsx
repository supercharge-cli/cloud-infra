import type { ReactNode } from 'react';

/** Home uses its own SiteHeader — skip fumadocs HomeLayout chrome. */
export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
