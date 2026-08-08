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

export type BadgeTone =
  | 'gold'
  | 'neutral'
  | 'strong'
  | 'warning'
  | 'danger'
  | 'success'
  | 'info';

/**
 * ONE colour per meaning across the whole system (Owner spec), via the `.badge-*`
 * classes in globals.css (light + dark). Gold stays the BRAND accent only. Statuses
 * map: success→green, warning→amber, info→blue, danger→red, neutral→gray.
 */
const TONE: Record<BadgeTone, string> = {
  // Gold — active / selected (the brand accent, NOT a status).
  gold: 'bg-gold/15 text-gold-strong border-gold/30',
  // Gray — neutral / no-data / archived / informational-neutral.
  neutral: 'badge-gray',
  // Strong — charcoal, for emphatic non-accent states.
  strong: 'bg-foreground/10 text-foreground border-foreground/15',
  // Amber — pending / waiting / needs attention.
  warning: 'badge-amber',
  // Red — error / danger / cancel / overdue.
  danger: 'badge-red',
  // Green — success / finished / available / paid.
  success: 'badge-green',
  // Blue — active process / information (delivery, processing, live).
  info: 'badge-blue',
};

/** Default leading glyph per tone (colour + text + ICON — never a bare dot). */
const TONE_ICON: Record<BadgeTone, string> = {
  gold: '●',
  neutral: '●',
  strong: '●',
  warning: '●',
  danger: '✕',
  success: '✓',
  info: '●',
};

/** A status pill: colour + a leading icon + a readable label. */
export function StatusBadge({
  label,
  tone = 'neutral',
  icon,
  className,
}: {
  label: string;
  tone?: BadgeTone;
  /** Override the default leading glyph (e.g. '!' for Overdue). */
  icon?: string;
  className?: string;
}) {
  const glyph = icon ?? TONE_ICON[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="text-[9px] leading-none opacity-80">
        {glyph}
      </span>
      <span>{label}</span>
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
