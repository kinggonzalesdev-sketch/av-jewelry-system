'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  completeLayawayLedgerAction,
  loadLayawayLedgerDetailAction,
} from '@/lib/payments/actions';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';
import { LayawayEditItems } from '@/components/payments/layaway-edit-items';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  LedgerAddPayment,
  LedgerCancelAccount,
} from '@/components/payments/layaway-ledger-actions';

/**
 * View modal for an imported layaway account. Loads the account + its parsed
 * installment schedule + payment history on open (read-only). Money is formatted
 * as pesos in the UI while stored numeric. A clear 0% Interest badge shows when the
 * account carries zero interest.
 *
 * Layout matches the Orders → View "Order Summary" style: a gold-titled card shell
 * with iconed summary rows, a secondary details card, then Payment History at the
 * bottom. "Add Payment" lives INSIDE this modal (Owner request) — not in the table
 * row — so the row keeps only View · Edit · Delete.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function peso(v: string | null): string {
  return v ? formatPeso(v) : '—';
}
function humanize(v: string | null): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Card shell matching the Orders "Order Summary" look — a gold iconed header, an
 *  optional right-hand slot (used to seat the Add Payment action). */
function SectionCard({
  icon,
  title,
  right,
  children,
  testId,
}: {
  icon?: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card/40 p-4"
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon ? (
            <span aria-hidden="true" className="text-sm text-gold-strong">
              {icon}
            </span>
          ) : null}
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gold-strong">
            {title}
          </h3>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** One labelled figure in the summary card — icon circle, muted label, strong value. */
function SummaryItem({
  icon,
  label,
  children,
}: {
  icon?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {icon ? (
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/30 text-sm text-gold-strong"
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="text-sm font-semibold break-words">{children}</div>
      </div>
    </div>
  );
}

/** A compact label/value line for the secondary details grid. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium break-words">{children}</span>
    </div>
  );
}

export function LayawayLedgerViewModal({
  ledgerId,
  allowComplete = false,
  canAddPayment = false,
  canTransfer = false,
}: {
  ledgerId: string;
  /** Show a "Transfer to Completed" action (used from the Keep account view). The
   *  database still enforces Owner/Admin and the open-status rule. */
  allowComplete?: boolean;
  /** Show "Add Payment" and "Cancel Order" inside this modal. Now passed true for
   *  EVERY active account — Owner, Admin, and Staff (Owner request: all Admin/Staff
   *  need these on a layaway account). The DB re-checks the caller is active staff
   *  and re-checks status regardless, so a shown button is never the real gate. */
  canAddPayment?: boolean;
  /** Whether this user may also transfer the account to an Orders destination from
   *  inside Add Payment. Kept manager-only (Owner/Admin) — plain Staff record a
   *  payment or cancel, but do not move accounts into the Orders flow. */
  canTransfer?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LayawayLedgerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeErr, setCompleteErr] = useState<string | null>(null);

  const canComplete =
    allowComplete &&
    detail !== null &&
    !['completed', 'cancelled', 'forfeited', 'needs_review'].includes(detail.status ?? '');

  // Add Payment shows only for a manager on a non-terminal, non-review account.
  const showAddPayment =
    canAddPayment &&
    detail !== null &&
    !['completed', 'cancelled', 'forfeited', 'needs_review'].includes(detail.status ?? '');

  const runComplete = async () => {
    if (completing) return;
    setCompleting(true);
    setCompleteErr(null);
    const res = await completeLayawayLedgerAction(ledgerId);
    setCompleting(false);
    if (!res.ok) {
      setCompleteErr(res.error);
      return;
    }
    setConfirming(false);
    setOpen(false);
    router.refresh();
  };

  // Re-fetch the account detail in place (after Edit Items) — keeps the modal open
  // and refreshes the money + item list without a full-page reload.
  const reload = async () => {
    try {
      const d = await loadLayawayLedgerDetailAction(ledgerId);
      if (d) setDetail(d);
    } catch {
      /* keep the current view */
    }
    router.refresh();
  };

  const openModal = async () => {
    setOpen(true);
    setError(null);
    setDetail(null);
    setConfirming(false);
    setCompleteErr(null);
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
        className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent"
      >
        View
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Layaway account"
        // Match the Orders-flow View popup width (max-w-[800px]).
        maxWidthClass="sm:max-w-[800px]"
        // Add Payment / Cancel Order sit in the header beside the ✕ (Orders-flow
        // style), shown only for a manager on a non-terminal account.
        headerActions={
          showAddPayment && detail ? (
            <>
              <LedgerAddPayment
                id={ledgerId}
                accountNo={detail.accountNo}
                customerName={detail.customerName}
                grandTotal={detail.grandTotal}
                paidToDate={detail.payment}
                nextDueDate={detail.nextDueDate}
                code={detail.code}
                canTransfer={canTransfer}
              />
              <LedgerCancelAccount
                id={ledgerId}
                accountNo={detail.accountNo}
                customerName={detail.customerName}
                code={detail.code}
                onDone={() => setOpen(false)}
              />
            </>
          ) : undefined
        }
        footer={
          canComplete ? (
            confirming ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={completing}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void runComplete()}
                  disabled={completing}
                  data-testid="ledger-complete-confirm"
                >
                  {completing ? 'Completing…' : 'Yes, Transfer to Completed'}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => setConfirming(true)}
                data-testid="ledger-complete"
              >
                Transfer to Completed
              </Button>
            )
          ) : undefined
        }
      >
        {completeErr ? (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {completeErr}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : detail ? (
          <div className="space-y-3" data-testid="ledger-view-body">
            {/* Account Summary — the Orders "Order Summary" card style. Add Payment
                sits in the header's right slot so it is visible the moment you View. */}
            <SectionCard
              icon="▤"
              title="Account Summary"
              testId="ledger-account-summary"
              right={
                isZero ? (
                  <span className="rounded-full border border-green-600/40 bg-green-600/10 px-2 py-0.5 text-[10px] font-medium text-green-700">
                    0% Interest
                  </span>
                ) : undefined
              }
            >
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <SummaryItem icon="☺" label="Customer Name">
                  {detail.customerName}
                </SummaryItem>
                <SummaryItem icon="#" label="Layaway Code">
                  <span className="font-mono">{detail.code ?? '—'}</span>
                </SummaryItem>
                <SummaryItem icon="⛓" label="Unique Code">
                  {detail.uniqueCode ? (
                    <span className="font-mono">{detail.uniqueCode}</span>
                  ) : (
                    <span className="text-muted-foreground">Not linked</span>
                  )}
                </SummaryItem>
                <SummaryItem icon="◈" label="Status">
                  {humanize(detail.status)}
                </SummaryItem>
                <SummaryItem icon="▦" label="Date Purchased">
                  {fmtDate(detail.datePurchased)}
                </SummaryItem>
                <SummaryItem icon="◔" label="Next Due Date">
                  {fmtDate(detail.nextDueDate)}
                </SummaryItem>
                <SummaryItem icon="!" label="Overdue">
                  {overdue === 'Yes' ? (
                    <span className="text-destructive">Yes</span>
                  ) : (
                    <span className="text-muted-foreground">{overdue}</span>
                  )}
                </SummaryItem>
                <SummaryItem icon="Σ" label="Grand Total">
                  {peso(detail.grandTotal)}
                </SummaryItem>
                <SummaryItem icon="✓" label="Payment">
                  {peso(detail.payment)}
                </SummaryItem>
                <SummaryItem icon="₱" label="Balance">
                  {peso(detail.balance)}
                  {detail.balanceMismatch ? (
                    <span className="ml-1 text-amber-600" title="Balance ≠ Grand Total − Payment">
                      ⚠
                    </span>
                  ) : null}
                </SummaryItem>
              </div>
            </SectionCard>

            {/* Per-gram interest (Grams × ₱150). Shown only for accounts on the new
                rule — every figure comes from SQL, computed from the real posted
                charges, so the modal never adds unposted future months to the total. */}
            {detail.perGram ? (
              <div
                className="rounded-xl border border-gold/30 bg-gold/5 p-4"
                data-testid="layaway-view-pergram"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold-strong">
                  Monthly interest — Grams × ₱150
                </p>
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                  <DetailRow label="Grams">
                    {detail.perGram.grams ? `${detail.perGram.grams}g` : '—'}
                  </DetailRow>
                  <DetailRow label="Monthly Interest">
                    {peso(detail.perGram.monthlyInterest)}
                  </DetailRow>
                  <DetailRow label="Interest Already Charged">
                    {peso(detail.perGram.interestCharged)}
                  </DetailRow>
                  <DetailRow label="Next Interest Date">
                    {detail.perGram.nextInterestDate
                      ? fmtDate(detail.perGram.nextInterestDate)
                      : '—'}
                  </DetailRow>
                  <DetailRow label="Remaining Possible Months">
                    {detail.perGram.remainingMonths}
                  </DetailRow>
                  <DetailRow label="Term">
                    {detail.perGram.term ? `${detail.perGram.term} month(s)` : '—'}
                  </DetailRow>
                </div>
              </div>
            ) : null}

            {/* Edit Items (Owner/Admin) — Add Item / Remove / Split, right below the
                Monthly Interest section (Owner request 2026-08-09). Multi-item: the
                money recomputes from the item list on every change. */}
            <LayawayEditItems
              ledgerId={ledgerId}
              items={detail.items}
              canManage={canTransfer}
              onRefresh={() => void reload()}
            />

            {/* Payment History — stays at the bottom (Owner request). */}
            <SectionCard icon="₱" title="Payment History">
              {detail.payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No payment records parsed.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="data-table w-full min-w-[640px] text-left text-xs">
                    <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5">#</th>
                        <th className="px-3 py-1.5">Payment Date</th>
                        <th className="px-3 py-1.5 text-right">Amount</th>
                        <th className="px-3 py-1.5">Mode of Payment</th>
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
                          <td className="px-3 py-1.5">{p.reference ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
