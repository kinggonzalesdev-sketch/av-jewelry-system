import type { Metadata } from 'next';

import { EmptyState } from '@/components/states/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Dashboard — A.V. Jewelry Operations',
};

/**
 * Dashboard placeholder (Bible §8.3).
 *
 * The real Dashboard is an operational command center: work queues, compact summary
 * counts, alerts, and quick actions, all filtered by permission. It is delivered in
 * Roadmap Phase 9, and it reads records created by Phases 1–8.
 *
 * ⚠️  This page renders NO operational data — no revenue, customer counts, orders,
 *     claims, sales, inventory, or metrics. There is no data model yet, so any number
 *     shown here would be fabricated. A fake count is worse than an empty state: it
 *     invites an operational decision based on a number that means nothing.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-[--color-muted-foreground]">
          Operational command center. Not built yet.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div>
            <span
              className="inline-flex items-center rounded-md border border-[--color-border] bg-[--color-muted] px-2 py-1 text-xs font-medium uppercase tracking-wide text-[--color-muted-foreground]"
              data-testid="placeholder-badge"
            >
              Placeholder — not implemented
            </span>
          </div>
          <CardTitle className="pt-1 text-base">Phase 0 foundation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[--color-muted-foreground]">
            You are signed in and inside the protected application shell. This confirms
            the authentication boundary works — nothing more. No business workflow, data
            model, or permission system exists yet.
          </p>

          <EmptyState
            title="No operational data"
            description="Work queues, summary counts, alerts, and quick actions arrive in Phase 9, once the records they read are built in Phases 1–8. No figures are shown here because none exist yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
