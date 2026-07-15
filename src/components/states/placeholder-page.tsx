import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Placeholder screen for a navigation destination whose workflow is NOT built.
 *
 * ⚠️  A placeholder screen does not mean a business workflow is implemented
 *     (Invariant #18). This component exists to make that unmistakable on screen:
 *     every placeholder is explicitly labelled as not implemented and names the
 *     phase that will deliver it.
 *
 * It must never render operational data — no revenue, customer counts, orders,
 * claims, sales, inventory, or metrics, real or fake.
 */
export function PlaceholderPage({
  title,
  description,
  phase,
  children,
}: {
  title: string;
  description: string;
  /** The roadmap phase that will actually implement this screen. */
  phase: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              data-testid="placeholder-badge"
            >
              Placeholder — not implemented
            </span>
          </div>
          <CardTitle className="pt-1 text-base">No workflow is built here yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This screen is a navigation placeholder created in Phase 0 (application
            foundation). It contains no business logic and displays no operational data.
          </p>
          <p>
            The actual workflow is delivered in{' '}
            <span className="font-medium">{phase}</span>.
          </p>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
