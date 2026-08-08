import { cn } from '@/lib/utils';

/**
 * Skeleton — a single shimmer placeholder block. Use while data loads instead of a
 * blank screen or a spinner-only state (Owner spec: "Do not show blank white/black
 * screens while loading"). Theme-aware via the muted token.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden="true" />;
}

/** A grid of skeleton cells that stands in for a loading table. */
export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div
      className="space-y-2 p-3"
      role="status"
      aria-live="polite"
      aria-label="Loading"
      data-testid="skeleton-rows"
    >
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-6 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
