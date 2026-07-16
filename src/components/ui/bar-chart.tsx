/**
 * A minimal, dependency-free horizontal bar chart.
 *
 * The data must already be a REAL aggregation from the database — this component
 * only draws what it is given and does no math beyond scaling bar widths to the
 * maximum. It never fabricates points. A failed query is the CALLER's job to
 * surface as an explicit error (ReadError).
 *
 * Empty behaviour (honest, never fake): when there are CATEGORIES but every real
 * value is zero, it draws the labelled categories at zero and shows a clear
 * "No data yet" state — so the chart is visibly present without inventing data.
 * Only when there are no categories at all does it fall back to a text note.
 *
 * Theme-aware: bars use the brand gold token; the track uses muted. Accessible:
 * the container carries an aria-label, and every value is shown as text.
 */
export type BarDatum = {
  label: string;
  /** Drives bar WIDTH only (scaled to the max). Never shown as-is when `display`
   *  is set — so an authoritative money string can be shown while a numeric value
   *  scales the bar, without any frontend money math on the displayed figure. */
  value: number;
  /** Authoritative text to show instead of `valueFormat(value)` (e.g. peso). */
  display?: string;
};

export function BarChart({
  data,
  ariaLabel,
  valueFormat = (v) => String(v),
  emptyLabel = 'No data to chart.',
}: {
  data: BarDatum[];
  ariaLabel: string;
  valueFormat?: (value: number) => string;
  emptyLabel?: string;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);

  // No categories at all — nothing to lay out, so a text note is the honest state.
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="bar-chart-empty">
        {emptyLabel}
      </p>
    );
  }

  // Real zeros across every category: draw the labelled categories at zero and
  // say "No data yet" — visibly a chart, with no invented data.
  const allZero = max <= 0;

  return (
    <div role="img" aria-label={ariaLabel} data-testid="bar-chart">
      {allZero ? (
        <p
          className="mb-1.5 text-xs font-medium text-muted-foreground"
          data-testid="bar-chart-nodata"
        >
          No data yet
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {data.map((d) => {
          const pct = allZero ? 0 : Math.round((d.value / max) * 100);
          return (
            <li key={d.label} className="flex items-center gap-2 text-xs">
              <span className="w-32 shrink-0 truncate text-muted-foreground">
                {d.label}
              </span>
              <span className="h-3 flex-1 overflow-hidden rounded bg-muted">
                <span
                  className="block h-full rounded bg-gold"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right font-medium tabular-nums">
                {d.display ?? valueFormat(d.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
