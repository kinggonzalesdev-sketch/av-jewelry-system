'use client';

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';

import {
  getCustomerMatchInfoAction,
  loadOrderDetailAction,
  loadOrderInvoiceMessageAction,
  resendInvoiceAction,
  saveOrderInvoiceMessageAction,
  sendInvoiceMessageAction,
  setCustomerFacebookUrlAction,
  setCustomerPancakeConversationAction,
} from '@/lib/orders/actions';
import { renderOrderMessageAction } from '@/lib/messaging/actions';
import { CopyButton } from '@/components/ui/copy-button';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import type { OrderDetail, OrderDetailResult } from '@/lib/orders/detail-types';
import type { CustomerMatchInfo } from '@/lib/orders/customer-match-types';
import type { PaymentStatus } from '@/lib/orders/service';
import { OrderDestinationTransfer } from '@/components/orders/order-destination-transfer';
import { FbChatButton } from '@/components/orders/fb-chat-button';
import { OrderCancelAction } from '@/components/orders/order-cancel-action';
import { OrderPaymentActions } from '@/components/orders/order-payment-actions';
import { OrderVerifyPayment } from '@/components/orders/order-verify-payment';
import { OrderCompletionActions } from '@/components/orders/order-completion-actions';
import { OrderWaybillField } from '@/components/orders/order-waybill-field';
import { LayawaySetupForOrder } from '@/components/orders/layaway-setup-order';
import {
  canOfferCancel,
  canOfferPayment,
  resolveStageLabel,
  stageOffers,
} from '@/lib/orders/stage-actions';
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

/**
 * Tabs (§8). Only the "Total" section keeps a separate Overview; every other
 * section shows ONE combined tab so item details and workflow history are read
 * together instead of being split across three near-empty panels.
 */
type TabKey = 'overview' | 'detail';

function tabsFor(section: string): ReadonlyArray<readonly [TabKey, string]> {
  return section === 'all'
    ? ([
        ['overview', 'Overview'],
        ['detail', 'Items & History'],
      ] as const)
    : ([['detail', 'Items & History']] as const);
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The status label shown in the modal header — it must match the Orders card the
 * order was opened from. Workflow / destination cards already agree via
 * `resolveStageLabel`; the only cross-cutting card is **Unverified Payment**
 * (a payment-status filter, not a workflow stage), so when the modal is opened
 * from there we show "Unverified Payment" rather than the underlying stage
 * (Owner request). 'all' (Total) always shows the true status.
 */
function headerStageLabel(
  section: string,
  status: string,
  fulfillmentDestination: string | null,
): string {
  if (section === 'unverified_pay') return 'Pending Payment';
  return resolveStageLabel(status, fulfillmentDestination);
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

/**
 * The shared card shell every Order-flow modal uses — one look for the Summary,
 * the stage actions, and the Payment section, so every status reads the same. An
 * iconed gold title, an optional subtitle, and a right-hand slot (used to seat
 * Cancel Order beside the payment actions instead of in a separate Danger Zone).
 */
function SectionCard({
  icon,
  title,
  subtitle,
  right,
  children,
  testId,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card/40 p-4"
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
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
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** One labelled figure in the Summary card. Label muted above, value strong. */
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

/**
 * The Order Summary card, shared by every stage. A 2-column grid of icon rows,
 * exactly the reference layout. Callers pass the rows so each stage can label its
 * money the way that stage talks about it (Required vs Total, and so on).
 */
function SummaryCard({
  testId,
  rows,
}: {
  testId?: string;
  rows: Array<{ icon?: string; label: string; value: React.ReactNode }>;
}) {
  return (
    <SectionCard icon="▤" title="Order Summary" {...(testId ? { testId } : {})}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <SummaryItem key={r.label} label={r.label} {...(r.icon ? { icon: r.icon } : {})}>
            {r.value}
          </SummaryItem>
        ))}
      </div>
    </SectionCard>
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


/**
 * The ONE shared modal header, used by every stage. Order number + status badge on
 * the left; the stage's header actions (Add Payment · Cancel Order) then the X on
 * the right — `Add Payment | Cancel Order | X` on desktop. The actions wrap below
 * the header row on narrow screens and never overlap the close button. Which
 * actions appear is decided by the caller from stage + permission, so the header
 * never shows a control the stage disallows.
 */
function ModalHeader({
  detail,
  section = 'all',
  actions,
  onClose,
}: {
  detail: OrderDetail;
  /** The Orders card the modal was opened from — so the badge matches it. */
  section?: string;
  actions?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={headerStageLabel(section, detail.status, detail.fulfillmentDestination)}
              tone="neutral"
              className="px-3.5 py-1 text-sm font-semibold"
            />
          </div>
        </div>
        <div className="no-print flex flex-wrap items-center justify-end gap-2">
          {actions}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="order-modal-close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The header actions shared by every stage: Add Payment then Cancel Order, sized
 * to sit beside the X. Visibility is the same stage + permission logic used
 * everywhere — Add Payment only while a balance remains and payment is allowed,
 * Cancel only while the order is cancellable — so a fully-paid or closed order
 * simply shows fewer buttons.
 */
function HeaderActions({
  detail,
  section = 'all',
  onRefresh,
}: {
  detail: OrderDetail;
  /** The Orders card the modal was opened from. */
  section?: string;
  onRefresh: () => void;
}) {
  const a = detail.amounts;
  // The Unverified Payment card exists to collect the awaited payment, so Add
  // Payment is always offered there (given a real remaining balance + permission),
  // even for a stage whose own workflow would not surface it (Owner request).
  const unverifiedContext =
    section === 'unverified_pay' &&
    !a.paidInFull &&
    a.unavailable === null &&
    detail.permissions.canRecordPayment;
  const showPayment =
    unverifiedContext ||
    canOfferPayment({
      status: detail.status,
      paidInFull: a.paidInFull,
      balanceUnavailable: a.unavailable !== null,
      canRecordPayment: detail.permissions.canRecordPayment,
    });
  const showCancel = canOfferCancel(detail.status) || detail.status === 'for_cancel';

  return (
    <>
      {showPayment ? (
        <OrderPaymentActions
          orderId={detail.officialOrderId}
          remaining={a.outstandingBalance}
          paidInFull={a.paidInFull}
          canRecord={detail.permissions.canRecordPayment}
          onRefresh={onRefresh}
          asButton
          total={a.unavailable ? undefined : a.totalAmountPayable}
          paid={a.unavailable ? undefined : a.verifiedNetPayments}
        />
      ) : null}
      {showCancel ? (
        <OrderCancelAction
          orderId={detail.officialOrderId}
          orderNumber={detail.orderNumber}
          customerName={detail.customer.displayName}
          status={detail.status}
          isOwner={detail.permissions.isOwner}
          compact
          onDone={onRefresh}
        />
      ) : null}
    </>
  );
}

/**
 * Small inline editor for a per-customer link/id (the Facebook Messenger URL that
 * powers "Open FB Chat", or the Pancake conversation id that powers auto-delivery
 * of Send Invoice / Send Reminder). Saved once on the customer, reused by every
 * future order for them.
 */
function CustomerLinkEditor({
  label,
  hasValue,
  placeholder,
  onSave,
  onSaved,
  testid,
}: {
  label: string;
  hasValue: boolean;
  placeholder: string;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
  onSaved: () => void;
  testid?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await onSave(value.trim());
      if (res.ok) {
        setOpen(false);
        setValue('');
        onSaved();
      } else {
        setError(res.error ?? 'Could not save.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testid}
        className="text-xs font-medium text-gold-strong underline"
      >
        {hasValue ? `Update ${label}` : `🔗 Link ${label}`}
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-gold"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-muted-foreground hover:underline"
      >
        Cancel
      </button>
      {error ? <span className="text-destructive">{error}</span> : null}
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
  section = 'all',
  onDone,
  onClose,
}: {
  detail: OrderDetail;
  section?: string;
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

  // Deadline shown in the invoice summary — the layaway final due date, if this is a
  // layaway order (a full-payment order has none). Formatted in the viewer's locale.
  const invoiceDeadline = ((): string | null => {
    const iso = detail.layaway?.finalDueDate;
    if (!iso) return null;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? iso : dt.toLocaleDateString();
  })();

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
  // The saved invoice message status ('direct_sent' / 'direct_send_failed' / …) so
  // the panel can show a Sent / Failed badge and offer Retry Send.
  const [msgStatus, setMsgStatus] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  // Customer-match ambiguity (§6): warn before sending when the name is shared by
  // other customers, or no Pancake conversation is linked. Never trust the FB name.
  const [matchInfo, setMatchInfo] = useState<CustomerMatchInfo | null>(null);

  const resendInvoice = async () => {
    if (resending) return;
    setResending(true);
    setResendNote(null);
    setMsgError(null);
    const res = await resendInvoiceAction(orderId);
    setResending(false);
    if (!res.ok) {
      setMsgStatus('direct_send_failed');
      setMsgError(res.error);
      return;
    }
    setMsgStatus('direct_sent');
    setResendNote('Sent to the customer through Pancake.');
  };

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

    // A message the operator already prepared WINS — it is a real saved record and
    // must never be silently replaced by a template. Only when none exists yet do
    // we seed the editor from the Invoice template in Settings, so the shop's own
    // wording is what actually goes out.
    let body = res.message?.body ?? '';
    if (!body.trim()) {
      const rendered = await renderOrderMessageAction(orderId, 'invoice');
      if (rendered.ok) body = rendered.message;
    }

    setMsgBody(body);
    setMsgStatus(res.message?.status ?? null);
    setSavedMsg(false);
    setMsgState('open');
    // Best-effort ambiguity check for the send warning.
    void getCustomerMatchInfoAction(detail.customer.id).then(setMatchInfo);
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
  const [sentNote, setSentNote] = useState<string | null>(null);

  // Send Invoice (Owner flow): deliver the message to the customer's Facebook chat and
  // record it, but DO NOT advance — the order stays in For Invoice; the Admin transfers
  // it to a destination afterwards. The result says plainly whether it reached the chat.
  const sendInvoice = async () => {
    if (sending) return;
    setSending(true);
    setSendError(null);
    const res = await sendInvoiceMessageAction(orderId, msgBody.trim() || null);
    setSending(false);
    if (!res.ok) {
      setSendError(res.error);
      return;
    }
    setConfirming(false);
    const delivered = res.pancake?.delivered;
    setSentNote(
      delivered
        ? `✅ Invoice sent to ${detail.customer.displayName}'s Facebook chat. The order stays in For Invoice — transfer it to a destination when ready.`
        : res.pancake?.attempted
          ? `Send attempted, but Pancake could not deliver it${
              res.pancake?.error ? `: ${res.pancake.error}` : ''
            }. Copy the message and send it manually, or retry.`
          : 'Recorded, but NOT delivered — no Pancake chat is linked to this customer. Link a Pancake chat above to actually send it to their chat.',
    );
    onDone(); // refresh the list (revalidated); the order stays in For Invoice.
  };

  const actionBtn =
    'rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent';

  return (
    <>
      {/* Minimal header — order number + the workflow status, with the Add Payment
          / Cancel Order actions seated on the right beside the X (§ header rule). */}
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={headerStageLabel(section, detail.status, detail.fulfillmentDestination)}
              tone="gold"
              className="px-3.5 py-1 text-sm font-semibold"
            />
          </div>
          <div className="no-print flex flex-wrap items-center justify-end gap-2">
            <HeaderActions detail={detail} section={section} onRefresh={onDone} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid="order-modal-close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div className="modal-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* The six visible facts — standardized Summary card. */}
        <SummaryCard
          testId="for-invoice-fields"
          rows={[
            {
              icon: '▤',
              label: 'Order Number',
              value: <span className="font-mono">{detail.orderNumber}</span>,
            },
            {
              icon: '◔',
              label: 'Status',
              value: headerStageLabel(section, detail.status, detail.fulfillmentDestination),
            },
            {
              icon: '☺',
              label: 'Customer Name',
              value: (
                <span className="inline-flex items-center gap-1.5">
                  {detail.customer.displayName}
                  <FbChatButton
                    url={detail.customer.facebookConversationUrl}
                    linked={Boolean(detail.customer.pancakeConversationId)}
                  />
                </span>
              ),
            },
            { icon: '🗓', label: 'Date Created', value: fmtDateTime(detail.createdAt) },
            {
              icon: '₱',
              label: 'Total Price',
              value: detail.amounts.unavailable ? (
                '—'
              ) : (
                <Money amount={detail.amounts.totalAmountPayable} />
              ),
            },
            { icon: '⚖', label: 'Total Grams', value: gramsText },
            {
              icon: '▦',
              label: 'Price per Gram',
              value: pricePerGram === null ? '—' : <Money amount={pricePerGram} />,
            },
          ]}
        />

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

          {/* Two links, two jobs (they are different things):
                • Facebook chat link (Messenger URL) → powers "Open FB Chat".
                • Pancake conversation → powers Send Invoice ACTUAL DELIVERY to the
                  customer's chat. Without it, Send Invoice only advances the order and
                  nothing reaches the customer — which is why "nothing happened". */}
          <div className="flex flex-col gap-1">
            <CustomerLinkEditor
              label="Facebook chat link"
              hasValue={Boolean(fbUrl)}
              placeholder="https://m.me/… (opens the chat)"
              onSave={(v) => setCustomerFacebookUrlAction(detail.customer.id, v)}
              onSaved={onDone}
              testid="order-fb-link"
            />
            <CustomerLinkEditor
              label="Pancake chat — required to send the invoice"
              hasValue={Boolean(detail.customer.pancakeConversationId)}
              placeholder="Pancake conversation id (Integrations → Load conversations → Copy ID)"
              onSave={(v) => setCustomerPancakeConversationAction(detail.customer.id, v)}
              onSaved={onDone}
              testid="order-pancake-link"
            />
          </div>

          {/* Editable message. */}
          {msgState === 'loading' ? (
            <p className="text-xs text-muted-foreground">Loading message…</p>
          ) : null}
          {msgState === 'open' ? (
            <div className="space-y-1.5" data-testid="order-message-panel">
              <label className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                Invoice message (editable)
              </label>
              {/* Structured invoice summary (Owner live-readiness): the exact money
                  terms the operator must confirm before sending during a live sale —
                  Total, the required 20% down payment, the remaining balance, and the
                  deadline. Honest — shows the read-failure reason, never a fabricated
                  ₱0, when the balance can't be read; privacy-masked like every figure. */}
              <dl
                data-testid="order-invoice-summary"
                className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] sm:grid-cols-4"
              >
                {a.unavailable ? (
                  <div className="col-span-2 text-muted-foreground sm:col-span-4">
                    {a.unavailable}
                  </div>
                ) : (
                  <>
                    <div>
                      <dt className="text-muted-foreground">Total</dt>
                      <dd
                        className="font-semibold tabular-nums"
                        data-testid="order-invoice-summary-total"
                      >
                        <Money amount={a.totalAmountPayable} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Down (20%)</dt>
                      <dd
                        className="font-semibold tabular-nums"
                        data-testid="order-invoice-summary-down"
                      >
                        <Money amount={a.requiredDownPayment} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Balance</dt>
                      <dd
                        className="font-semibold tabular-nums"
                        data-testid="order-invoice-summary-balance"
                      >
                        <Money amount={a.outstandingBalance} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Deadline</dt>
                      <dd
                        className="font-semibold tabular-nums"
                        data-testid="order-invoice-summary-deadline"
                      >
                        {invoiceDeadline ?? '—'}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {matchInfo && (matchInfo.sameNameCount > 0 || !matchInfo.hasConversation) ? (
                <div
                  role="status"
                  data-testid="order-match-warning"
                  className="space-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800"
                >
                  {matchInfo.sameNameCount > 0 ? (
                    <p>
                      ⚠ {matchInfo.sameNameCount} other customer(s) share this exact name
                      {matchInfo.examples.length ? ` (${matchInfo.examples.join(', ')})` : ''}.
                      Verify this is the right person before sending.
                    </p>
                  ) : null}
                  {!matchInfo.hasConversation ? (
                    <p>
                      No Pancake conversation is linked — Send Invoice will not
                      auto-deliver. Link a conversation, or copy the message and send it
                      manually.
                    </p>
                  ) : null}
                </div>
              ) : null}
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
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton
                  text={msgBody}
                  label="Copy Message"
                  testId="order-message-copy"
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                />
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void saveMessage()}
                      disabled={savingMsg}
                      data-testid="order-message-save"
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                    >
                      {savingMsg ? 'Saving…' : 'Save Message'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void resendInvoice()}
                      disabled={resending}
                      data-testid="order-invoice-resend"
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                    >
                      {resending
                        ? 'Sending…'
                        : msgStatus === 'direct_send_failed'
                          ? 'Retry Send'
                          : 'Resend via Pancake'}
                    </button>
                    {savedMsg ? (
                      <span className="text-xs text-gold-strong">Saved.</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    View only — editing needs message-preparation permission.
                  </span>
                )}
                {msgStatus === 'direct_sent' ? (
                  <span
                    data-testid="order-invoice-sent-badge"
                    className="rounded-full bg-green-600/10 px-2 py-0.5 text-[10px] font-semibold text-green-700"
                  >
                    Sent via Pancake ✓
                  </span>
                ) : msgStatus === 'direct_send_failed' ? (
                  <span
                    data-testid="order-invoice-failed-badge"
                    className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive"
                  >
                    Send failed
                  </span>
                ) : null}
              </div>
              {resendNote ? (
                <p
                  role="status"
                  className="text-xs font-medium text-green-700"
                  data-testid="order-invoice-resend-note"
                >
                  {resendNote}
                </p>
              ) : null}
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
              {/* Honest delivery status: Send Invoice can only reach the customer's chat
                  when a Pancake conversation is linked. If not, say so plainly so the
                  operator isn't left wondering why "nothing happened". */}
              {detail.customer.pancakeConversationId ? (
                <p
                  className="rounded-md border border-green-600/40 bg-green-600/10 px-2 py-1 text-[11px] text-green-700"
                  data-testid="order-send-will-deliver"
                >
                  ✓ The invoice will be sent to {detail.customer.displayName}&apos;s Facebook
                  chat through Pancake.
                </p>
              ) : (
                <p
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800"
                  data-testid="order-send-no-chat"
                >
                  ⚠ No Pancake chat is linked, so this will <strong>not</strong> reach the
                  customer&apos;s chat — it only advances the order. Link a Pancake chat above
                  (Integrations → Load conversations → Copy ID) to actually deliver it.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                This sends the invoice to the customer&apos;s chat and records it. The order{' '}
                <strong>stays in For Invoice</strong> — transfer it to a destination below
                whenever you&apos;re ready.
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
          {sentNote ? (
            <p
              role="status"
              data-testid="order-invoice-sent-note"
              className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs"
            >
              {sentNote}
            </p>
          ) : null}
        </div>

        {/* Transfer to Destination is available from every live stage (Owner
            request) — including For Invoice — so an order can be routed early. */}
        {detail.permissions.canPrepareFulfillment ? (
          <div className="no-print rounded-lg border border-border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Transfer to Destination
            </p>
            <OrderDestinationTransfer
              orderId={detail.officialOrderId}
              destination={detail.fulfillmentDestination}
              destinationSetByName={detail.destinationSetByName}
              destinationSetAt={detail.destinationSetAt}
              canTransfer={detail.permissions.canPrepareFulfillment}
              completionBlock={detail.completionBlock}
              onTransferred={onDone}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * Keep view (Owner request 2026-07-30, revised) — the WHOLE modal body for a Keep
 * order ('keep'). A Keep order is an item set aside for the customer. Deliberately
 * minimal: the order summary and exactly two actions —
 *   - Cancel Order in the header beside the X (red/destructive), shown only while
 *     the order is still in Keep and the user may cancel or request cancellation.
 *   - Transfer to Completed as the ONE main action (shared OrderCompletionActions):
 *     it appears only when the order is completion-eligible (`order_completion_block`
 *     in SQL is the authority), confirms first, records previous → completed status +
 *     completed by / date / time, and refreshes the row + counts without a reload.
 *
 * Everything else the generic modal offers is removed here: Add Payment, the Save /
 * Keep-note editor, the payment section, other destinations, reminders, and any
 * extra action cards or empty containers.
 */
function KeepView({
  detail,
  section = 'all',
  onDone,
  onClose,
}: {
  detail: OrderDetail;
  section?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const a = detail.amounts;
  const balanceUnavailable = a.unavailable !== null;
  // Cancel Order shows only while the order is still in Keep (canOfferCancel is
  // false for Cancelled / Completed / For Cancel). Permission is enforced inside
  // OrderCancelAction and the database.
  const canCancel = canOfferCancel(detail.status);

  return (
    <>
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              label={headerStageLabel(section, detail.status, detail.fulfillmentDestination)}
              tone="neutral"
              className="px-3.5 py-1 text-sm font-semibold"
            />
          </div>
          {/* Header actions: Cancel Order | X. */}
          <div className="no-print flex flex-wrap items-center justify-end gap-2">
            {canCancel ? (
              <OrderCancelAction
                orderId={detail.officialOrderId}
                orderNumber={detail.orderNumber}
                customerName={detail.customer.displayName}
                status={detail.status}
                isOwner={detail.permissions.isOwner}
                compact
                onDone={onDone}
              />
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid="order-modal-close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div className="modal-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* Necessary order summary only. */}
        <SummaryCard
          testId="keep-summary"
          rows={[
            {
              icon: '☺',
              label: 'Customer Name',
              value: (
                <span className="inline-flex items-center gap-1.5">
                  {detail.customer.displayName}
                  <FbChatButton
                    url={detail.customer.facebookConversationUrl}
                    linked={Boolean(detail.customer.pancakeConversationId)}
                  />
                </span>
              ),
            },
            {
              icon: '▤',
              label: 'Order Number',
              value: <span className="font-mono">{detail.orderNumber}</span>,
            },
            {
              icon: '₱',
              label: 'Total Amount',
              value: a.unavailable ? '—' : <Money amount={a.totalAmountPayable} />,
            },
            {
              icon: '✓',
              label: 'Verified Paid',
              value: a.unavailable ? '—' : <Money amount={a.verifiedNetPayments} />,
            },
            {
              icon: '▦',
              label: 'Remaining Balance',
              value: a.unavailable ? (
                <span className="text-destructive">Unavailable</span>
              ) : (
                <Money amount={a.outstandingBalance} />
              ),
            },
            {
              icon: '◔',
              label: 'Payment Status',
              value: (
                <StatusBadge
                  label={PAYMENT_LABEL[detail.paymentStatus]}
                  tone={PAYMENT_TONE[detail.paymentStatus]}
                />
              ),
            },
          ]}
        />

        {/* The ONE main action: Transfer to Completed (confirm + eligibility gate). */}
        <div data-testid="keep-actions">
          <OrderCompletionActions
            orderId={detail.officialOrderId}
            status={detail.status}
            paidInFull={a.paidInFull}
            balanceUnavailable={balanceUnavailable}
            canRelease={detail.permissions.canReleaseFulfillment}
            completionBlock={detail.completionBlock}
            onDone={onDone}
          />
        </div>
      </div>
    </>
  );
}

function DetailBody({
  detail,
  section,
  onRefresh,
  onClose,
}: {
  detail: OrderDetail;
  /** Which Orders card the modal was opened from. Only 'all' (Total) keeps a
   *  separate Overview tab (§8). */
  section: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const tabs = tabsFor(section);
  // Default to the first tab this section actually has — outside Total there is
  // no Overview to land on.
  const [tab, setTab] = useState<TabKey>(section === 'all' ? 'overview' : 'detail');

  // For Invoice orders get the dedicated, stripped-down view (Owner request) — no
  // tabs, no financial/fulfillment detail. Every other status keeps the full
  // tabbed modal below. (The hook above is always called, so this early return
  // never changes hook order.)
  if (detail.status === 'invoiced') {
    return (
      <ForInvoiceView detail={detail} section={section} onDone={onRefresh} onClose={onClose} />
    );
  }
  // Owner: For Reminder ('awaiting_required_payment') no longer has a special view with
  // reminder / Confirm-for-Preparation actions — those are removed. It falls through to
  // the general modal (summary + Transfer to Destination), like every other stage.
  // Keep orders get the dedicated, stripped-down Keep view (Owner request
  // 2026-07-30): summary + Add Payment / Cancel (header) + Transfer to Completed +
  // Save, and nothing else.
  if (detail.status === 'keep') {
    return <KeepView detail={detail} section={section} onDone={onRefresh} onClose={onClose} />;
  }

  const a = detail.amounts;
  const itemCount = detail.items.reduce((n, it) => n + (it.quantity || 0), 0);

  return (
    <>
      <ModalHeader
        detail={detail}
        section={section}
        actions={<HeaderActions detail={detail} section={section} onRefresh={onRefresh} />}
        onClose={onClose}
      />

      {/* One vertical flow: Summary card → stage action cards → Payment (+ Cancel
          on the right) → the tabs. Same order and card style for every stage. */}
      <div className="modal-scroll flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* Fully-paid banner — lifted to the UPPER part of the modal (Owner
            request) so it is the first thing seen, not buried in the Payment card. */}
        {!a.unavailable && a.paidInFull ? (
          <div
            className="flex items-center gap-2 rounded-xl border border-green-600/40 bg-green-600/10 px-4 py-3 text-sm font-semibold text-green-700"
            data-testid="order-fully-paid"
          >
            <span aria-hidden="true">✓</span>
            This order is already fully paid.
          </div>
        ) : null}

        {/* ---- Order Summary card (the reference layout) ------------------ */}
        <SummaryCard
          rows={[
            {
              icon: '☺',
              label: 'Customer Name',
              value: (
                <span className="inline-flex items-center gap-1.5">
                  {detail.customer.displayName}
                  <FbChatButton
                    url={detail.customer.facebookConversationUrl}
                    linked={Boolean(detail.customer.pancakeConversationId)}
                  />
                </span>
              ),
            },
            {
              icon: '▤',
              label: 'Order Number',
              value: <span className="font-mono">{detail.orderNumber}</span>,
            },
            {
              icon: '₱',
              label: 'Total Amount',
              value: a.unavailable ? '—' : <Money amount={a.totalAmountPayable} />,
            },
            {
              icon: '✓',
              label: 'Verified Payment',
              value: a.unavailable ? '—' : <Money amount={a.verifiedNetPayments} />,
            },
            {
              icon: '▦',
              label: 'Remaining balance',
              value: a.unavailable ? (
                <span className="text-destructive">Unavailable</span>
              ) : (
                <Money amount={a.outstandingBalance} />
              ),
            },
            {
              icon: '◔',
              label: 'Payment Status',
              value: (
                <StatusBadge
                  label={PAYMENT_LABEL[detail.paymentStatus]}
                  tone={PAYMENT_TONE[detail.paymentStatus]}
                />
              ),
            },
          ]}
        />

        {/* ---- Stage actions + Payment + Cancel (standardized cards) ------ */}
        <OrderActionsBar detail={detail} section={section} onRefresh={onRefresh} />

        {/* Tab bar — horizontally scrollable on mobile; never navigates. Hidden
            entirely when a section has only one tab: a single tab is a label, not
            a choice, and rendering the bar would just be a strip of dead space. */}
        <div
          role="tablist"
          hidden={tabs.length < 2}
          className="no-print flex gap-1 overflow-x-auto rounded-lg border border-border bg-card/40 p-1"
        >
          {tabs.map(([key, label]) => (
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

        {/* -------------------------------- OVERVIEW ------------------------- */}
        {/* Only the non-duplicate details — the money + customer name already sit
            in the Summary card above, so this shows what that card does not. */}
        <TabPanel active={tab === 'overview'}>
          <div className="space-y-3">
            <Block title="Customer">
              <KV label="Contact">
                {detail.customer.contactNumber ? (
                  <SensitivePhone value={detail.customer.contactNumber} />
                ) : (
                  '—'
                )}
              </KV>
              <KV label="Items">{itemCount}</KV>
              {detail.customer.address ? (
                <KV label="Address" wide>
                  <Sensitive>{detail.customer.address}</Sensitive>
                </KV>
              ) : null}
            </Block>

            {/* The "Order" block (Invoice No. / Created / Admin) was removed from
                every stage's Overview by Owner request — the header already shows
                the order and invoice, so it was duplicate. Completion attribution
                stays, since nothing else surfaces it. */}
            {detail.completedByName ? (
              <Block title="Completion">
                <KV label="Completed by" wide>
                  {detail.completedByName}
                  {detail.completedAt ? ` · ${fmtDateTime(detail.completedAt)}` : ''}
                </KV>
              </Block>
            ) : null}

            {a.unavailable ? (
              <div className="rounded-lg border border-border p-3 text-sm" role="alert">
                <p className="font-semibold text-destructive">Balance unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">{a.unavailable}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This is <strong>not</strong> a zero balance.
                </p>
              </div>
            ) : null}

            {detail.paymentHistory.length > 0 ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment history
                </p>
                <div className="overflow-x-auto">
                  <table
                    className="data-table w-full min-w-[420px] text-left text-xs"
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

            {/* Fulfillment summary was REMOVED from every Order View modal by
                Owner request (§9). The underlying fulfillment records and workflow
                are untouched — only this read-out is gone. */}
          </div>
        </TabPanel>

        {/* --------------------------------- ITEMS -------------------------- */}
        <TabPanel active={tab === 'detail'}>
          <div className="space-y-4">
          {detail.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No line items found for this order.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="data-table w-full min-w-[540px] text-left text-xs"
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

          {/* ------------------------------ HISTORY ------------------------- */}
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
          </div>
        </TabPanel>
      </div>
    </>
  );
}

/**
 * The actions row shared by every stage (§7, §10).
 *
 * Grouped at the top, ordered forward-first with the destructive action last and
 * visually separated. What appears is decided ENTIRELY by the shared stage table
 * plus each action's own guard — there is no `status === …` branch here, which is
 * the whole point of centralising it.
 */
function OrderActionsBar({
  detail,
  section,
  onRefresh,
}: {
  detail: OrderDetail;
  section: string;
  onRefresh: () => void;
}) {
  const a = detail.amounts;
  const balanceUnavailable = a.unavailable !== null;

  // Transfer to Destination is offered when the stage allows it, AND always in the
  // Pending Payment view so the operator can MANUALLY set the destination there
  // (Owner request) — adding a payment only updates the money, never the routing.
  const showTransfer =
    (stageOffers(detail.status, 'transfer_destination') || section === 'unverified_pay') &&
    detail.permissions.canPrepareFulfillment;

  // Ship Confirm (release approved): shows a Waybill Number field first, and now
  // also the Transfer to Destination dropdown (Owner request), plus Transfer to
  // Completed and Cancel Order.
  const isShipConfirm =
    detail.status === 'approved_for_release' ||
    detail.status === 'exceptional_release_pending';

  // Unverified, still-live payment records — these are what Verify Payment acts on.
  // A payment added through Add Payment is auto-verified, so this is usually empty
  // until evidence is recorded elsewhere. Never offered once fully paid.
  const unverifiedPayments = detail.paymentHistory.filter(
    (p) => p.status !== 'verified' && !p.voided && !p.reversed,
  );
  const showVerify =
    detail.permissions.canRecordPayment &&
    !a.paidInFull &&
    unverifiedPayments.length > 0;

  return (
    <div className="no-print space-y-3">
      {/* Actions card — the forward workflow for this stage. */}
      <SectionCard
        icon="◈"
        title="Actions"
        subtitle="Move this order forward in its workflow."
      >
        <div className="space-y-2">
          {/* Ship Confirm shows the Waybill Number first — a shipping order can't
              complete without it. */}
          {isShipConfirm ? (
            <OrderWaybillField
              orderId={detail.officialOrderId}
              waybill={detail.waybillNumber}
              canEdit={detail.permissions.canReleaseFulfillment}
              onSaved={onRefresh}
            />
          ) : null}

          {/* Owner: the reminder / Confirm-for-Preparation / For-Prepare workflow steps
              are removed — an order is routed with "Transfer to Destination" (below)
              instead, from whatever stage it is in. */}

          {/* For Layaway — "Set Up Layaway": a fill-up popup that creates a layaway
              account from this order's customer + total + grams (Owner request). On
              Save the order leaves the For Layaway card and is tracked in the Layaway
              ledger, so the button is hidden once it has been converted. */}
          {detail.convertedToLayaway ? (
            <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
              This order was set up as a Layaway — it now lives in Payments & Layaway.
            </p>
          ) : detail.status === 'for_layaway' && detail.permissions.canPrepareFulfillment ? (
            <LayawaySetupForOrder
              orderId={detail.officialOrderId}
              customerName={detail.customer.displayName}
              adminName={detail.adminName}
              itemAmount={a.unavailable ? '0' : a.totalAmountPayable}
              grams={String(
                detail.items.reduce((s, it) => {
                  // Reflect each item's grams; when the stored weight is blank, fall
                  // back to the grams encoded in the item code (e.g. "…2367 0.55g").
                  const per =
                    Number(it.gramsPerPiece) ||
                    Number(parseInventoryCode(it.itemCode ?? '').grams) ||
                    0;
                  return s + per * (it.quantity || 0);
                }, 0) || '',
              )}
              onDone={onRefresh}
            />
          ) : null}

          {/* Done / Transfer to Completed (§5). Renders nothing unless the stage
              offers completion at all. */}
          <OrderCompletionActions
            orderId={detail.officialOrderId}
            status={detail.status}
            paidInFull={a.paidInFull}
            balanceUnavailable={balanceUnavailable}
            canRelease={detail.permissions.canReleaseFulfillment}
            completionBlock={detail.completionBlock}
            onDone={onRefresh}
          />

          {/* Transfer to Destination (§6). Also shown on Ship Confirm (Owner request)
              alongside the Waybill Number, so a shipping order can be routed to a
              destination from the same stage. */}
          {showTransfer ? (
            <OrderDestinationTransfer
              orderId={detail.officialOrderId}
              destination={detail.fulfillmentDestination}
              destinationSetByName={detail.destinationSetByName}
              destinationSetAt={detail.destinationSetAt}
              canTransfer={detail.permissions.canPrepareFulfillment}
              completionBlock={detail.completionBlock}
              onTransferred={onRefresh}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No further workflow action for this stage.
            </p>
          )}
        </div>
      </SectionCard>

      {/* Payment card — now Verify Payment ONLY. Add Payment and Cancel Order
          moved to the modal header (beside the X), so there is no duplicate
          placement here. Rendered only when there is an unverified payment to act
          on; otherwise the card is omitted entirely (no empty container). */}
      {showVerify ? (
        <SectionCard
          icon="▭"
          title="Payment"
          subtitle="Verify a payment recorded against this order."
        >
          <div className="flex flex-wrap items-center gap-2">
            <OrderVerifyPayment
              customerName={detail.customer.displayName}
              orderNumber={detail.orderNumber}
              unverified={unverifiedPayments}
              canVerify={detail.permissions.canRecordPayment}
              onRefresh={onRefresh}
            />
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

export function OrderDetailsModal({
  orderId,
  section = 'all',
  onClose,
  onMutated,
}: {
  orderId: string | null;
  /** The Orders card this was opened from — drives the tab structure (§8).
   *  Defaults to Total so callers outside Orders keep the full tabbed view. */
  section?: string;
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
            <DetailBody
              detail={result.detail}
              section={section}
              onRefresh={refresh}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
