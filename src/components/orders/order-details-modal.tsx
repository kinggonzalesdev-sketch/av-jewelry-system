'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';

import {
  confirmRequiredPaymentAction,
  loadOrderDetailAction,
  loadOrderInvoiceMessageAction,
  loadOrderRemindersAction,
  readyForPreparationAction,
  saveOrderInvoiceMessageAction,
  sendOrderReminderAction,
  setCustomerResponseAction,
  verifyForInvoiceAction,
} from '@/lib/orders/actions';
import { formatPeso } from '@/lib/payments/format';
import type { OrderDetail, OrderDetailResult } from '@/lib/orders/detail-types';
import type { PaymentStatus } from '@/lib/orders/service';
import { OrderDestinationTransfer } from '@/components/orders/order-destination-transfer';
import { OrderCancelAction } from '@/components/orders/order-cancel-action';
import { OrderPaymentActions } from '@/components/orders/order-payment-actions';
import { Money, SensitivePhone, Sensitive } from '@/components/shell/privacy';
import { StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';

/**
 * Order Details — ONE reusable, centered modal shown in place across every
 * order-related screen (Orders, Payments, Fulfillment, Layaway). Clicking an
 * order NEVER navigates: the current page stays mounted behind a dark overlay.
 *
 * Compact, summary-first, TABBED layout (Owner request 2026-07-23): a sticky
 * header (order · customer · status · total/paid/remaining), internal tabs
 * (Overview · Items · Payments · Fulfillment · History) whose content scrolls,
 * and a sticky footer of actions. The admin understands the order at a glance
 * without scrolling through everything.
 *
 * Honesty + safety invariants (unchanged):
 *   - READ-first; opening it runs no write and changes no status.
 *   - Money is authoritative and shown as strings; an unreadable balance says
 *     "unavailable", never a fabricated ₱0.00. Line totals are computed in exact
 *     integer centavos for DISPLAY only — never floated into a balance.
 *   - Actions reuse the existing guarded server actions; nothing re-implements one.
 *   - Every tab panel stays in the DOM (only the active one is shown) so PRINT and
 *     export still see the full record; Privacy Mode masking is preserved.
 */

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid_in_full: 'Paid in Full',
  partial: 'Partially paid',
  awaiting: 'Awaiting payment',
  unavailable: 'Balance unavailable',
};

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  paid_in_full: 'gold',
  partial: 'warning',
  awaiting: 'neutral',
  unavailable: 'danger',
};

const PRINT_CSS = `
@media print {
  body > *:not(#order-modal-portal) { display: none !important; }
  #order-modal-portal .modal-backdrop { display: none !important; }
  #order-modal-portal .modal-shell { position: static !important; padding: 0 !important; }
  #order-modal-portal .modal-panel {
    max-height: none !important; overflow: visible !important;
    box-shadow: none !important; border: 0 !important; max-width: none !important;
  }
  #order-modal-portal .modal-scroll { overflow: visible !important; max-height: none !important; }
  #order-modal-portal [data-tabpanel] { display: block !important; }
  #order-modal-portal .no-print { display: none !important; }
}
`;

const TABS = [
  ['overview', 'Overview'],
  ['items', 'Items'],
  ['history', 'History'],
] as const;

type TabKey = (typeof TABS)[number][0];

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Total grams for a line = per-piece grams × quantity (weight, not money). */
function totalGrams(gramsPerPiece: string, quantity: number): string {
  const n = Number(gramsPerPiece) * quantity;
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '—';
}

/** Line total = unit price × quantity, in EXACT integer centavos (qty is an
 *  integer). A display convenience only — never fed back into a balance. */
function lineTotal(unitPrice: string | null, quantity: number): string | null {
  if (!unitPrice) return null;
  const cents = Math.round(Number(unitPrice) * 100);
  if (!Number.isFinite(cents)) return null;
  return ((cents * quantity) / 100).toFixed(2);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** A compact key-value cell for the summary blocks. */
function KV({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-0.5 py-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-sm font-medium">{children}</span>
    </div>
  );
}

/** A titled two-column summary block. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-x-4">{children}</div>
    </div>
  );
}

/** One tab's panel. Kept in the DOM even when inactive (only hidden) so print and
 *  export see the whole record. */
function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div data-tabpanel className={active ? 'block' : 'hidden'}>
      {children}
    </div>
  );
}

/** A compact financial figure in the sticky header. */
function FinChip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-center">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs font-semibold tabular-nums">{children}</p>
    </div>
  );
}

function ModalHeader({
  detail,
  onClose,
}: {
  detail: OrderDetail;
  onClose: () => void;
}) {
  const a = detail.amounts;
  return (
    <div className="shrink-0 border-b border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{detail.orderNumber}</span>
            <StatusBadge label={humanize(detail.status)} tone="neutral" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {detail.customer.displayName} ·{' '}
            <span className="font-mono">{detail.invoiceNumber}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid="order-modal-close"
          className="no-print flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
        >
          ✕
        </button>
      </div>

      {/* Compact financial summary — always visible in the header. */}
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <FinChip label="Total">
          {a.unavailable ? '—' : <Money amount={a.totalAmountPayable} />}
        </FinChip>
        <FinChip label="Verified Paid">
          {a.unavailable ? '—' : <Money amount={a.verifiedNetPayments} />}
        </FinChip>
        <FinChip label="Remaining">
          {a.unavailable ? '—' : <Money amount={a.outstandingBalance} />}
        </FinChip>
      </div>
    </div>
  );
}

/**
 * For Invoice view (Owner request 2026-07-27) — the WHOLE modal body when an order
 * is in the For Invoice state ('invoiced'). Deliberately minimal: six read-only
 * facts (Order Number, Customer Name, Total Price, Total Grams, Date Created,
 * Status) and three actions — Open FB Chat, View / Edit Message, Send Invoice.
 *
 * Rules honoured:
 *   - Opening FB Chat NEVER changes status (it only opens the saved Messenger link,
 *     or reports it is unavailable).
 *   - Only "Send Invoice" (after its confirmation) advances the order, and only
 *     from For Invoice → For Reminder. The transition is guarded + idempotent
 *     server-side, and the button locks after the first click so a repeat tap can
 *     never double-transfer.
 *   - Editing the message writes only the message copy (RLS-gated); it changes no
 *     status and no money. Payment status stays entirely separate from workflow.
 *   - All other order data (payments, fulfillment, history, contact, invoice no.)
 *     is untouched in the database — it is simply not shown here.
 */
function ForInvoiceView({
  detail,
  onDone,
  onClose,
}: {
  detail: OrderDetail;
  onDone: () => void;
  onClose: () => void;
}) {
  const orderId = detail.officialOrderId;
  const fbUrl = detail.customer.facebookConversationUrl;
  const canManage = detail.permissions.canPrepareInvoice;
  const a = detail.amounts;

  // Total grams = Σ (per-piece grams × quantity). Weight, never money.
  const gramsTotal = detail.items.reduce(
    (sum, it) => sum + (Number(it.gramsPerPiece) || 0) * (it.quantity || 0),
    0,
  );
  const gramsText = detail.items.some((it) => it.gramsPerPiece)
    ? `${Math.round(gramsTotal * 1000) / 1000}g`
    : '—';

  // Price per gram = Total Price ÷ Total Grams (display only). Money stays exact
  // in centavos; grams (a weight, not money) scales the divisor.
  const gramsMilli = Math.round(gramsTotal * 1000);
  const pricePerGram = ((): string | null => {
    if (a.unavailable || gramsMilli <= 0) return null;
    const clean = a.totalAmountPayable.replace(/[^\d.]/g, '');
    const [w = '0', f = ''] = clean.split('.');
    const totalCentavos = BigInt(w || '0') * 100n + BigInt(`${f}00`.slice(0, 2) || '0');
    const perGram = (totalCentavos * 1000n + BigInt(gramsMilli) / 2n) / BigInt(gramsMilli);
    return `${perGram / 100n}.${String(perGram % 100n).padStart(2, '0')}`;
  })();

  // Open FB Chat — opens the saved Messenger link in a new tab, or reports it is
  // not available. Never mutates the order.
  const [fbNotice, setFbNotice] = useState<string | null>(null);
  const openFbChat = () => {
    if (fbUrl) {
      setFbNotice(null);
      window.open(fbUrl, '_blank', 'noopener,noreferrer');
    } else {
      setFbNotice('Facebook chat link is not available.');
    }
  };

  // View / Edit Message — loaded on demand, editable, saved to the order.
  const [msgState, setMsgState] = useState<'idle' | 'loading' | 'open'>('idle');
  const [msgBody, setMsgBody] = useState('');
  const [msgError, setMsgError] = useState<string | null>(null);
  const [savingMsg, setSavingMsg] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

  const toggleMessage = async () => {
    if (msgState === 'open') {
      setMsgState('idle');
      return;
    }
    setMsgState('loading');
    setMsgError(null);
    const res = await loadOrderInvoiceMessageAction(orderId);
    if (!res.ok) {
      setMsgError(res.error);
      setMsgState('open');
      return;
    }
    setMsgBody(res.message?.body ?? '');
    setSavedMsg(false);
    setMsgState('open');
  };

  const saveMessage = async () => {
    setSavingMsg(true);
    setMsgError(null);
    setSavedMsg(false);
    const res = await saveOrderInvoiceMessageAction(orderId, detail.customer.id, msgBody);
    setSavingMsg(false);
    if (!res.ok) {
      setMsgError(res.error);
      return;
    }
    setSavedMsg(true);
  };

  // Send Invoice — the ONLY action that advances the order (For Invoice → For
  // Reminder). `sending` locks the button; on success the view refreshes out from
  // under itself, so a duplicate transfer is impossible.
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const sendInvoice = async () => {
    if (sending) return;
    setSending(true);
    setSendError(null);
    const res = await verifyForInvoiceAction(orderId);
    if (!res.ok) {
      setSending(false);
      setSendError(res.error);
      return;
    }
    onDone(); // refreshes; the order is no longer For Invoice, so this view unmounts.
  };

  const actionBtn =
    'rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent';

  return (
    <>
      {/* Minimal header — order number + the workflow status, nothing financial. */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{detail.orderNumber}</span>
            <StatusBadge label="For Invoice" tone="gold" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="order-modal-close"
            className="no-print flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="modal-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* The six visible facts. */}
        <div
          className="grid grid-cols-2 gap-x-4 rounded-lg border border-border p-3"
          data-testid="for-invoice-fields"
        >
          <KV label="Order Number">
            <span className="font-mono">{detail.orderNumber}</span>
          </KV>
          <KV label="Status">For Invoice</KV>
          <KV label="Customer Name">{detail.customer.displayName}</KV>
          <KV label="Date Created">{fmtDateTime(detail.createdAt)}</KV>
          <KV label="Total Price">
            {detail.amounts.unavailable ? '—' : <Money amount={detail.amounts.totalAmountPayable} />}
          </KV>
          <KV label="Total Grams">{gramsText}</KV>
          <KV label="Price per Gram">
            {pricePerGram === null ? '—' : <Money amount={pricePerGram} />}
          </KV>
        </div>

        {/* Actions. */}
        <div className="no-print space-y-2 rounded-lg border border-gold/40 bg-gold/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openFbChat}
              data-testid="order-open-fb-chat"
              className={actionBtn}
            >
              💬 Open FB Chat
            </button>
            <button
              type="button"
              onClick={() => void toggleMessage()}
              data-testid="order-view-message"
              className={actionBtn}
            >
              ✉ View / Edit Message
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={sending}
                data-testid="order-send-invoice"
                className="rounded-md bg-gold px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-gold/90 disabled:opacity-60"
              >
                Send Invoice
              </button>
            ) : null}
          </div>

          {fbNotice ? (
            <p className="text-xs text-muted-foreground" data-testid="order-fb-notice">
              {fbNotice}
            </p>
          ) : null}

          {/* Editable message. */}
          {msgState === 'loading' ? (
            <p className="text-xs text-muted-foreground">Loading message…</p>
          ) : null}
          {msgState === 'open' ? (
            <div className="space-y-1.5" data-testid="order-message-panel">
              <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                Invoice message (editable)
              </label>
              <textarea
                value={msgBody}
                onChange={(e) => {
                  setMsgBody(e.target.value);
                  setSavedMsg(false);
                }}
                rows={8}
                disabled={!canManage}
                data-testid="order-message-edit"
                placeholder="Type the invoice message to copy or send on Facebook…"
                className="block w-full resize-y rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-gold disabled:opacity-70"
              />
              {canManage ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveMessage()}
                    disabled={savingMsg}
                    data-testid="order-message-save"
                    className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                  >
                    {savingMsg ? 'Saving…' : 'Save Message'}
                  </button>
                  {savedMsg ? (
                    <span className="text-xs text-gold-strong">Saved.</span>
                  ) : null}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">
                  You can view this message; editing needs message-preparation permission.
                </p>
              )}
              {msgError ? (
                <p role="alert" className="text-xs text-destructive">
                  {msgError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Send Invoice confirmation. */}
          {confirming ? (
            <div
              className="space-y-2 rounded-md border border-border bg-background p-3"
              data-testid="order-send-confirm"
            >
              <p className="text-sm font-medium">
                Confirm that the invoice details were sent?
              </p>
              <p className="text-[11px] text-muted-foreground">
                This moves the order from <strong>For Invoice</strong> to{' '}
                <strong>For Reminder</strong> and records the date, time, and who did it.
                It cannot be undone here.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={sending}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void sendInvoice()}
                  disabled={sending}
                  data-testid="order-send-invoice-confirm"
                  className="rounded-md bg-gold px-2.5 py-1 text-xs font-semibold text-black hover:bg-gold/90 disabled:opacity-60"
                >
                  {sending ? 'Sending…' : 'Confirm Send Invoice'}
                </button>
              </div>
              {sendError ? (
                <p role="alert" className="text-xs text-destructive">
                  {sendError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Cancel Order — destructive, separated from the invoice actions. */}
          <OrderCancelAction
            orderId={orderId}
            orderNumber={detail.orderNumber}
            customerName={detail.customer.displayName}
            status={detail.status}
            isOwner={detail.permissions.isOwner}
            onDone={onDone}
          />
        </div>
      </div>
    </>
  );
}

/** Remaining required payment = max(required − verified, 0), exact centavos. */
function remainingRequired(required: string, verified: string): string {
  const toC = (s: string): bigint => {
    const negative = s.trim().startsWith('-');
    const clean = s.replace(/[^\d.]/g, '');
    const [whole = '0', frac = ''] = clean.split('.');
    const c = BigInt(whole || '0') * 100n + BigInt(`${frac}00`.slice(0, 2) || '0');
    return negative ? -c : c;
  };
  let d = toC(required) - toC(verified);
  if (d < 0n) d = 0n;
  return `${d / 100n}.${String(d % 100n).padStart(2, '0')}`;
}

/**
 * For Reminder view (Owner request 2026-07-27) — the WHOLE modal body when an order
 * is in For Reminder ('awaiting_required_payment'). Shows the customer + payment
 * figures, three sequential reminder actions, Open FB Chat, and a single "Confirm
 * for Preparation" action that (after confirmation) moves the order to For Prepare.
 * All fulfillment decisions happen later, inside For Prepare.
 *
 * Rules: sending a reminder NEVER moves the order; only "Confirm for Preparation"
 * transfers it, and only from For Reminder (so a repeat can't double-move); payment
 * status stays separate from workflow status.
 */
function ForReminderView({
  detail,
  onDone,
  onClose,
}: {
  detail: OrderDetail;
  onDone: () => void;
  onClose: () => void;
}) {
  const orderId = detail.officialOrderId;
  const fbUrl = detail.customer.facebookConversationUrl;
  const a = detail.amounts;
  const remaining = a.unavailable
    ? null
    : remainingRequired(a.requiredDownPayment, a.verifiedNetPayments);

  const [sent, setSent] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load reminders already sent.
  useEffect(() => {
    let cancelled = false;
    void loadOrderRemindersAction(orderId).then((r) => {
      if (cancelled) return;
      setSent(r.reminders.map((x) => x.number));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const [fbNotice, setFbNotice] = useState<string | null>(null);
  const openFbChat = () => {
    if (fbUrl) {
      setFbNotice(null);
      window.open(fbUrl, '_blank', 'noopener,noreferrer');
    } else {
      setFbNotice('Facebook chat link is not available.');
    }
  };

  // Reminder send flow: compose → (open chat) → confirm → record.
  const [composing, setComposing] = useState<number | null>(null);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  const reminderBody = (n: number): string => {
    const amt = remaining ? formatPeso(remaining) : 'your remaining balance';
    return (
      `Hi ${detail.customer.displayName}! Friendly reminder (${n}/3) for order ` +
      `${detail.orderNumber}. Your remaining required payment is ${amt}. ` +
      `Please settle it to keep your items reserved. Maraming salamat po! 🙏`
    );
  };

  const startReminder = (n: number) => {
    setReminderError(null);
    setComposing(n);
    if (fbUrl) window.open(fbUrl, '_blank', 'noopener,noreferrer');
  };

  const confirmReminder = async (n: number) => {
    if (sendingReminder) return;
    setSendingReminder(true);
    setReminderError(null);
    const res = await sendOrderReminderAction(orderId, n, reminderBody(n));
    setSendingReminder(false);
    if (!res.ok) {
      setReminderError(res.error);
      return;
    }
    setSent((prev) => (prev.includes(n) ? prev : [...prev, n]));
    setComposing(null);
    onDone();
  };

  // Confirm for Preparation: For Reminder → For Prepare. Locks while pending; on
  // success the order leaves For Reminder, so a repeat can't double-transfer.
  const [confirmingPrep, setConfirmingPrep] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  const confirmForPreparation = async () => {
    if (preparing) return;
    setPreparing(true);
    setPrepError(null);
    const res = await setCustomerResponseAction(orderId, 'confirmed');
    if (!res.ok) {
      setPreparing(false);
      setPrepError(res.error);
      return;
    }
    onDone();
  };

  const actionBtn =
    'rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50';

  return (
    <>
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{detail.orderNumber}</span>
            <StatusBadge label="For Reminder" tone="warning" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="order-modal-close"
            className="no-print flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="modal-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* Customer + payment figures. */}
        <div
          className="grid grid-cols-2 gap-x-4 rounded-lg border border-border p-3"
          data-testid="for-reminder-fields"
        >
          <KV label="Customer Name">{detail.customer.displayName}</KV>
          <KV label="Order Number">
            <span className="font-mono">{detail.orderNumber}</span>
          </KV>
          <KV label="Required Payment">
            {a.unavailable ? '—' : <Money amount={a.requiredDownPayment} />}
          </KV>
          <KV label="Verified Payment">
            {a.unavailable ? '—' : <Money amount={a.verifiedNetPayments} />}
          </KV>
          <KV label="Remaining Required Payment">
            {remaining === null ? '—' : <Money amount={remaining} />}
          </KV>
        </div>

        {/* Reminders 1 · 2 · 3 — sequential, single-send each. */}
        <div className="no-print space-y-2 rounded-lg border border-gold/40 bg-gold/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
            Reminders
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3].map((n) => {
              const isSent = sent.includes(n);
              const unlocked = n === 1 || sent.includes(n - 1);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!loaded || isSent || !unlocked || composing !== null}
                  onClick={() => startReminder(n)}
                  data-testid={`order-send-reminder-${n}`}
                  className={
                    isSent
                      ? 'rounded-md border border-green-600/40 bg-green-600/10 px-2.5 py-1.5 text-xs font-medium text-green-700'
                      : actionBtn
                  }
                >
                  {isSent ? `Reminder ${n} ✓` : `Send Reminder ${n}`}
                </button>
              );
            })}
            <button
              type="button"
              onClick={openFbChat}
              data-testid="order-open-fb-chat"
              className={actionBtn}
            >
              💬 Open FB Chat
            </button>
            <button
              type="button"
              onClick={() => setConfirmingPrep(true)}
              disabled={preparing}
              data-testid="order-confirm-preparation"
              className="rounded-md bg-gold px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-gold/90 disabled:opacity-60"
            >
              Confirm for Preparation
            </button>
          </div>
          {fbNotice ? (
            <p className="text-xs text-muted-foreground" data-testid="order-fb-notice">
              {fbNotice}
            </p>
          ) : null}

          {composing !== null ? (
            <div
              className="space-y-2 rounded-md border border-border bg-background p-2.5"
              data-testid="order-reminder-compose"
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Reminder {composing} message — {fbUrl ? 'the FB chat was opened; ' : ''}copy this,
                send it, then confirm.
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-muted p-2 text-[11px]">
                {reminderBody(composing)}
              </pre>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setComposing(null)}
                  disabled={sendingReminder}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmReminder(composing)}
                  disabled={sendingReminder}
                  data-testid="order-reminder-confirm"
                  className="rounded-md bg-gold px-2.5 py-1 text-xs font-semibold text-black hover:bg-gold/90 disabled:opacity-60"
                >
                  {sendingReminder ? 'Recording…' : `Confirm Reminder ${composing} sent`}
                </button>
              </div>
              {reminderError ? (
                <p role="alert" className="text-xs text-destructive">
                  {reminderError}
                </p>
              ) : null}
            </div>
          ) : reminderError ? (
            <p role="alert" className="text-xs text-destructive">
              {reminderError}
            </p>
          ) : null}
        </div>

          {/* Confirm for Preparation → moves the order to For Prepare. */}
          {confirmingPrep ? (
            <div
              className="space-y-2 rounded-md border border-border bg-background p-3"
              data-testid="order-prep-confirm"
            >
              <p className="text-sm font-medium">
                Confirm that the customer is ready for order preparation?
              </p>
              <p className="text-[11px] text-muted-foreground">
                This moves the order from <strong>For Reminder</strong> to{' '}
                <strong>For Prepare</strong> and records who and when. Fulfillment
                (Delivery / Pickup / Layaway / Keep / Cancelled) is chosen in For Prepare.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingPrep(false)}
                  disabled={preparing}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmForPreparation()}
                  disabled={preparing}
                  data-testid="order-prep-confirm-apply"
                  className="rounded-md bg-gold px-2.5 py-1 text-xs font-semibold text-black hover:bg-gold/90 disabled:opacity-60"
                >
                  {preparing ? 'Moving…' : 'Confirm'}
                </button>
              </div>
              {prepError ? (
                <p role="alert" className="text-xs text-destructive">
                  {prepError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Cancel Order — destructive, separated from the reminder actions. */}
          <OrderCancelAction
            orderId={detail.officialOrderId}
            orderNumber={detail.orderNumber}
            customerName={detail.customer.displayName}
            status={detail.status}
            isOwner={detail.permissions.isOwner}
            onDone={onDone}
          />
      </div>
    </>
  );
}

/**
 * Orders Workflow (Epic A) forward-transition bar. Renders the ONE contextual
 * action for the order's current status: For Reminder → For Confirm (payment-gated
 * server-side), or For Confirm → For Prepare. Each has a confirm step, is guarded
 * + idempotent server-side, and refreshes on success. Money is display-only here.
 */
function WorkflowActions({
  orderId,
  status,
  canConfirmPayment,
  canPrepare,
  requiredDown,
  verified,
  onDone,
}: {
  orderId: string;
  status: string;
  canConfirmPayment: boolean;
  canPrepare: boolean;
  requiredDown: string;
  verified: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReminder = status === 'awaiting_required_payment';
  const isConfirm = status === 'required_payment_verified';
  const canAct = isReminder ? canConfirmPayment : isConfirm ? canPrepare : false;
  if ((!isReminder && !isConfirm) || !canAct) return null;

  const label = isReminder ? 'Confirm Required Payment' : 'Ready for Preparation';
  const target = isReminder ? 'For Confirm' : 'For Prepare';

  const run = async () => {
    setPending(true);
    setError(null);
    const res = isReminder
      ? await confirmRequiredPaymentAction(orderId)
      : await readyForPreparationAction(orderId);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
  };

  return (
    <div className="no-print rounded-lg border border-gold/40 bg-gold/5 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
        {isReminder ? 'For Reminder' : 'For Confirm'}
      </p>
      {isReminder ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Required down:{' '}
          <span className="font-medium tabular-nums">
            <Money amount={requiredDown} />
          </span>{' '}
          · Verified:{' '}
          <span className="font-medium tabular-nums">
            <Money amount={verified} />
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-testid="order-workflow-advance"
            className="rounded-md bg-gold px-2.5 py-1 text-xs font-semibold text-black hover:bg-gold/90"
          >
            {label}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs">
            Move to {target}?
            <button
              type="button"
              onClick={() => void run()}
              disabled={pending}
              className="rounded-md bg-gold px-2 py-1 font-semibold text-black hover:bg-gold/90"
            >
              {pending ? '…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </span>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DetailBody({
  detail,
  onRefresh,
  onClose,
}: {
  detail: OrderDetail;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('overview');

  // For Invoice orders get the dedicated, stripped-down view (Owner request) — no
  // tabs, no financial/fulfillment detail. Every other status keeps the full
  // tabbed modal below. (The hook above is always called, so this early return
  // never changes hook order.)
  if (detail.status === 'invoiced') {
    return <ForInvoiceView detail={detail} onDone={onRefresh} onClose={onClose} />;
  }
  if (detail.status === 'awaiting_required_payment') {
    return <ForReminderView detail={detail} onDone={onRefresh} onClose={onClose} />;
  }

  const a = detail.amounts;
  const f = detail.fulfillment;
  const fr = detail.fulfillmentRow;
  const itemCount = detail.items.reduce((n, it) => n + (it.quantity || 0), 0);

  const methodText = fr?.method
    ? humanize(fr.method)
    : f?.collectionChannel
      ? humanize(f.collectionChannel)
      : 'Not set';
  const fulfillStatus = f ? humanize(f.status) : fr ? humanize(fr.status) : 'Not started';
  const codText = fr
    ? fr.isCod
      ? fr.codApproved
        ? 'COD · approved'
        : 'COD · not approved'
      : 'No COD'
    : '—';
  const depositText = fr
    ? fr.meetsDepositFloor
      ? 'Deposit met'
      : 'Below deposit floor'
    : '—';

  return (
    <>
      <ModalHeader detail={detail} onClose={onClose} />

      {/* Tab bar — horizontally scrollable on mobile; never navigates. */}
      <div
        role="tablist"
        className="no-print flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5"
      >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            data-testid={`order-modal-tab-${key}`}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? 'bg-gold/15 text-gold-strong'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scrollable tab content — every panel stays mounted for print/export. */}
      <div className="modal-scroll flex-1 overflow-y-auto px-4 py-3">
        {/* -------------------------------- OVERVIEW ------------------------- */}
        <TabPanel active={tab === 'overview'}>
          <div className="space-y-3">
            {/* For Invoice ('invoiced') is handled by ForInvoiceView above and never
                reaches this tabbed layout. */}
            <WorkflowActions
              orderId={detail.officialOrderId}
              status={detail.status}
              canConfirmPayment={detail.permissions.canRecordPayment}
              canPrepare={detail.permissions.canPrepareFulfillment}
              requiredDown={a.requiredDownPayment}
              verified={a.verifiedNetPayments}
              onDone={onRefresh}
            />

            {/* For Prepare: all fulfillment decisions (Delivery / Pickup / Layaway /
                Keep / Cancelled) happen here, with a confirmation step. */}
            {detail.status === 'for_preparation' ? (
              <OrderDestinationTransfer
                orderId={detail.officialOrderId}
                status={detail.status}
                destination={detail.fulfillmentDestination}
                destinationSetByName={detail.destinationSetByName}
                destinationSetAt={detail.destinationSetAt}
                canTransfer={detail.permissions.canPrepareFulfillment}
                onTransferred={onRefresh}
              />
            ) : null}

            {/* Cancel Order — destructive, kept apart from the forward actions. */}
            <OrderCancelAction
              orderId={detail.officialOrderId}
              orderNumber={detail.orderNumber}
              customerName={detail.customer.displayName}
              status={detail.status}
              isOwner={detail.permissions.isOwner}
              onDone={onRefresh}
            />

            <Block title="Customer">
              <KV label="Name">{detail.customer.displayName}</KV>
              <KV label="Contact">
                {detail.customer.contactNumber ? (
                  <SensitivePhone value={detail.customer.contactNumber} />
                ) : (
                  '—'
                )}
              </KV>
              {detail.customer.address ? (
                <KV label="Address" wide>
                  <Sensitive>{detail.customer.address}</Sensitive>
                </KV>
              ) : null}
            </Block>

            <Block title="Order">
              <KV label="Order No.">
                <span className="font-mono">{detail.orderNumber}</span>
              </KV>
              <KV label="Invoice No.">
                <span className="font-mono">{detail.invoiceNumber}</span>
              </KV>
              <KV label="Created">{fmtDateTime(detail.createdAt)}</KV>
              <KV label="Items">{itemCount}</KV>
            </Block>

            <Block title="Financial summary">
              {a.unavailable ? (
                <div className="col-span-2 text-sm" role="alert">
                  <p className="font-semibold text-destructive">Balance unavailable</p>
                  <p className="mt-1 text-xs text-muted-foreground">{a.unavailable}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    This is <strong>not</strong> a zero balance.
                  </p>
                </div>
              ) : (
                <>
                  <KV label="Total amount">
                    <Money amount={a.totalAmountPayable} />
                  </KV>
                  <KV label="Verified paid">
                    <Money amount={a.verifiedNetPayments} />
                  </KV>
                  <KV label="Remaining balance">
                    <Money
                      amount={a.outstandingBalance}
                      className={a.paidInFull ? '' : 'font-semibold'}
                    />
                  </KV>
                  <KV label="Payment status">
                    <StatusBadge
                      label={PAYMENT_LABEL[detail.paymentStatus]}
                      tone={PAYMENT_TONE[detail.paymentStatus]}
                    />
                  </KV>
                </>
              )}
            </Block>

            {/* Add Payment / Add Down Payment · Deposit — beside the payment summary.
                Only when the balance is known; the component hides itself without the
                record-payment permission and disables both when fully paid. */}
            {a.unavailable ? null : (
              <OrderPaymentActions
                orderId={detail.officialOrderId}
                remaining={a.outstandingBalance}
                paidInFull={a.paidInFull}
                canRecord={detail.permissions.canRecordPayment}
                onRefresh={onRefresh}
              />
            )}

            {detail.paymentHistory.length > 0 ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment history
                </p>
                <div className="overflow-x-auto">
                  <table
                    className="w-full min-w-[420px] text-left text-xs"
                    data-testid="order-payment-history"
                  >
                    <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5">Date</th>
                        <th className="px-3 py-1.5 text-right">Amount</th>
                        <th className="px-3 py-1.5">Method</th>
                        <th className="px-3 py-1.5">Reference</th>
                        <th className="px-3 py-1.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {detail.paymentHistory.map((p) => (
                        <tr key={p.paymentId} className={p.voided || p.reversed ? 'opacity-50' : ''}>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            {fmtDateTime(p.recordedAt)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            <Money amount={p.verifiedAmount ?? p.amount} />
                          </td>
                          <td className="px-3 py-1.5">{humanize(p.paymentMethod ?? '—')}</td>
                          <td className="px-3 py-1.5 font-mono">{p.referenceNumber ?? '—'}</td>
                          <td className="px-3 py-1.5">{humanize(p.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <Block title="Fulfillment summary">
              <KV label="Method">{methodText}</KV>
              <KV label="Status">{fulfillStatus}</KV>
              <KV label="COD">{codText}</KV>
              <KV label="Deposit">{depositText}</KV>
            </Block>
          </div>
        </TabPanel>

        {/* --------------------------------- ITEMS -------------------------- */}
        <TabPanel active={tab === 'items'}>
          {detail.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No line items found for this order.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full min-w-[540px] text-left text-xs"
                data-testid="order-modal-items"
              >
                <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5">Code</th>
                    <th className="px-3 py-1.5">Item</th>
                    <th className="px-3 py-1.5 text-right">Grams</th>
                    <th className="px-3 py-1.5 text-right">Qty</th>
                    <th className="px-3 py-1.5 text-right">Unit Price</th>
                    <th className="px-3 py-1.5 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detail.items.map((it, i) => {
                    const lt = lineTotal(it.unitPrice, it.quantity);
                    return (
                      <tr key={`${it.claimReference}-${i}`}>
                        <td className="px-3 py-1.5 font-mono">{it.itemCode ?? '—'}</td>
                        <td className="px-3 py-1.5">{it.itemName ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {it.gramsPerPiece
                            ? totalGrams(it.gramsPerPiece, it.quantity)
                            : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{it.quantity}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {it.unitPrice ? <Money amount={it.unitPrice} /> : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {lt ? <Money amount={lt} /> : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabPanel>

        {/* -------------------------------- HISTORY ------------------------- */}
        <TabPanel active={tab === 'history'}>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Order activity — newest first
              </p>
              {detail.activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No recorded activity for this order.
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="order-modal-activity">
                  {detail.activity.map((ev) => (
                    <li key={ev.id} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{humanize(ev.action)}</span>
                        <span className="text-muted-foreground">
                          {fmtDateTime(ev.occurredAt)}
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        {ev.actorLabel}
                        {ev.outcome !== 'succeeded' ? ` · ${humanize(ev.outcome)}` : ''}
                        {ev.reason ? ` · ${ev.reason}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Uploaded screenshots &amp; files
              </p>
              {detail.attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No files uploaded for this order.
                </p>
              ) : (
                <ul
                  className="grid grid-cols-2 gap-2"
                  data-testid="order-modal-attachments"
                >
                  {detail.attachments.map((att) => (
                    <li
                      key={att.id}
                      className="rounded-md border border-border p-1.5 text-xs"
                    >
                      {att.signedUrl && att.contentType.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.signedUrl}
                          alt={att.fileName ?? 'Attachment'}
                          className="mb-1 h-24 w-full rounded object-cover"
                        />
                      ) : null}
                      <p className="truncate">{att.fileName ?? humanize(att.purpose)}</p>
                      {att.signedUrl ? (
                        <a
                          href={att.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gold-strong hover:underline no-print"
                        >
                          Open
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No preview</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabPanel>
      </div>
    </>
  );
}

export function OrderDetailsModal({
  orderId,
  onClose,
  onMutated,
}: {
  orderId: string | null;
  onClose: () => void;
  /** Called after an in-modal action changes data, so the parent can refresh
   *  its status counts (e.g. router.refresh()) — never a full reload. */
  onMutated?: () => void;
}) {
  const [loaded, setLoaded] = useState<{ orderId: string; result: OrderDetailResult } | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  // Body scroll-lock + Escape while open.
  useEffect(() => {
    if (!orderId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [orderId, onClose]);

  // Fetch (and re-fetch after a mutation). State is set only in the async
  // callback — never synchronously in the effect body.
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    void loadOrderDetailAction(orderId).then((result) => {
      if (!cancelled) setLoaded({ orderId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadKey]);

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
    onMutated?.();
  }, [onMutated]);

  if (!orderId) return null;

  const isLoading = loaded?.orderId !== orderId;
  const result = isLoading ? null : loaded?.result ?? null;

  return createPortal(
    <div id="order-modal-portal">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div
        className="modal-shell fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Order details"
      >
        <button
          type="button"
          aria-label="Close order details"
          onClick={onClose}
          data-testid="order-modal-backdrop"
          className="modal-backdrop absolute inset-0 bg-black/50 no-print"
        />

        <div
          className="modal-panel relative z-10 flex h-full w-full flex-col overflow-hidden border border-border bg-card shadow-xl sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-[800px] sm:rounded-xl"
          data-testid="order-modal"
        >
          {isLoading ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Order details</p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  data-testid="order-modal-close"
                  className="no-print flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
                >
                  ✕
                </button>
              </div>
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Loading order details…
              </div>
            </>
          ) : result && !result.ok ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Order details</p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  data-testid="order-modal-close"
                  className="no-print flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
                >
                  ✕
                </button>
              </div>
              <div className="px-4 py-10 text-center text-sm" role="alert">
                <p className="font-semibold text-destructive">
                  Order details could not be loaded
                </p>
                <p className="mt-1 text-muted-foreground">{result.reason}</p>
              </div>
            </>
          ) : result && result.ok ? (
            <DetailBody detail={result.detail} onRefresh={refresh} onClose={onClose} />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
