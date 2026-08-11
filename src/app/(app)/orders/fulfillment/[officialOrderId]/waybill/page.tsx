import type { Metadata } from 'next';
import Link from 'next/link';

import { PrintButton } from '@/components/fulfillment/print-button';
import { ReadError } from '@/components/ui/page-primitives';
import { requireActiveStaff } from '@/lib/authz/guard';
import { channelLabel } from '@/lib/fulfillment/format';
import { getWaybill } from '@/lib/fulfillment/waybill';
import { formatPeso } from '@/lib/payments/format';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

/**
 * Printable waybill for one Official Order (#3 deeper). Real, RLS-scoped data;
 * the browser's own print dialog handles the paper (see PrintButton). A COD
 * amount is only shown when it could be read — never a false zero a rider collects.
 */
export default async function WaybillPage({
  params,
}: {
  params: Promise<{ officialOrderId: string }>;
}) {
  await requireActiveStaff();
  const { officialOrderId } = await params;
  const result = await getWaybill(officialOrderId);

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-md p-4">
        <ReadError title="Waybill unavailable" detail={result.reason} />
        <Link
          href="/orders/fulfillment"
          className="mt-4 inline-block text-sm text-gold-strong underline print:hidden"
        >
          ← Back to Fulfillment
        </Link>
      </div>
    );
  }

  const w = result.waybill;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/orders/fulfillment" className="text-sm text-gold-strong underline">
          ← Back to Fulfillment
        </Link>
        <PrintButton />
      </div>

      {/* The waybill sheet. */}
      <div className="rounded-lg border border-border bg-card p-5 text-card-foreground">
        <div className="flex items-start justify-between border-b border-border pb-3">
          <div>
            <div className="text-lg font-semibold tracking-tight">A.V. Jewelry</div>
            <div className="text-xs text-muted-foreground">Dispatch Waybill</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Order
            </div>
            <div className="font-mono text-sm font-semibold">{w.orderNumber}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 py-3">
          <Field label="Recipient" value={w.customerName} />
          <Field label="Contact" value={w.customerContact ?? '—'} />
          <Field label="Invoice" value={w.invoiceNumber ?? '—'} />
          <Field label="Method" value={w.method ? w.method.replace(/_/g, ' ') : '—'} />
          <Field label="Courier" value={w.courier ?? '—'} />
          <Field label="Tracking #" value={w.trackingNumber ?? '—'} />
          <Field label="Collection" value={channelLabel(w.collectionChannel)} />
          <Field
            label="Dispatched"
            value={
              w.dispatchedAt
                ? new Date(w.dispatchedAt).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Not dispatched'
            }
          />
        </div>

        {/* COD box — the amount a rider/LBC collects. Honest when unreadable. */}
        <div className="mt-1 rounded-md border border-border bg-muted/40 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Cash on Delivery
          </div>
          {!w.isCod ? (
            <div className="text-sm font-medium">Not COD — collect nothing.</div>
          ) : w.codAmountUnavailable || w.codAmount === null ? (
            <div className="text-sm font-semibold text-destructive">
              Amount unavailable — verify before collecting.
            </div>
          ) : (
            <div className="text-xl font-bold tabular-nums">
              {formatPeso(w.codAmount)}
            </div>
          )}
        </div>

        <div className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
          Generated{' '}
          {new Date(w.generatedAt).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
          . This waybill reflects the record at generation time.
        </div>
      </div>
    </div>
  );
}
