import type { ReactNode } from 'react';

/**
 * Honest "not available yet" state for an approved navigation item whose
 * production page has not been built.
 *
 * The approved sidebar keeps the item in its place (Owner-approved), and opening
 * it lands HERE — a plain, truthful placeholder. It deliberately shows NO sample
 * records, NO fake charts, NO fabricated totals, and never a 404. It is not the
 * prototype's "coming soon" mock; it is an honest empty surface.
 */
export function UnavailablePage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div data-testid="unavailable-page">
      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
      </header>
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">Not available yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          {title} has an approved place in the navigation, but its production screen has
          not been built. It shows no data rather than sample or placeholder content.
        </p>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
