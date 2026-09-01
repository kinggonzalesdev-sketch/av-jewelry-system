'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  Card,
  PreviewButton,
  RuleNote,
  SampleBadge,
  StatusBadge,
  inputClass,
  selectClass,
} from '@/components/preview/primitives';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  SAMPLE_ORDERS,
  SAMPLE_SHOPS,
  SAMPLE_STAFF,
  peso,
  type OrderStatus,
  type SampleOrder,
} from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 6;

/** The summary cards, in the Owner-approved order. */
const SUMMARY_CARDS: Array<{ key: 'all' | OrderStatus; label: string }> = [
  { key: 'all', label: 'Total Active' },
  { key: 'for_invoice', label: 'For Invoice' },
  { key: 'for_reminder', label: 'For Reminder' },
  { key: 'for_preparation', label: 'For Preparation' },
  { key: 'for_payment_confirmation', label: 'For Payment Confirmation' },
  { key: 'shipping_confirmed', label: 'Shipping Confirmed' },
  { key: 'keep', label: 'Keep' },
  { key: 'for_cancellation_review', label: 'For Cancellation Review' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'payment_evidence_submitted', label: 'Payment Evidence Submitted' },
];

function MoreMenu({ order }: { order: SampleOrder }) {
  const [open, setOpen] = useState(false);

  /**
   * Dynamic label by record stage (Bible §22.6, §22.9):
   *   Pending Claim   → Withdraw Claim
   *   Confirmed Claim → Controlled Withdrawal
   *   Official Order  → Request Cancellation  (never a direct Cancel)
   */
  const cancelLabel = order.invoiceNumber
    ? 'Request Cancellation'
    : 'Controlled Withdrawal';

  return (
    <div className="relative">
      <PreviewButton variant="outline" size="sm" onClick={() => setOpen((o) => !o)}>
        More ▾
      </PreviewButton>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 py-1 shadow-lg">
            {['View Details', 'Send Reminder', 'Verify Payment', 'Mark as Keep'].map(
              (label) => (
                <button
                  key={label}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-xs text-slate-700 night:text-slate-300 hover:bg-slate-50 night:hover:bg-slate-800"
                >
                  {label}
                </button>
              ),
            )}
            <div className="my-1 border-t border-slate-100 night:border-slate-800" />
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-xs font-medium text-amber-800 night:text-amber-200 hover:bg-amber-50"
            >
              {cancelLabel}
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500 night:text-slate-400">
                Owner approval required. Availability returns only via Returned-to-Stock
                Review.
              </span>
            </button>
            <div className="my-1 border-t border-slate-100 night:border-slate-800" />
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-xs text-slate-700 night:text-slate-300 hover:bg-slate-50 night:hover:bg-slate-800"
            >
              View Audit Trail
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function OrdersView() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | OrderStatus>('all');
  const [shop, setShop] = useState('all');
  const [staff, setStaff] = useState('all');
  const [arrangement, setArrangement] = useState('all');
  const [fulfillment, setFulfillment] = useState('all');
  const [orderDate, setOrderDate] = useState('');
  const [shippingDate, setShippingDate] = useState('');
  const [showKeep, setShowKeep] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_ORDERS.filter((o) => {
      if (!showKeep && o.status === 'keep') return false;
      if (status !== 'all' && o.status !== status) return false;
      if (shop !== 'all' && o.shop !== shop) return false;
      if (staff !== 'all' && o.assignedStaff !== staff) return false;
      if (arrangement !== 'all' && o.paymentArrangement !== arrangement) return false;
      if (fulfillment !== 'all' && o.fulfillmentMethod !== fulfillment) return false;
      if (orderDate && o.orderDate !== orderDate) return false;
      if (shippingDate && o.shippingDate !== shippingDate) return false;
      if (!q) return true;
      // Search spans every field the Owner asked for.
      return [
        o.invoiceNumber ?? '',
        o.claimNumber,
        o.customer,
        o.facebookName,
        o.itemCode,
        o.trackingNumber ?? '',
        String(o.amount),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [
    query,
    status,
    shop,
    staff,
    arrangement,
    fulfillment,
    orderDate,
    shippingDate,
    showKeep,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: SAMPLE_ORDERS.length };
    for (const o of SAMPLE_ORDERS) map[o.status] = (map[o.status] ?? 0) + 1;
    return map;
  }, []);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PreviewPageHeader
        title="Orders"
        description="Default landing page after sign-in."
        actions={
          <>
            <Link href="/preview/new-entry">
              <PreviewButton>+ New Entry</PreviewButton>
            </Link>
            <Link href="/preview/invoice?prepare=1">
              <PreviewButton variant="outline">
                Prepare All Eligible Invoices
              </PreviewButton>
            </Link>
            <Link href="/preview/invoice">
              <PreviewButton variant="outline">Invoice Center</PreviewButton>
            </Link>
            <PreviewButton variant="ghost" title="Prototype — re-reads sample data">
              ⟳ Refresh
            </PreviewButton>
          </>
        }
      />

      {/*
        Status summary cards — responsive grid.

        2xl (≥1536px) : all 10 in ONE row. At 10 columns each card is ~120px, which
                        still fits "Payment Evidence Submitted" over three short
                        lines without clipping — one row is allowed only where the
                        labels stay readable.
        xl  (≥1280px) : 5 per row. A laptop cannot hold 10 legibly, so it falls back
                        rather than cramping the text.
        sm  (tablet)  : 3 columns.
        mobile        : 2 columns.

        Equal height: the grid stretches items, and min-h + justify-between put the
        count on a common baseline whether the label wraps to one line or three.
        No breakpoint can force horizontal page overflow.
      */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-10">
        {SUMMARY_CARDS.map((card) => {
          const active = status === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setStatus(card.key);
                setPage(1);
              }}
              aria-pressed={active}
              className={cn(
                'flex min-h-[78px] flex-col justify-between rounded-xl border bg-white night:bg-slate-900 p-2.5 text-left transition-colors',
                active
                  ? 'border-emerald-500 ring-1 ring-emerald-500'
                  : 'border-slate-200 night:border-slate-700 hover:border-slate-300',
              )}
            >
              {/* Label wraps freely and is never truncated; hyphens let a long
                  word break cleanly instead of overflowing a narrow card. */}
              <span className="text-[11px] font-medium leading-tight text-slate-500 night:text-slate-400 [hyphens:auto]">
                {card.label}
              </span>
              {/* The count is the prominent element. */}
              <span className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-slate-900 night:text-slate-100">
                {counts[card.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + filters */}
      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-2">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search invoice no., claim no., customer, Facebook name, item code, tracking no., amount"
            className={inputClass}
            aria-label="Global search"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select
              value={shop}
              onChange={(e) => setShop(e.target.value)}
              className={selectClass}
              aria-label="Shop / page filter"
            >
              <option value="all">All shops / pages</option>
              {SAMPLE_SHOPS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              value={staff}
              onChange={(e) => setStaff(e.target.value)}
              className={selectClass}
              aria-label="Assigned staff filter"
            >
              <option value="all">All staff</option>
              {SAMPLE_STAFF.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              value={arrangement}
              onChange={(e) => setArrangement(e.target.value)}
              className={selectClass}
              aria-label="Payment arrangement filter"
            >
              <option value="all">All arrangements</option>
              <option>Full Payment</option>
              <option>Layaway</option>
              <option>Deposit</option>
            </select>
            <select
              value={fulfillment}
              onChange={(e) => setFulfillment(e.target.value)}
              className={selectClass}
              aria-label="Fulfillment method filter"
            >
              <option value="all">All fulfillment</option>
              <option>Shipping</option>
              <option>Pickup</option>
            </select>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className={inputClass}
              aria-label="Order date filter"
              title="Order date"
            />
            <input
              type="date"
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              className={inputClass}
              aria-label="Shipping date filter"
              title="Shipping date"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 night:text-slate-300">
              <input
                type="checkbox"
                checked={showKeep}
                onChange={(e) => setShowKeep(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 night:border-slate-600 text-emerald-600 focus:ring-emerald-500"
              />
              {showKeep ? 'Hide Keep' : 'Show Keep'}
            </label>
            <p className="text-xs text-slate-500 night:text-slate-400">
              {filtered.length} of {SAMPLE_ORDERS.length} sample records
            </p>
          </div>
        </div>
      </Card>

      {/* ---------------- Desktop table ---------------- */}
      <Card className="hidden overflow-hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 text-[11px] uppercase tracking-wide text-slate-500 night:text-slate-400">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Shop / Page</th>
                <th className="px-3 py-2.5 font-semibold">Invoice No.</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                <th className="px-3 py-2.5 text-right font-semibold">Amount</th>
                <th className="px-3 py-2.5 font-semibold">Payment</th>
                <th className="px-3 py-2.5 font-semibold">Fulfillment</th>
                <th className="px-3 py-2.5 font-semibold">Staff</th>
                <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 night:divide-slate-800">
              {pageRows.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 night:hover:bg-slate-800/60">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      aria-label={`Select ${o.customer}`}
                      className="h-4 w-4 rounded border-slate-300 night:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge
                      label={ORDER_STATUS_LABEL[o.status]}
                      tone={ORDER_STATUS_TONE[o.status]}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 night:text-slate-300">
                    {o.shop}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500 night:text-slate-400">
                    {o.invoiceNumber ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-slate-900 night:text-slate-100">
                      {o.customer}
                    </p>
                    <p className="text-[11px] text-slate-500 night:text-slate-400">
                      {o.facebookName}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{o.quantity}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {peso(o.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 night:text-slate-300">
                    {o.paymentState}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 night:text-slate-300">
                    {o.fulfillmentState}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 night:text-slate-300">
                    {o.assignedStaff}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <PreviewButton size="sm" variant="outline">
                        Invoice
                      </PreviewButton>
                      <PreviewButton size="sm" variant="outline">
                        Prepare Shipment
                      </PreviewButton>
                      <MoreMenu order={o} />
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-10 text-center text-sm text-slate-500 night:text-slate-400"
                  >
                    No sample records match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------------- Mobile cards ---------------- */}
      <div className="space-y-2 lg:hidden">
        {pageRows.map((o) => (
          <Card key={o.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 night:text-slate-100">
                  {o.customer}
                </p>
              </div>
              <StatusBadge
                label={ORDER_STATUS_LABEL[o.status]}
                tone={ORDER_STATUS_TONE[o.status]}
              />
            </div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <div>
                <dt className="text-slate-500 night:text-slate-400">Amount</dt>
                <dd className="font-semibold tabular-nums text-slate-900 night:text-slate-100">
                  {peso(o.amount)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 night:text-slate-400">Qty</dt>
                <dd className="tabular-nums text-slate-900 night:text-slate-100">
                  {o.quantity}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 night:text-slate-400">Payment</dt>
                <dd className="text-slate-700 night:text-slate-300">{o.paymentState}</dd>
              </div>
              <div>
                <dt className="text-slate-500 night:text-slate-400">Fulfillment</dt>
                <dd className="text-slate-700 night:text-slate-300">
                  {o.fulfillmentState}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 night:text-slate-400">Shop</dt>
                <dd className="truncate text-slate-700 night:text-slate-300">{o.shop}</dd>
              </div>
              <div>
                <dt className="text-slate-500 night:text-slate-400">Staff</dt>
                <dd className="truncate text-slate-700 night:text-slate-300">
                  {o.assignedStaff}
                </dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center gap-1.5">
              <PreviewButton size="sm" variant="outline" className="flex-1">
                Invoice
              </PreviewButton>
              <PreviewButton size="sm" variant="outline" className="flex-1">
                Prepare
              </PreviewButton>
              <MoreMenu order={o} />
            </div>
          </Card>
        ))}
        {pageRows.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500 night:text-slate-400">
            No sample records match these filters.
          </Card>
        ) : null}
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500 night:text-slate-400">
          Page {current} of {totalPages}
        </p>
        <div className="flex gap-1.5">
          <PreviewButton
            size="sm"
            variant="outline"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            ‹ Previous
          </PreviewButton>
          <PreviewButton
            size="sm"
            variant="outline"
            disabled={current >= totalPages}
            onClick={() => setPage(current + 1)}
          >
            Next ›
          </PreviewButton>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <RuleNote tone="amber">
          <strong>No direct Cancel exists for an Official Order.</strong> The row menu
          offers Request Cancellation, which creates an Owner Approval Request — it does
          not execute the cancellation. Final cancellation is an Owner approval, and stock
          returns only through Returned-to-Stock Review.
        </RuleNote>
        <RuleNote>
          Action labels change with the record stage: Pending Claim → Withdraw Claim ·
          Confirmed Claim → Controlled Withdrawal · Official Order → Request Cancellation.
          Showing a button is not authority — production re-checks the permission at
          execution time. <SampleBadge className="ml-1 align-middle" />
        </RuleNote>
      </div>
    </>
  );
}
