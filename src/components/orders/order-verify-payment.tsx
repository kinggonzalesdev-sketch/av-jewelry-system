'use client';

import { useState } from 'react';

import { verifyPaymentAction } from '@/lib/payments/actions';
import { EMPTY_PAYMENT_STATE } from '@/lib/payments/action-state';
import type { OrderPaymentHistoryEntry } from '@/lib/orders/detail-types';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Verify Payment — confirm a payment record that exists but is still UNVERIFIED
 * (evidence recorded, not yet confirmed). Sits beside Add Payment in the Payment
 * card.
 *
 * The button appears only when the order has at least one unverified payment AND
 * the user holds the payment-verification grant; it hides once every payment is
 * verified or the order is fully paid. All of that is convenience — the guarded
 * `verifyPayment` in the database is the real gate: it deduplicates (a payment is
 * never verified twice), blocks any amount that would push the order past its
 * balance, and records verified-by + when.
 */
function humanize(v: string | null): string {
  if (!v) return '—';
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function OrderVerifyPayment({
  customerName,
  orderNumber,
  unverified,
  canVerify,
  onRefresh,
}: {
  customerName: string;
  orderNumber: string;
  /** The order's unverified, non-voided payment records. */
  unverified: OrderPaymentHistoryEntry[];
  canVerify: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Which payment is being confirmed. Defaults to the first (usual case: one).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidden entirely when nothing needs verifying or the user lacks the grant.
  if (!canVerify || unverified.length === 0) return null;

  const selected =
    unverified.find((p) => p.paymentId === selectedId) ?? unverified[0] ?? null;

  const openModal = () => {
    setSelectedId(unverified[0]?.paymentId ?? null);
    setError(null);
    setOpen(true);
  };

  const confirm = async () => {
    if (pending || !selected) return;
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set('paymentId', selected.paymentId);
    // Verify the amount that was actually recorded on the payment.
    fd.set('verifiedAmount', selected.amount);
    const res = await verifyPaymentAction(EMPTY_PAYMENT_STATE, fd);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    // Refreshes the modal, the order row, the summary cards, and the Unverified
    // Payment count — no full-page reload.
    onRefresh();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={openModal}
        data-testid="order-verify-payment"
      >
        Verify Payment
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Verify payment"
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void confirm()}
              disabled={pending || !selected}
              data-testid="order-verify-confirm"
            >
              {pending ? 'Verifying…' : 'Confirm Verified Payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* When more than one payment is unverified, let the operator pick which
              record they are confirming. */}
          {unverified.length > 1 ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pending payments
              </p>
              <div className="space-y-1">
                {unverified.map((p) => (
                  <label
                    key={p.paymentId}
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm ${
                      selected?.paymentId === p.paymentId
                        ? 'border-gold bg-gold/10'
                        : 'border-border'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="verify-pick"
                        checked={selected?.paymentId === p.paymentId}
                        onChange={() => setSelectedId(p.paymentId)}
                        className="accent-gold"
                      />
                      <span className="tabular-nums font-medium">{formatPeso(p.amount)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {humanize(p.paymentMethod)} · {fmtDate(p.transactedAt ?? p.recordedAt)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {selected ? (
            <dl
              className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm"
              data-testid="order-verify-fields"
            >
              <Field label="Customer Name">{customerName}</Field>
              <Field label="Order Number">
                <span className="font-mono">{orderNumber}</span>
              </Field>
              <Field label="Pending Amount">
                <span className="font-semibold">{formatPeso(selected.amount)}</span>
              </Field>
              <Field label="Payment Method">{humanize(selected.paymentMethod)}</Field>
              <Field label="Reference Number">{selected.referenceNumber ?? '—'}</Field>
              <Field label="Payment Date">
                {fmtDate(selected.transactedAt ?? selected.recordedAt)}
              </Field>
            </dl>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive" data-testid="order-verify-error">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{children}</dd>
    </div>
  );
}
