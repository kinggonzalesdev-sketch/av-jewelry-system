import type { ReactNode } from 'react';

/**
 * Generic empty state — "there is legitimately nothing to show".
 *
 * Distinct from a loading state (data not yet arrived) and from an error state
 * (retrieval failed). Conflating them is how a failed read gets misreported as
 * "no records", which would be a false success (Bible §32).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center"
      data-testid="empty-state"
    >
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
