import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared A.V. Jewelry brand primitives for the production pages.
 *
 * These carry the approved prototype's visual hierarchy — a consistent page
 * header, metric cards, status badges, and an explicit read-error state — in the
 * beige/black/gold token system. Every colour is a design token, so light and
 * dark are handled in one place and no page hardcodes a palette.
 *
 * They render layout only. No data, no fixtures, no business logic.
 */

/** Consistent page header: title · optional description · optional actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * A metric tile: small muted label, large value, optional hint.
 *
 * `accent` draws a thin gold top rule to mark a highlighted figure — the brand's
 * restrained way to draw the eye, never a glow or gradient.
 */
export function MetricCard({
  label,
  value,
  hint,
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4',
        accent && 'border-t-2 border-t-gold',
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export type BadgeTone = 'gold' | 'neutral' | 'strong' | 'warning' | 'danger' | 'success';

const TONE: Record<BadgeTone, string> = {
  // Gold — active / selected / positive-in-progress (the brand accent).
  gold: 'bg-gold/15 text-gold-strong border-gold/30',
  // Neutral warm — pending / informational.
  neutral: 'bg-secondary text-muted-foreground border-border',
  // Strong — charcoal, for emphatic non-accent states.
  strong: 'bg-foreground/10 text-foreground border-foreground/15',
  // Warm amber — caution (amber sits inside the warm brand family).
  warning: 'bg-amber-100 text-amber-900 border-amber-200',
  // Restrained red — a problem the operator must see.
  danger: 'bg-destructive/10 text-destructive border-destructive/25',
  // Green — a settled, fully-done positive (Paid in Full). Owner request.
  success: 'bg-green-600/10 text-green-700 border-green-600/30',
};

/** A brand status pill. Tone conveys meaning. */
export function StatusBadge({
  label,
  tone = 'neutral',
  className,
}: {
  label: string;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Explicit read-error state — a FAILED read, distinct from an empty result.
 *
 * The whole session's hard-won lesson: a failed read must never render as an
 * empty state or a financial zero. This makes the failure loud and says so.
 */
export function ReadError({
  title = 'This could not be loaded',
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="read-error"
      className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-semibold text-destructive">{title}</p>
      <p className="mt-1 text-muted-foreground">
        This is <strong>not</strong> an empty result — data may exist and is not shown.
        Reload; if it persists, report it.
      </p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}
