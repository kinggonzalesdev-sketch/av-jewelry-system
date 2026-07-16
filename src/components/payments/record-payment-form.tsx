'use client';

import { useActionState, useState } from 'react';

import {
  EMPTY_RECORD_PAYMENT_STATE,
  recordPaymentAction,
  type RecordPaymentActionState,
} from '@/lib/payments/actions';
import { formatPeso } from '@/lib/payments/format';
import type { PayableOrderRow } from '@/lib/payments/workspace';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Record Payment (Bible §16; docs/PHASE-6-APPROVED-DECISIONS.md §3).
 *
 * Records SUBMITTED EVIDENCE. It does not verify, and it cannot: the domain
 * module has no `status` field to set and the payment is born
 * `submitted_unverified` in the database. Recording and verifying are separate
 * acts by separate authority — collapsing them would let a screenshot pay for a
 * ring.
 *
 * ⚠️  NO CARD DATA. There is no input here for a card number, CVV, or PIN, and
 *     none may be added. For a card payment the operator records the CHANNEL
 *     (provider) and the APPROVAL REFERENCE — that is the entire permitted
 *     footprint (§3).
 *
 * Money is rendered from strings the database already decided. Nothing on this
 * screen computes a balance.
 */

/** Per-method required fields, mirroring recordPaymentSchema's superRefine. */
const METHODS = [
  {
    value: 'bank_transfer',
    label: 'Bank Transfer',
    providerLabel: 'Bank',
    needsProvider: true,
    needsProof: true,
    needsLocation: false,
  },
  {
    value: 'e_wallet',
    label: 'GCash / Maya / e-wallet',
    providerLabel: 'Wallet provider',
    needsProvider: true,
    needsProof: true,
    needsLocation: false,
  },
  {
    value: 'cash',
    label: 'Cash',
    providerLabel: null,
    needsProvider: false,
    // §3: photo evidence is OPTIONAL for cash — the receiving staff identity and
    // the receipt number are the attribution.
    needsProof: false,
    needsLocation: true,
  },
  {
    value: 'card',
    label: 'Credit / Debit card',
    providerLabel: 'Payment channel',
    needsProvider: true,
    needsProof: true,
    needsLocation: false,
  },
  {
    value: 'other',
    label: 'Other (authorized only)',
    providerLabel: 'Method name',
    needsProvider: false,
    needsProof: true,
    needsLocation: false,
  },
] as const;

type MethodValue = (typeof METHODS)[number]['value'];

export function RecordPaymentForm({ orders }: { orders: PayableOrderRow[] }) {
  const [state, action, pending] = useActionState<RecordPaymentActionState, FormData>(
    recordPaymentAction,
    EMPTY_RECORD_PAYMENT_STATE,
  );

  const [orderId, setOrderId] = useState('');
  const [method, setMethod] = useState<MethodValue>('bank_transfer');

  const selected = orders.find((o) => o.officialOrderId === orderId) ?? null;
  const spec = METHODS.find((m) => m.value === method) ?? METHODS[0];

  if (orders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Record Payment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            There are no Official Orders to record a payment against yet. An order is
            created by Approve &amp; Send Invoice.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Payment</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {/* --- Order selection ------------------------------------------- */}
          <div className="space-y-1.5">
            <Label htmlFor="officialOrderId">Official Order</Label>
            <select
              id="officialOrderId"
              name="officialOrderId"
              required
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select an Official Order…</option>
              {orders.map((o) => (
                <option key={o.officialOrderId} value={o.officialOrderId}>
                  {o.orderNumber} — {o.customerDisplayName}
                </option>
              ))}
            </select>
          </div>

          {/* --- Authoritative order facts, straight from the database ----- */}
          {selected && (
            <dl
              className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm"
              data-testid="order-summary"
            >
              <dt className="text-muted-foreground">Order</dt>
              <dd className="font-medium">{selected.orderNumber}</dd>

              <dt className="text-muted-foreground">Invoice</dt>
              <dd className="font-medium">{selected.invoiceNumber}</dd>

              <dt className="text-muted-foreground">Customer</dt>
              <dd className="font-medium">{selected.customerDisplayName}</dd>

              <dt className="text-muted-foreground">Amount payable</dt>
              <dd className="font-medium">{formatPeso(selected.totalAmountPayable)}</dd>

              <dt className="text-muted-foreground">Verified so far</dt>
              <dd className="font-medium">{formatPeso(selected.verifiedNetPayments)}</dd>

              <dt className="text-muted-foreground">Outstanding balance</dt>
              <dd className="font-semibold">{formatPeso(selected.outstandingBalance)}</dd>

              {selected.paidInFull && (
                <>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">
                    Paid in Full — a further payment records an Overpayment Credit and is
                    flagged for review.
                  </dd>
                </>
              )}
            </dl>
          )}

          {/* --- Amount + method ------------------------------------------- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Payment amount (₱)</Label>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="10000.00"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paymentMethod">Payment method</Label>
              <select
                id="paymentMethod"
                name="paymentMethod"
                value={method}
                onChange={(e) => setMethod(e.target.value as MethodValue)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transactedAt">Transaction date &amp; time</Label>
              <Input
                id="transactedAt"
                name="transactedAt"
                type="datetime-local"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="referenceNumber">Transaction / reference number</Label>
              <Input id="referenceNumber" name="referenceNumber" required />
            </div>
          </div>

          {/* --- Method-specific fields ------------------------------------ */}
          {spec.needsProvider && spec.providerLabel && (
            <div className="space-y-1.5">
              <Label htmlFor="provider">{spec.providerLabel}</Label>
              <Input id="provider" name="provider" required />
            </div>
          )}

          {method === 'other' && (
            <div className="space-y-1.5">
              <Label htmlFor="provider-other">Method name</Label>
              <Input id="provider-other" name="provider" />
            </div>
          )}

          {spec.needsLocation && (
            <div className="space-y-1.5">
              <Label htmlFor="collectionLocation">Store / collection location</Label>
              <Input id="collectionLocation" name="collectionLocation" required />
              <p className="text-xs text-muted-foreground">
                Cash is attributed to the receiving staff member and the receipt number. A
                photo is optional for cash (§3).
              </p>
            </div>
          )}

          {/* --- Evidence --------------------------------------------------- */}
          <div className="space-y-1.5">
            <Label htmlFor="evidenceReference">
              Evidence reference {spec.needsProof ? '(required)' : '(optional)'}
            </Label>
            <Input
              id="evidenceReference"
              name="evidenceReference"
              placeholder="e.g. gcash-2026-07-20-ana.png"
              required={spec.needsProof}
            />
            <p className="text-xs text-muted-foreground">
              V1 records a <strong>reference</strong> to the proof, not the file itself —
              file upload is not built. Keep the screenshot or receipt so it can be
              produced on request.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">
              Note {method === 'other' ? '(required)' : '(optional)'}
            </Label>
            <Input id="note" name="note" required={method === 'other'} />
          </div>

          {/* --- The one thing that must never be misread ------------------ */}
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Recording is <strong>not</strong> verifying. This payment is saved as
            <strong> unverified</strong> and reduces no balance until someone with Payment
            Verification verifies it. Never enter a card number, CVV, or PIN — the system
            does not store them.
          </p>

          <Button type="submit" disabled={pending || !orderId}>
            {pending ? 'Recording…' : 'Record payment evidence'}
          </Button>

          {/* --- Authoritative server result ------------------------------- */}
          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}

          {state.success && (
            <div className="space-y-2">
              <p role="status" className="text-sm font-medium">
                {state.success}
              </p>
              {state.duplicateReferenceFlagged && (
                <p
                  role="alert"
                  data-testid="duplicate-reference-warning"
                  className="rounded-md border border-destructive/50 p-3 text-sm font-medium text-destructive"
                >
                  ⚠️ Duplicate reference number. This reference already exists on another
                  payment. It was <strong>flagged for review, not rejected</strong> — a
                  human decides, because silently refusing it would hide the collision.
                </p>
              )}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
