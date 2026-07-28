'use client';

import { useState } from 'react';

import { loadLayawayLedgerDetailAction } from '@/lib/payments/actions';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';
import { formatPeso } from '@/lib/payments/format';
import { Modal } from '@/components/ui/modal';

/**
 * View modal for an imported layaway account. Loads the account + its parsed
 * installment schedule + payment history on open (read-only). Money is formatted
 * as pesos in the UI while stored numeric. A clear 0% Interest badge shows when the
 * account carries zero interest.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
function peso(v: string | null): string {
  return v ? formatPeso(v) : '—';
}
function humanize(v: string | null): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export function LayawayLedgerViewModal({ ledgerId }: { ledgerId: string }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LayawayLedgerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openModal = async () => {
    setOpen(true);
    setError(null);
    setDetail(null);
    setLoading(true);
    try {
      const d = await loadLayawayLedgerDetailAction(ledgerId);
      if (!d) setError('That account could not be loaded.');
      else setDetail(d);
    } catch {
      setError('That account could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const isZero = detail?.interestType === 'zero';
  // Overdue = active account past its Next Due Date that still owes a balance.
  const overdue = ((): string => {
    if (!detail || detail.status !== 'active' || !detail.nextDueDate) return '—';
    const owes = Number((detail.balance ?? '0').replace(/[^\d.-]/g, '')) > 0;
    return detail.nextDueDate < new Date().toISOString().slice(0, 10) && owes ? 'Yes' : 'No';
  })();

  return (
    <>
      <button
        type="button"
        onClick={() => void openModal()}
        data-testid={`ledger-view-${ledgerId}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        View
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Layaway account"
        description="Imported account summary, installment schedule, and payment history."
        size="lg"
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : detail ? (
          <div className="space-y-4" data-testid="ledger-view-body">
            {/* Account summary */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Account Summary
                </p>
                {isZero ? (
                  <span className="rounded-full border border-green-600/40 bg-green-600/10 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    0% Interest
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
                <Row label="Code">
                  <span className="font-mono">{detail.code ?? '—'}</span>
                </Row>
                <Row label="Customer Name">{detail.customerName}</Row>
                <Row label="Status">{humanize(detail.status)}</Row>
                <Row label="Remarks / Financer">{detail.remarks ?? '—'}</Row>
                <Row label="Date Purchased">{fmtDate(detail.datePurchased)}</Row>
                <Row label="Overdue">
                  {overdue === 'Yes' ? (
                    <span className="text-destructive">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">{overdue}</span>
                  )}
                </Row>
                <Row label="Item">{peso(detail.itemAmount)}</Row>
                <Row label="Interest Type">
                  {isZero ? '0% Interest' : humanize(detail.interestType)}
                </Row>
                <Row label="Layaway Term">
                  {detail.layawayTerm ? `${detail.layawayTerm} month(s)` : '—'}
                </Row>
                <Row label="Interest Rate / Fixed">
                  {detail.interestRate
                    ? `${detail.interestRate}%`
                    : detail.fixedInterest
                      ? peso(detail.fixedInterest)
                      : '—'}
                </Row>
                <Row label="Total Interest">{isZero ? '₱0' : peso(detail.interest)}</Row>
                <Row label="Grand Total">{peso(detail.grandTotal)}</Row>
                <Row label="Payment">{peso(detail.payment)}</Row>
                <Row label="Balance">
                  {peso(detail.balance)}
                  {detail.balanceMismatch ? (
                    <span className="ml-1 text-amber-600" title="Balance ≠ Grand Total − Payment">
                      ⚠
                    </span>
                  ) : null}
                </Row>
                <Row label="Next Due Date">{fmtDate(detail.nextDueDate)}</Row>
                <Row label="Monthly Interest">{isZero ? '₱0' : peso(detail.monthlyInterest)}</Row>
                <Row label="Total Installment Interest">
                  {isZero ? '₱0' : peso(detail.totalInstallmentInterest)}
                </Row>
                <Row label="Last Payment Date">{fmtDate(detail.lastPaymentDate)}</Row>
                <Row label="Latest Mode of Payment">{detail.modeOfPayment ?? '—'}</Row>
                <Row label="Latest Payment / DP">{peso(detail.latestPaymentDp)}</Row>
                <Row label="Notes">{detail.notes ?? '—'}</Row>
                <Row label="Order / Account No.">
                  <span className="font-mono">{detail.accountNo}</span>
                </Row>
              </div>
            </div>

            {/* Payment history */}
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Payment History
              </p>
              {detail.payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No payment records parsed.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5">#</th>
                        <th className="px-3 py-1.5">Payment Date</th>
                        <th className="px-3 py-1.5 text-right">Amount</th>
                        <th className="px-3 py-1.5">Mode of Payment</th>
                        <th className="px-3 py-1.5">Received By</th>
                        <th className="px-3 py-1.5">Reference / Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {detail.payments.map((p) => (
                        <tr key={p.sequence}>
                          <td className="px-3 py-1.5 tabular-nums">{p.sequence}</td>
                          <td className="px-3 py-1.5">{fmtDate(p.paymentDate)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{peso(p.amount)}</td>
                          <td className="px-3 py-1.5">{p.mop ?? '—'}</td>
                          <td className="px-3 py-1.5">{p.receivedBy ?? '—'}</td>
                          <td className="px-3 py-1.5">{p.reference ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
