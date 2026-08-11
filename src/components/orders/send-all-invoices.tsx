'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  loadForInvoiceOrdersAction,
  recordBulkInvoiceSendAction,
  verifyForInvoiceAction,
} from '@/lib/orders/actions';
import type { BulkInvoiceOrder } from '@/lib/orders/for-invoice';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Send All Invoices (Orders → For Invoice). Advances every eligible For-Invoice
 * order to For Reminder — reusing the SAME guarded, idempotent single-send action,
 * so a repeat run can never double-send (only a still-invoiced order moves). Orders
 * without a saved Facebook chat connection are SKIPPED (not moved). The confirm
 * modal shows the plan; processing shows live Sent / Failed / Skipped / Remaining;
 * a summary lists any failures. Each successful send records its date/time/sender.
 */
type Progress = {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  done: boolean;
};

export function SendAllInvoices() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [eligible, setEligible] = useState<BulkInvoiceOrder[]>([]);
  const [skipped, setSkipped] = useState<BulkInvoiceOrder[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failedOrders, setFailedOrders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const openModal = async () => {
    setError(null);
    setProgress(null);
    setFailedOrders([]);
    setEligible([]);
    setSkipped([]);
    setOpen(true);
    setLoading(true);
    try {
      const orders = await loadForInvoiceOrdersAction();
      setEligible(orders.filter((o) => o.hasChat));
      setSkipped(orders.filter((o) => !o.hasChat));
    } catch {
      setError('Could not load the For Invoice orders.');
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    if (processing || eligible.length === 0) return;
    setProcessing(true);
    setError(null);
    let sent = 0;
    let failed = 0;
    const fails: string[] = [];
    setProgress({
      sent: 0,
      failed: 0,
      skipped: skipped.length,
      remaining: eligible.length,
      done: false,
    });

    for (let i = 0; i < eligible.length; i++) {
      const o = eligible[i];
      if (!o) continue;
      try {
        const res = await verifyForInvoiceAction(o.orderId);
        if (res.ok) sent += 1;
        else {
          failed += 1;
          fails.push(o.orderNumber);
        }
      } catch {
        failed += 1;
        fails.push(o.orderNumber);
      }
      setProgress({
        sent,
        failed,
        skipped: skipped.length,
        remaining: eligible.length - (i + 1),
        done: false,
      });
    }

    setFailedOrders(fails);
    setProgress({ sent, failed, skipped: skipped.length, remaining: 0, done: true });
    await recordBulkInvoiceSendAction({ sent, failed, skipped: skipped.length });
    setProcessing(false);
    router.refresh();
  };

  const total = eligible.length + skipped.length;

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => void openModal()}
        data-testid="orders-send-all-invoices"
      >
        ✉ Send All Invoices
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!processing) setOpen(false);
        }}
        title="Send All Invoices"
        description="Sends the invoice message to eligible For Invoice orders."
        size="md"
        footer={
          progress?.done ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={processing}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void run()}
                disabled={processing || loading || eligible.length === 0}
                data-testid="orders-send-all-confirm"
              >
                {processing
                  ? 'Sending…'
                  : `Send ${eligible.length} invoice${eligible.length === 1 ? '' : 's'}`}
              </Button>
            </>
          )
        }
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading For Invoice orders…</p>
        ) : progress ? (
          <div className="space-y-3" data-testid="orders-send-all-progress">
            <div className="grid grid-cols-4 gap-2 text-center">
              {(
                [
                  ['Sent', progress.sent, 'text-green-700'],
                  ['Failed', progress.failed, 'text-destructive'],
                  ['Skipped', progress.skipped, 'text-amber-600'],
                  ['Remaining', progress.remaining, 'text-muted-foreground'],
                ] as const
              ).map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-border bg-card p-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
                </div>
              ))}
            </div>
            {progress.done ? (
              <div className="rounded-lg border border-border bg-card p-3 text-sm">
                <p className="font-medium">
                  Done — {progress.sent} sent, {progress.failed} failed,{' '}
                  {progress.skipped} skipped.
                </p>
                {failedOrders.length > 0 ? (
                  <p className="mt-1 text-xs text-destructive">
                    Failed (left in For Invoice): {failedOrders.join(', ')}
                  </p>
                ) : null}
                {progress.skipped > 0 ? (
                  <p className="mt-1 text-xs text-amber-600">
                    Skipped (no Facebook chat):{' '}
                    {skipped.map((s) => s.orderNumber).join(', ')}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sending… please keep this open until it finishes.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm" data-testid="orders-send-all-plan">
            <p>
              <strong>{total}</strong> order{total === 1 ? '' : 's'} currently in For
              Invoice.
            </p>
            <ul className="space-y-1 text-xs">
              <li>
                Eligible to send (has FB chat):{' '}
                <strong className="text-green-700">{eligible.length}</strong>
              </li>
              <li>
                Without a valid chat connection (skipped):{' '}
                <strong className="text-amber-600">{skipped.length}</strong>
              </li>
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Each send uses the saved invoice message + FB connection and records who and
              when. The order stays in For Invoice. Failed or skipped orders are not sent.
            </p>
            {eligible.length === 0 ? (
              <p className="text-xs text-amber-600">
                No eligible orders — add a Facebook chat link to the customer first.
              </p>
            ) : null}
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
