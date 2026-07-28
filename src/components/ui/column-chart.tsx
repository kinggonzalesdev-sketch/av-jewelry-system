/**
 * A minimal, dependency-free COLORFUL vertical bar (column) chart.
 *
 * Like {@link BarChart}, it only draws what it is given — the data must already be
 * a REAL aggregation from the database. It never fabricates points and does no
 * math beyond scaling bar HEIGHTS to the maximum and a proportion for layout.
 *
 * Each column takes a colour from a fixed categorical palette (colour encodes the
 * category, not a value). The authoritative figure is shown as text above each
 * bar via `display`; the numeric `value` only drives the bar height.
 *
 * Honest empty behaviour: with categories but every value zero, it draws the
 * labelled columns at zero and shows "No data yet"; with no categories at all it
 * falls back to a text note. Theme-aware and accessible (aria-label + text values).
 */
export type ColumnDatum = {
  label: string;
  /** Drives bar HEIGHT only (scaled to the max). Never shown when `display` is set. */
  value: number;
  /** Authoritative text to show above the bar (e.g. a peso string). */
  display?: string;
};

/** Categorical palette — colour encodes the category, readable in light and dark. */
export const CHART_COLORS = [
  '#a855f7', // purple
  '#14b8a6', // teal
  '#ec4899', // pink
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#ef4444', // red
];

export function ColumnChart({
  data,
  ariaLabel,
  valueFormat = (v) => String(v),
  emptyLabel = 'No data to chart.',
  noDataLabel = 'No data yet',
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  valueFormat?: (value: number) => string;
  emptyLabel?: string;
  noDataLabel?: string;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);

  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="column-chart-empty">
        {emptyLabel}
      </p>
    );
  }

  const allZero = max <= 0;

  return (
    <div role="img" aria-label={ariaLabel} data-testid="column-chart">
      {allZero ? (
        <p
          className="mb-1.5 text-xs font-medium text-muted-foreground"
          data-testid="column-chart-nodata"
        >
          {noDataLabel}
        </p>
      ) : null}
      <div className="flex h-44 items-end justify-around gap-2 sm:gap-3">
        {data.map((d, i) => {
          const pct = allZero ? 0 : Math.round((d.value / max) * 100);
          const color = CHART_COLORS[i % CHART_COLORS.length];
          return (
            <div
              key={d.label}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[10px] font-semibold tabular-nums">
                {d.display ?? valueFormat(d.value)}
              </span>
              <span
                className="w-full max-w-[3rem] rounded-t"
                style={{
                  height: `${pct}%`,
                  minHeight: pct > 0 ? '4px' : '0px',
                  backgroundColor: color,
                }}
              />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
