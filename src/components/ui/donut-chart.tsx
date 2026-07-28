import { CHART_COLORS } from '@/components/ui/column-chart';

/**
 * A minimal, dependency-free COLORFUL donut/pie chart (SVG).
 *
 * Draws only what it is given — the data must already be a REAL aggregation from
 * the database. Each slice's ANGLE and the shown percentage are proportions of the
 * summed weights (a ratio for the visual, exactly like a bar's width %), never a
 * money figure: the authoritative peso amount is shown as text in the legend via
 * `display`. No displayed money is ever computed as a JS float.
 *
 * Honest empty behaviour: when every value is zero it draws a single muted ring
 * and says "No data yet"; with no categories it falls back to a text note.
 * Theme-aware and accessible (aria-label + a text legend with every value).
 */
export type DonutDatum = {
  label: string;
  /** Drives the slice ANGLE only (proportion of the total). */
  value: number;
  /** Authoritative text shown in the legend (e.g. a peso string). */
  display?: string;
};

export function DonutChart({
  data,
  ariaLabel,
  emptyLabel = 'No data to chart.',
  noDataLabel = 'No data yet',
}: {
  data: DonutDatum[];
  ariaLabel: string;
  emptyLabel?: string;
  noDataLabel?: string;
}) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="donut-chart-empty">
        {emptyLabel}
      </p>
    );
  }

  const total = data.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
  const allZero = total <= 0;

  const radius = 54;
  const circ = 2 * Math.PI * radius;

  // Per-slice dash length; the offset for a slice is the sum of prior dashes
  // (computed immutably — no reassignment during render). n is tiny (a few slices).
  const dashes = data.map((d) =>
    allZero ? 0 : ((d.value > 0 ? d.value : 0) / total) * circ,
  );
  const slices = data.map((d, i) => ({
    key: d.label,
    color: CHART_COLORS[i % CHART_COLORS.length],
    dash: dashes[i] ?? 0,
    gap: circ - (dashes[i] ?? 0),
    dashOffset: -dashes.slice(0, i).reduce((s, x) => s + x, 0),
    pct: allZero ? 0 : Math.round(((d.value > 0 ? d.value : 0) / total) * 100),
  }));

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid="donut-chart"
      className="flex flex-wrap items-center gap-4"
    >
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" aria-hidden="true">
        {allZero ? (
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            className="stroke-muted"
            strokeWidth="24"
          />
        ) : (
          slices.map((s) => (
            <circle
              key={s.key}
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="24"
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={s.dashOffset}
              transform="rotate(-90 70 70)"
            />
          ))
        )}
      </svg>

      <div className="min-w-[8rem] flex-1">
        {allZero ? (
          <p
            className="mb-1.5 text-xs font-medium text-muted-foreground"
            data-testid="donut-chart-nodata"
          >
            {noDataLabel}
          </p>
        ) : null}
        <ul className="space-y-1">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {d.label}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {d.display ?? String(d.value)}
              </span>
              <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
                {allZero ? '0%' : `${slices[i]?.pct ?? 0}%`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
