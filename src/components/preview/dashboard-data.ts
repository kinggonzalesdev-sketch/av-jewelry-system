/**
 * SAMPLE DASHBOARD DATA — PROTOTYPE ONLY. NOT REAL.
 *
 * Deterministic pseudo-random series so the charts look plausible and stay stable
 * across renders. Nothing here is measured, computed from real records, or
 * accounting-accurate.
 */

export type RangeKey = 'today' | '7d' | '14d' | '30d' | 'month' | 'custom';

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  '7d': '7 Days',
  '14d': '14 Days',
  '30d': '30 Days',
  month: 'This Month',
  custom: 'Custom Date Range',
};

/** Fixed "today" so the prototype renders identically for every reviewer. */
export const SAMPLE_TODAY = new Date('2026-07-15T00:00:00Z');

function seeded(n: number): number {
  // Deterministic 0..1 — a stable stand-in for randomness.
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function formatDay(d: Date): string {
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export function formatISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function rangeDays(
  range: RangeKey,
  customFrom?: string,
  customTo?: string,
): number {
  switch (range) {
    case 'today':
      return 1;
    case '7d':
      return 7;
    case '14d':
      return 14;
    case '30d':
      return 30;
    case 'month':
      return SAMPLE_TODAY.getUTCDate();
    case 'custom': {
      if (!customFrom || !customTo) return 7;
      const from = new Date(customFrom);
      const to = new Date(customTo);
      const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      return Number.isFinite(diff) && diff > 0 ? Math.min(diff, 90) : 7;
    }
  }
}

export function rangeBounds(
  range: RangeKey,
  customFrom?: string,
  customTo?: string,
): { start: string; end: string } {
  if (range === 'custom' && customFrom && customTo) {
    return { start: customFrom, end: customTo };
  }
  const days = rangeDays(range);
  const end = SAMPLE_TODAY;
  const start = addDays(end, -(days - 1));
  return { start: formatISO(start), end: formatISO(end) };
}

/** Sales series for the selected range. Values grow mildly so charts read well. */
export function salesSeries(
  range: RangeKey,
  customFrom?: string,
  customTo?: string,
): Array<{ label: string; value: number }> {
  const days = rangeDays(range, customFrom, customTo);
  const end = range === 'custom' && customTo ? new Date(customTo) : SAMPLE_TODAY;

  return Array.from({ length: days }, (_, i) => {
    const day = addDays(end, -(days - 1 - i));
    const base = 18_000 + seeded(i + days) * 26_000;
    const weekendDip = [0, 6].includes(day.getUTCDay()) ? 0.72 : 1;
    return { label: formatDay(day), value: Math.round((base * weekendDip) / 100) * 100 };
  });
}

/** Headline KPIs, scaled by range so the cards visibly respond to the filter. */
export function kpis(range: RangeKey, customFrom?: string, customTo?: string) {
  const series = salesSeries(range, customFrom, customTo);
  const totalSales = series.reduce((s, p) => s + p.value, 0);
  const days = series.length;

  return {
    totalSales,
    checkedOut: Math.round(days * 3.4),
    itemsSold: Math.round(days * 4.1),
    shipmentsToday: 5,
    verifiedPayment: Math.round(days * 2.6),
    unverifiedPayment: Math.round(days * 0.9),
    // Secondary operational counts.
    forInvoice: 5,
    pendingPaymentVerification: 3,
    activeLayaway: 4,
    forPreparation: 2,
    shippingConfirmed: 6,
    cancelledOrders: 1,
  };
}

/** Order status breakdown, scaled by range. */
export function orderStatusBreakdown(
  range: RangeKey,
  customFrom?: string,
  customTo?: string,
): Array<{ label: string; value: number }> {
  const days = rangeDays(range, customFrom, customTo);
  const f = Math.max(1, Math.round(days / 7));
  return [
    { label: 'Pending', value: 3 * f },
    { label: 'For Invoice', value: 5 * f },
    { label: 'For Preparation', value: 2 * f },
    { label: 'Shipped', value: 6 * f },
    { label: 'Cancelled', value: 1 * f },
  ];
}

export const ORDER_STATUS_COLORS: Record<string, string> = {
  Pending: '#94a3b8',
  'For Invoice': '#0284c7',
  'For Preparation': '#6366f1',
  Shipped: '#059669',
  Cancelled: '#e11d48',
};

/** Payment verification breakdown for the donut. */
export function paymentBreakdown(
  range: RangeKey,
  customFrom?: string,
  customTo?: string,
): Array<{ label: string; value: number; color: string }> {
  const k = kpis(range, customFrom, customTo);
  return [
    { label: 'Required Payment Verified', value: k.verifiedPayment, color: '#059669' },
    { label: 'Evidence Submitted', value: k.unverifiedPayment, color: '#f59e0b' },
    { label: 'Awaiting Required Payment', value: k.forInvoice, color: '#94a3b8' },
  ];
}

// ---------------------------------------------------------------------------
// Gross Profit — PREVIEW CALCULATION ONLY
// ---------------------------------------------------------------------------

export const GROSS_PROFIT_NOTE =
  'Preview calculation using sample data. Final COGS rules remain subject to business validation.';

export type CostingMode = 'System' | 'Manual';

export const GP_MONTHS = [
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
] as const;

export function monthLabel(iso: string): string {
  const [y, m] = iso.split('-');
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${names[Number(m) - 1]} ${y?.slice(2)}`;
}

/**
 * Gross-profit figures for one month.
 *
 * ⚠️  This is NOT accounting logic. It is arithmetic on invented numbers, used
 *     only to show the SHAPE of the screen. The real COGS rules are not defined
 *     yet, so no production formula is implied here.
 *
 * The Manual mode simply applies a different sample cost ratio, to demonstrate
 * that the mode changes the figures — not to model a real costing method.
 */
export function grossProfitFor(month: string, mode: CostingMode) {
  const idx = GP_MONTHS.indexOf(month as (typeof GP_MONTHS)[number]);
  const seed = idx < 0 ? 0 : idx;

  const itemsSold = 96 + Math.round(seeded(seed + 3) * 40);
  const avgSellingPrice = 9_400 + Math.round(seeded(seed + 7) * 2_600);
  const totalSales = itemsSold * avgSellingPrice;

  // Sample cost ratio — invented, not derived.
  const ratio = mode === 'System' ? 0.62 + seeded(seed + 11) * 0.05 : 0.66;
  const cogs = Math.round(totalSales * ratio);
  const grossProfit = totalSales - cogs;
  const grossProfitRate = (grossProfit / totalSales) * 100;

  return { itemsSold, avgSellingPrice, totalSales, cogs, grossProfit, grossProfitRate };
}

export function grossProfitSeries(mode: CostingMode) {
  const periods = GP_MONTHS.map(monthLabel);
  const rows = GP_MONTHS.map((m) => grossProfitFor(m, mode));

  return {
    periods,
    series: [
      { name: 'Sales', color: '#0284c7', values: rows.map((r) => r.totalSales) },
      { name: 'COGS', color: '#f59e0b', values: rows.map((r) => r.cogs) },
      { name: 'Gross Profit', color: '#059669', values: rows.map((r) => r.grossProfit) },
    ],
  };
}
