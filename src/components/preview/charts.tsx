'use client';

import { useState } from 'react';

import { peso } from '@/components/preview/sample-data';

/**
 * PROTOTYPE CHARTS — hand-rolled SVG.
 *
 * Deliberately no chart library: adding one would put a production dependency in
 * package.json for a review prototype, and the approved stack is pinned. These are
 * small enough to own.
 *
 * All series are SAMPLE DATA. Every chart carries a visible sample-data note in
 * its container (see the callers).
 */

const AXIS = '#cbd5e1'; // slate-300
const GRID = '#f1f5f9'; // slate-100
const LABEL = '#64748b'; // slate-500

export type Point = { label: string; value: number };

function niceMax(max: number): number {
  if (max <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / mag) * mag;
}

/**
 * Line + area chart with hover tooltips. Used for Sales for the Period.
 * X axis shows dates; Y axis shows values.
 */
export function LineChart({
  data,
  height = 220,
  formatValue = (v: number) => peso(v),
}: {
  data: Point[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const line = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`)
    .join(' ');
  const area = `${line} L${x(data.length - 1)},${padT + innerH} L${padL},${padT + innerH} Z`;

  // Keep the x-axis readable: show at most ~7 labels.
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Sales for the period, sample data. ${data.length} points.`}
      >
        {/* Y grid + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const vy = padT + innerH - t * innerH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={vy}
                x2={W - padR}
                y2={vy}
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={padL - 8} y={vy + 4} textAnchor="end" fontSize={11} fill={LABEL}>
                {formatValue(Math.round(max * t))}
              </text>
            </g>
          );
        })}

        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#059669" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#059669" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#areaFill)" />
        <path
          d={line}
          fill="none"
          stroke="#059669"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Points + hover targets */}
        {data.map((d, i) => (
          <g key={d.label}>
            <circle
              cx={x(i)}
              cy={y(d.value)}
              r={hover === i ? 4.5 : 2.5}
              fill="#059669"
              stroke="#fff"
              strokeWidth={1.5}
            />
            <rect
              x={x(i) - stepX / 2}
              y={padT}
              width={Math.max(stepX, 8)}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${d.label}: ${formatValue(d.value)} (sample)`}</title>
            </rect>
          </g>
        ))}

        {/* X axis */}
        <line
          x1={padL}
          y1={padT + innerH}
          x2={W - padR}
          y2={padT + innerH}
          stroke={AXIS}
          strokeWidth={1}
        />
        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text
              key={`l-${d.label}`}
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize={10}
              fill={LABEL}
            >
              {d.label}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null && data[hover] ? (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] shadow-sm">
          <span className="font-medium text-slate-900">{data[hover].label}</span>
          <span className="ml-2 tabular-nums text-emerald-700">
            {formatValue(data[hover].value)}
          </span>
          <span className="ml-1 text-slate-400">sample</span>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal bar chart. Used for Order Status. */
export function BarChart({
  data,
  colors,
}: {
  data: Point[];
  colors?: Record<string, string>;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <ul className="space-y-2" role="img" aria-label="Order status breakdown, sample data">
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-2.5">
          <span className="w-28 shrink-0 truncate text-[11px] text-slate-600">
            {d.label}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${Math.max((d.value / max) * 100, 2)}%`,
                backgroundColor: colors?.[d.label] ?? '#059669',
              }}
              title={`${d.label}: ${d.value} (sample)`}
            />
          </div>
          <span className="w-7 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-900">
            {d.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Grouped bars. Used for Sales vs COGS vs Gross Profit. */
export function GroupedBarChart({
  periods,
  series,
  height = 240,
}: {
  periods: string[];
  series: Array<{ name: string; color: string; values: number[] }>;
  height?: number;
}) {
  const [hover, setHover] = useState<{ p: number; s: number } | null>(null);

  const W = 720;
  const H = height;
  const padL = 60;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 1));
  const groupW = innerW / periods.length;
  const barW = Math.min(18, (groupW - 8) / series.length);

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Sales versus COGS versus Gross Profit, sample data"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const vy = padT + innerH - t * innerH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={vy}
                x2={W - padR}
                y2={vy}
                stroke={GRID}
                strokeWidth={1}
              />
              <text x={padL - 8} y={vy + 4} textAnchor="end" fontSize={11} fill={LABEL}>
                {peso(Math.round(max * t))}
              </text>
            </g>
          );
        })}

        {periods.map((p, pi) => {
          const groupX = padL + pi * groupW;
          const totalBarsW = barW * series.length;
          const startX = groupX + (groupW - totalBarsW) / 2;
          return (
            <g key={p}>
              {series.map((s, si) => {
                const v = s.values[pi] ?? 0;
                const h = (v / max) * innerH;
                const bx = startX + si * barW;
                const by = padT + innerH - h;
                const isHover = hover?.p === pi && hover?.s === si;
                return (
                  <rect
                    key={s.name}
                    x={bx}
                    y={by}
                    width={Math.max(barW - 2, 2)}
                    height={Math.max(h, 1)}
                    rx={2}
                    fill={s.color}
                    opacity={isHover ? 1 : 0.88}
                    onMouseEnter={() => setHover({ p: pi, s: si })}
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${p} · ${s.name}: ${peso(v)} (sample)`}</title>
                  </rect>
                );
              })}
              <text
                x={groupX + groupW / 2}
                y={H - 12}
                textAnchor="middle"
                fontSize={10}
                fill={LABEL}
              >
                {p}
              </text>
            </g>
          );
        })}

        <line
          x1={padL}
          y1={padT + innerH}
          x2={W - padR}
          y2={padT + innerH}
          stroke={AXIS}
          strokeWidth={1}
        />
      </svg>

      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {series.map((s) => (
          <span
            key={s.name}
            className="flex items-center gap-1.5 text-[11px] text-slate-600"
          >
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Simple donut. Used for the Payment Verification breakdown. */
export function DonutChart({ data }: { data: Array<Point & { color: string }> }) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const R = 52;
  const C = 2 * Math.PI * R;

  // Precompute each arc's dash length and starting offset.
  //
  // The obvious version mutates a running `offset` inside .map() during render,
  // which the React Compiler rejects (react-hooks/immutability) — and rightly so:
  // a render that mutates as it goes is not safely re-runnable. Deriving the
  // segments up front is both correct and clearer.
  const segments = data.reduce<
    Array<{ label: string; color: string; value: number; dash: number; offset: number }>
  >((acc, d) => {
    const dash = (d.value / total) * C;
    const offset =
      acc.length === 0 ? 0 : acc[acc.length - 1]!.offset + acc[acc.length - 1]!.dash;
    acc.push({ label: d.label, color: d.color, value: d.value, dash, offset });
    return acc;
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-5">
      <svg
        viewBox="0 0 140 140"
        className="h-32 w-32"
        role="img"
        aria-label="Payment verification breakdown, sample data"
      >
        <g transform="translate(70,70) rotate(-90)">
          {segments.map((s) => (
            <circle
              key={s.label}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={16}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={-s.offset}
            >
              <title>{`${s.label}: ${s.value} (sample)`}</title>
            </circle>
          ))}
        </g>
        <text
          x="70"
          y="68"
          textAnchor="middle"
          fontSize={20}
          fontWeight={700}
          fill="#0f172a"
        >
          {total}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize={9} fill={LABEL}>
          payments
        </text>
      </svg>
      <ul className="space-y-1.5">
        {data.map((d) => (
          <li
            key={d.label}
            className="flex items-center gap-2 text-[11px] text-slate-600"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: d.color }}
              aria-hidden="true"
            />
            <span className="flex-1">{d.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
