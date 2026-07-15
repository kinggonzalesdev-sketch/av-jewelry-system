'use client';

import { useMemo, useState } from 'react';

import {
  BarChart,
  DonutChart,
  GroupedBarChart,
  LineChart,
} from '@/components/preview/charts';
import {
  GP_MONTHS,
  GROSS_PROFIT_NOTE,
  ORDER_STATUS_COLORS,
  RANGE_LABEL,
  formatISO,
  grossProfitFor,
  grossProfitSeries,
  kpis,
  monthLabel,
  orderStatusBreakdown,
  paymentBreakdown,
  rangeBounds,
  salesSeries,
  type CostingMode,
  type RangeKey,
} from '@/components/preview/dashboard-data';
import {
  Card,
  Field,
  PermissionBadge,
  PreviewButton,
  RuleNote,
  SampleBadge,
  SectionTitle,
  StatusBadge,
  inputClass,
  selectClass,
} from '@/components/preview/primitives';
import { peso } from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';
import { cn } from '@/lib/utils';

/**
 * DASHBOARD REPORT — the summary overview, separate from Orders and from Reports.
 *
 * Two internal tabs only: Dashboard and Gross Profit.
 * There is deliberately NO Disassembly Report tab, card, or chart anywhere.
 */

const RANGES: RangeKey[] = ['today', '7d', '14d', '30d', 'month', 'custom'];

function KpiCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'green' | 'amber';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-3',
        tone === 'green' && 'border-emerald-200',
        tone === 'amber' && 'border-amber-200',
        tone === 'default' && 'border-slate-200',
      )}
    >
      <p className="text-[11px] font-medium leading-tight text-slate-500">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-bold tabular-nums',
          tone === 'green'
            ? 'text-emerald-700'
            : tone === 'amber'
              ? 'text-amber-700'
              : 'text-slate-900',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <p className="text-[10px] leading-tight text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function DateFilters({
  range,
  setRange,
  from,
  setFrom,
  to,
  setTo,
}: {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
}) {
  const bounds = rangeBounds(range, from, to);

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              range === r
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <PreviewButton
            size="sm"
            variant="ghost"
            title="Prototype — re-reads sample data"
          >
            ⟳ Refresh
          </PreviewButton>
          <PreviewButton size="sm" variant="outline">
            ⭳ Export Report
          </PreviewButton>
        </div>
      </div>

      {range === 'custom' ? (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:max-w-md">
          <Field label="Start date">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
        <StatusBadge label={`Active: ${RANGE_LABEL[range]}`} tone="green" />
        <span className="text-[11px] text-slate-600">
          Showing <strong className="text-slate-900">{bounds.start}</strong> to{' '}
          <strong className="text-slate-900">{bounds.end}</strong>
        </span>
        <SampleBadge className="ml-auto" />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">
        Export Report is a visual prototype action — no file is produced and no export is
        implemented.
      </p>
    </Card>
  );
}

function DashboardTab({
  range,
  from,
  to,
}: {
  range: RangeKey;
  from: string;
  to: string;
}) {
  const k = useMemo(() => kpis(range, from, to), [range, from, to]);
  const sales = useMemo(() => salesSeries(range, from, to), [range, from, to]);
  const status = useMemo(() => orderStatusBreakdown(range, from, to), [range, from, to]);
  const payments = useMemo(() => paymentBreakdown(range, from, to), [range, from, to]);

  return (
    <div className="space-y-4">
      {/* Primary KPI row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Sales" value={peso(k.totalSales)} tone="green" />
        <KpiCard label="Checked Out" value={String(k.checkedOut)} />
        <KpiCard label="Items Sold" value={String(k.itemsSold)} />
        <KpiCard label="Shipments Today" value={String(k.shipmentsToday)} />
        <KpiCard
          label="Verified Payment"
          value={String(k.verifiedPayment)}
          tone="green"
        />
        <KpiCard
          label="Unverified Payment"
          value={String(k.unverifiedPayment)}
          tone="amber"
        />
      </div>

      {/* Secondary operational counts */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Operational summary
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <MiniCount label="For Invoice" value={k.forInvoice} />
          <MiniCount
            label="Pending Payment Verification"
            value={k.pendingPaymentVerification}
          />
          <MiniCount label="Active Layaway" value={k.activeLayaway} />
          <MiniCount label="For Preparation" value={k.forPreparation} />
          <MiniCount label="Shipping Confirmed" value={k.shippingConfirmed} />
          <MiniCount label="Cancelled Orders" value={k.cancelledOrders} />
        </div>
      </div>

      {/* Charts */}
      <Card className="p-4">
        <SectionTitle
          title="Sales for the Period"
          description={`Dates on the horizontal axis, sales on the vertical. ${sales.length} day(s) in range.`}
          right={<SampleBadge />}
        />
        <div className="mt-3">
          <LineChart data={sales} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle title="Order Status" right={<SampleBadge />} />
          <div className="mt-3">
            <BarChart data={status} colors={ORDER_STATUS_COLORS} />
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle
            title="Payment Verification Breakdown"
            description="Verified is not Paid in Full."
            right={<SampleBadge />}
          />
          <div className="mt-3">
            <DonutChart data={payments} />
          </div>
        </Card>
      </div>

      <RuleNote tone="amber">
        <strong>Every figure and chart on this page is sample data.</strong> Nothing is
        read from the database, and no value here is an operational measurement. Real
        counts arrive with the phases that create the records they read.
      </RuleNote>
    </div>
  );
}

function GrossProfitTab() {
  const [month, setMonth] = useState<string>('2026-07');
  const [mode, setMode] = useState<CostingMode>('System');

  const gp = useMemo(() => grossProfitFor(month, mode), [month, mode]);
  const trend = useMemo(() => grossProfitSeries(mode), [mode]);

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Month">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={selectClass}
            >
              {GP_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="COGS Costing Mode" hint="Changes the sample cost ratio only.">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as CostingMode)}
              className={selectClass}
            >
              <option>System</option>
              <option>Manual</option>
            </select>
          </Field>
          <Field label="As Of">
            <input
              type="date"
              defaultValue={formatISO(new Date('2026-07-15'))}
              className={inputClass}
            />
          </Field>
          <Field label="Company / Shop">
            <select className={selectClass}>
              <option>A.V. Jewelry (all shops)</option>
              <option>A.V. Jewelry Main</option>
              <option>A.V. Jewelry Live 2</option>
            </select>
          </Field>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
          <StatusBadge label={`Period: ${monthLabel(month)}`} tone="green" />
          <StatusBadge label={`Costing: ${mode}`} tone="slate" />
          <SampleBadge />
          <PreviewButton size="sm" variant="outline" className="ml-auto">
            ⭳ Export Report
          </PreviewButton>
        </div>
      </Card>

      {/* Figures */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <KpiCard label="Total Items Sold" value={String(gp.itemsSold)} />
        <KpiCard label="Average Selling Price" value={peso(gp.avgSellingPrice)} />
        <KpiCard label="Total Sales" value={peso(gp.totalSales)} tone="green" />
        <KpiCard label="COGS" value={peso(gp.cogs)} tone="amber" />
        <KpiCard label="Gross Profit" value={peso(gp.grossProfit)} tone="green" />
        <KpiCard
          label="Gross Profit Rate"
          value={`${gp.grossProfitRate.toFixed(1)}%`}
          tone="green"
        />
      </div>

      <RuleNote tone="amber">
        <strong>{GROSS_PROFIT_NOTE}</strong>
      </RuleNote>

      <Card className="p-4">
        <SectionTitle
          title="Sales vs COGS vs Gross Profit"
          description="Month periods on the horizontal axis."
          right={<SampleBadge />}
        />
        <div className="mt-3">
          <GroupedBarChart periods={trend.periods} series={trend.series} />
        </div>
      </Card>

      <RuleNote>
        Gross Profit here is arithmetic on invented numbers, shown to review the SHAPE of
        the screen. It is not accounting logic: the real COGS rules are not defined yet,
        so no production formula is implied. Switching System/Manual only changes a sample
        cost ratio.
      </RuleNote>
    </div>
  );
}

export function DashboardReportView() {
  const [tab, setTab] = useState<'dashboard' | 'gross_profit'>('dashboard');
  const [range, setRange] = useState<RangeKey>('7d');
  const [from, setFrom] = useState('2026-07-01');
  const [to, setTo] = useState('2026-07-15');

  return (
    <>
      <PreviewPageHeader
        title="Dashboard Report"
        description="Summary overview. Detailed exports live under Reports."
        actions={<PermissionBadge permission="export_data_reports" />}
      />

      {/* Internal tabs — Dashboard and Gross Profit ONLY. */}
      <div
        className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1"
        role="tablist"
        aria-label="Dashboard Report tabs"
      >
        {(
          [
            ['dashboard', 'Dashboard'],
            ['gross_profit', 'Gross Profit'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' ? (
        <div className="space-y-4">
          <DateFilters
            range={range}
            setRange={setRange}
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
          />
          <DashboardTab range={range} from={from} to={to} />
        </div>
      ) : (
        <GrossProfitTab />
      )}
    </>
  );
}
