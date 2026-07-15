import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PreviewShell } from '@/components/preview/shell';

export const metadata: Metadata = {
  title: 'MineFlow UI Prototype — A.V. Jewelry',
  description: 'Owner UI review prototype. Sample data only.',
  robots: { index: false, follow: false },
};

/**
 * UI PROTOTYPE ROUTE GROUP — REVIEW ONLY.
 * =======================================
 *
 * This whole subtree exists so the Owner can SEE and CLICK the proposed
 * interface. It is not production code:
 *
 *  - every record is sample data (see components/preview/sample-data.ts)
 *  - it reads nothing from the database and calls no external API
 *  - it makes no authorization decision — nothing here is a security control
 *
 * ⚠️  PRODUCTION GUARD: this returns 404 when NODE_ENV is production. That is
 *     deliberate. The prototype is reachable WITHOUT signing in so the Owner can
 *     review it easily, which is only acceptable because it can never be served
 *     from a production build. If this subtree were ever wanted in production, it
 *     would need real authorization first.
 */
export default function PreviewLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <PreviewShell>{children}</PreviewShell>;
}
