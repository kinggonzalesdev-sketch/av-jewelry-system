import Link from 'next/link';

import type { OrderListRow, OrdersResult, PaymentStatus } from '@/lib/orders/service';
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { StatusBadge, ReadError, type BadgeTone } from '@/components/ui/page-primitives';

/**
 * Official Orders list — real, read-only. Every figure is authoritative
 * (getOrderBalance); a failed read shows an explicit error, never an empty
 * table or a zero. Row actions LINK to the workspaces that own them
 * (Invoice / Payments / Fulfillment); nothing here re-implements a guarded
 * action.
 */

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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

function fulfillmentTone(status: string): BadgeTone {
  if (['for_shipping', 'for_pickup'].includes(status)) return 'gold';
  if (['dispatched', 'picked_up', 'completed', 'approved_for_release'].includes(status)) {
    return 'strong';
  }
  if (['held', 'failed_delivery', 'unclaimed_pickup'].includes(status)) return 'warning';
  return 'neutral';
}

function OrderRow({ order }: { order: OrderListRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2.5">
        <StatusBadge label={humanize(order.status)} tone="neutral" />
      </td>
      <td className="px-3 py-2.5 font-mono text-xs">{order.orderNumber}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
        {order.invoiceNumber}
      </td>
      <td className="px-3 py-2.5 font-medium">{order.customerDisplayName}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {order.paymentStatus === 'unavailable'
          ? '—'
          : formatPeso(order.totalAmountPayable)}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge
          label={PAYMENT_LABEL[order.paymentStatus]}
          tone={PAYMENT_TONE[order.paymentStatus]}
        />
        {order.paymentStatus === 'partial' ? (
          <span className="ml-1 text-xs text-muted-foreground">
            {formatPeso(order.outstandingBalance)} due
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        {order.fulfillmentStatus ? (
          <StatusBadge
            label={humanize(order.fulfillmentStatus)}
            tone={fulfillmentTone(order.fulfillmentStatus)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-1.5">
          <Link
            href="/orders/payments"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            Payment
          </Link>
          <Link
            href="/orders/fulfillment"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            Fulfillment
          </Link>
        </div>
      </td>
    </tr>
  );
}

export function OrdersView({ result }: { result: OrdersResult }) {
  if (!result.ok) {
    return <ReadError title="Orders could not be loaded" detail={result.reason} />;
  }

  if (result.rows.length === 0) {
    return (
      <EmptyState
        title="No Official Orders yet"
        description="Approve & Send an Invoice to create the first Official Order."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Scrolls horizontally on narrow screens; the page never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Order No.</th>
              <th className="px-3 py-2 font-medium">Invoice No.</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">Fulfillment</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((order) => (
              <OrderRow key={order.officialOrderId} order={order} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
