'use client';

import { useMemo, useState } from 'react';

import {
  Card,
  PermissionBadge,
  PreviewButton,
  RuleNote,
  SectionTitle,
  StatusBadge,
  inputClass,
  selectClass,
} from '@/components/preview/primitives';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  SAMPLE_ORDERS,
  computeInvoiceEligibility,
  peso,
} from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';
import { cn } from '@/lib/utils';

type BatchStep = 'idle' | 'prepared' | 'sent';

/** Simulated per-record outcome for the batch send. */
type SendResult = { orderNumber: string; customer: string; ok: boolean; message: string };

function InvoiceAllPanel({ autoOpen }: { autoOpen: boolean }) {
  const [step, setStep] = useState<BatchStep>(autoOpen ? 'prepared' : 'idle');
  const [confirmed, setConfirmed] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);

  const { eligible, excluded, groups } = useMemo(
    () => computeInvoiceEligibility(SAMPLE_ORDERS),
    [],
  );

  const runSend = () => {
    // Prototype: deterministic mixed outcome so the Owner can see BOTH success
    // and failure handling. Nothing is actually sent.
    const out: SendResult[] = groups.map((g, i) => ({
      orderNumber: g.orders.map((o) => o.orderNumber).join(', '),
      customer: g.customer,
      ok: i !== 1,
      message:
        i !== 1
          ? 'Invoice created · message prepared'
          : 'Message send failed — order was still created, retry the message only',
    }));
    setResults(out);
    setStep('sent');
  };

  return (
    <Card className="p-4">
      <SectionTitle
        title="Invoice All (two-step)"
        description="One-click convenience, represented safely. Approval is never bypassed."
        right={<PermissionBadge permission="invoice_preparation" />}
      />

      {/* Step indicator */}
      <ol className="mt-3 flex items-center gap-2 text-[11px]">
        {['1. Prepare All Eligible', '2. Approve & Send All Ready'].map((label, i) => {
          const done = (i === 0 && step !== 'idle') || (i === 1 && step === 'sent');
          const activeStep =
            (i === 0 && step === 'idle') || (i === 1 && step === 'prepared');
          return (
            <li
              key={label}
              className={cn(
                'flex-1 rounded-lg border px-2.5 py-1.5 font-medium',
                done
                  ? 'border-emerald-300 night:border-emerald-700 bg-emerald-50 night:bg-emerald-950 text-emerald-800 night:text-emerald-300'
                  : activeStep
                    ? 'border-slate-400 bg-white night:bg-slate-900 text-slate-800'
                    : 'border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 text-slate-400 night:text-slate-500',
              )}
            >
              {label}
            </li>
          );
        })}
      </ol>

      {step === 'idle' ? (
        <div className="mt-3">
          <p className="text-sm text-slate-600 night:text-slate-300">
            <strong className="text-slate-900 night:text-slate-100">
              {eligible.length}
            </strong>{' '}
            eligible record(s) will be grouped into{' '}
            <strong className="text-slate-900 night:text-slate-100">
              {groups.length}
            </strong>{' '}
            draft(s).{' '}
            <strong className="text-slate-900 night:text-slate-100">
              {excluded.length}
            </strong>{' '}
            excluded.
          </p>
          <PreviewButton className="mt-2" onClick={() => setStep('prepared')}>
            Prepare All Eligible Invoices
          </PreviewButton>
        </div>
      ) : null}

      {step !== 'idle' ? (
        <div className="mt-3 space-y-3">
          {/* Groups */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700 night:text-slate-300">
              Prepared drafts ({groups.length})
            </p>
            <div className="space-y-1.5">
              {groups.map((g) => (
                <div
                  key={`${g.customer}-${g.arrangement}-${g.fulfillment}`}
                  className="rounded-lg border border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900 night:text-slate-100">
                      {g.customer}
                    </p>
                    <div className="flex gap-1.5">
                      <StatusBadge label={g.arrangement} tone="slate" />
                      <StatusBadge label={g.fulfillment} tone="slate" />
                    </div>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-slate-500 night:text-slate-400">
                    {g.orders.map((o) => o.orderNumber).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 night:text-slate-400">
              Grouped only where customer, payment arrangement, and fulfillment
              arrangement all match. A draft never mixes buyers or arrangements.
            </p>
          </div>

          {/* Exclusions — shown with reasons, never silently dropped */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-700 night:text-slate-300">
              Excluded ({excluded.length}) — with reason
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {excluded.map((e) => (
                <div
                  key={e.order.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 night:border-amber-800 bg-amber-50 night:bg-amber-950 px-2.5 py-1.5"
                >
                  <span className="font-mono text-[10px] text-slate-700 night:text-slate-300">
                    {e.order.orderNumber}
                  </span>
                  <span className="text-[11px] text-amber-900 night:text-amber-200">
                    {e.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {step === 'prepared' ? (
            <div className="rounded-lg border border-slate-300 night:border-slate-600 bg-white night:bg-slate-900 p-3">
              <label className="flex items-start gap-2 text-xs text-slate-700 night:text-slate-300">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 night:border-slate-600 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  I have reviewed {groups.length} draft(s) covering {eligible.length}{' '}
                  record(s). This creates one Official Order per draft, each with one
                  order number and one invoice number.
                </span>
              </label>
              <PreviewButton
                className="mt-2.5 w-full"
                disabled={!confirmed}
                onClick={runSend}
              >
                Approve &amp; Send All Ready Invoices
              </PreviewButton>
            </div>
          ) : null}

          {step === 'sent' ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-700 night:text-slate-300">
                Results
              </p>
              <div className="space-y-1">
                {results.map((r) => (
                  <div
                    key={r.orderNumber}
                    className={cn(
                      'rounded-lg border px-2.5 py-2',
                      r.ok
                        ? 'border-emerald-200 night:border-emerald-800 bg-emerald-50 night:bg-emerald-950'
                        : 'border-rose-200 night:border-rose-800 bg-rose-50 night:bg-rose-950',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 night:text-slate-100">
                        {r.customer}
                      </span>
                      <StatusBadge
                        label={r.ok ? 'Success' : 'Message failed'}
                        tone={r.ok ? 'green' : 'red'}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-600 night:text-slate-300">
                      {r.message}
                    </p>
                    {!r.ok ? (
                      <PreviewButton size="sm" variant="outline" className="mt-1.5">
                        Retry Message Only
                      </PreviewButton>
                    ) : null}
                  </div>
                ))}
              </div>
              <RuleNote tone="amber">
                A failed message does <strong>not</strong> mean a failed order. The
                Official Order already exists — retrying sends the message again and{' '}
                <strong>never creates a second order</strong>.
              </RuleNote>
              <PreviewButton
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setStep('idle');
                  setConfirmed(false);
                  setResults([]);
                }}
              >
                Reset prototype flow
              </PreviewButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function InvoiceView({ autoPrepare = false }: { autoPrepare?: boolean }) {
  const queue = SAMPLE_ORDERS.filter(
    (o) => o.status === 'for_invoice' || o.invoiceNumber,
  );
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');

  const visible = queue.filter((o) => {
    if (status !== 'all' && o.status !== status) return false;
    if (!query.trim()) return true;
    return o.customer.toLowerCase().includes(query.trim().toLowerCase());
  });
  const current = visible[Math.min(index, Math.max(0, visible.length - 1))];

  return (
    <>
      <PreviewPageHeader
        title="Invoice"
        description="Invoice queue, preview, and controlled sending."
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Queue */}
        <Card className="p-3">
          <SectionTitle title="Queue" description={`${visible.length} record(s)`} />
          <div className="mt-2.5 space-y-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Customer search…"
              className={inputClass}
              aria-label="Customer search"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={selectClass}
              aria-label="Status filter"
            >
              <option value="all">All statuses</option>
              <option value="for_invoice">For Invoice</option>
              <option value="for_reminder">For Reminder</option>
              <option value="for_preparation">For Preparation</option>
            </select>
          </div>
          <ul className="mt-2 max-h-[320px] space-y-1 overflow-y-auto">
            {visible.map((o, i) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                    current?.id === o.id
                      ? 'border-emerald-500 bg-emerald-50 night:bg-emerald-950'
                      : 'border-slate-200 night:border-slate-700 hover:bg-slate-50 night:hover:bg-slate-800',
                  )}
                >
                  <p className="truncate text-xs font-semibold text-slate-900 night:text-slate-100">
                    {o.customer}
                  </p>
                  <p className="truncate font-mono text-[10px] text-slate-500 night:text-slate-400">
                    {o.orderNumber}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Preview + actions */}
        <div className="space-y-4">
          {current ? (
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <SectionTitle
                  title="Invoice Preview"
                  description={`${current.customer} · ${current.shop}`}
                />
                <div className="flex gap-1.5">
                  <PreviewButton
                    size="sm"
                    variant="outline"
                    disabled={index <= 0}
                    onClick={() => setIndex(index - 1)}
                  >
                    ‹ Previous
                  </PreviewButton>
                  <PreviewButton
                    size="sm"
                    variant="outline"
                    disabled={index >= visible.length - 1}
                    onClick={() => setIndex(index + 1)}
                  >
                    Next ›
                  </PreviewButton>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 night:border-slate-700">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="bg-slate-50 night:bg-slate-800 text-[10px] uppercase text-slate-500 night:text-slate-400">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100 night:border-slate-800">
                      <td className="px-3 py-2 font-mono">{current.itemCode}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {current.quantity}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {peso(current.amount / current.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {peso(current.amount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-3">
                {[
                  ['Order number', current.orderNumber],
                  ['Invoice number', current.invoiceNumber ?? 'Not yet issued'],
                  ['Total amount', peso(current.amount)],
                  [
                    'Required deposit',
                    current.requiredDeposit ? peso(current.requiredDeposit) : '—',
                  ],
                  [
                    'Remaining balance',
                    current.remainingBalance !== null
                      ? peso(current.remainingBalance)
                      : '—',
                  ],
                  ['Payment arrangement', current.paymentArrangement],
                  ['Fulfillment arrangement', current.fulfillmentMethod],
                  ['Hold expiry', current.holdExpiry ?? '—'],
                  ['Assigned staff', current.assignedStaff],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500 night:text-slate-400">{k}</dt>
                    <dd className="font-medium text-slate-900 night:text-slate-100">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-3">
                <StatusBadge
                  label={ORDER_STATUS_LABEL[current.status]}
                  tone={ORDER_STATUS_TONE[current.status]}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 night:border-slate-800 pt-3">
                <PreviewButton variant="outline" size="sm">
                  Review Invoice
                </PreviewButton>
                <PreviewButton size="sm">Approve &amp; Send Invoice</PreviewButton>
                <PreviewButton variant="outline" size="sm">
                  Copy Invoice Message
                </PreviewButton>
                <PreviewButton variant="outline" size="sm">
                  Mark as Sent
                </PreviewButton>
              </div>

              <div className="mt-2 space-y-1.5">
                <RuleNote tone="amber">
                  <strong>
                    Approve &amp; Send Invoice is the Official Order trigger.
                  </strong>{' '}
                  One successful send creates exactly one Official Order, one order
                  number, and one invoice number. A retry never creates a second.
                </RuleNote>
                <RuleNote>
                  <strong>Copy ≠ Sent.</strong> <strong>Mark as Sent ≠ Delivered.</strong>{' '}
                  <strong>Delivered ≠ Read.</strong> Mark as Sent is a staff attestation,
                  not proof of delivery. Delivered/Read need a verified integration and
                  remain To be confirmed — they are not shown as statuses anywhere.
                </RuleNote>
                <RuleNote>
                  <strong>Required Deposit Verified is not Paid in Full.</strong> Paid in
                  Full has no approved definition yet, so no screen claims it.
                </RuleNote>
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-sm text-slate-500 night:text-slate-400">
              No sample records match this filter.
            </Card>
          )}

          <InvoiceAllPanel autoOpen={autoPrepare} />
        </div>
      </div>
    </>
  );
}
