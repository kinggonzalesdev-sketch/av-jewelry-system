'use client';

import { useCallback, useEffect, useState } from 'react';

import { listLiveErrorsAction } from '@/lib/live/live-ops-actions';
import { resendInvoiceAction } from '@/lib/orders/actions';
import type {
  LiveErrorReport,
  LiveErrorRow,
} from '@/lib/live/error-recovery-types';
import { Button } from '@/components/ui/button';

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Error Recovery Center (Live Operations). Surfaces the failures a live session can
 * hit — an invoice/reminder that failed to auto-send, and a label that failed to
 * print — in one place, with a one-click Retry for the message sends (reusing the
 * order's own Resend action). Prints are recovered by reprinting on the capturing
 * device, so those rows show the reason and guidance rather than a server button.
 */
export function ErrorRecoveryPanel() {
  const [report, setReport] = useState<LiveErrorReport | null>(null);
  // Starts true — the panel auto-loads once on mount. The mount effect below sets
  // state only inside the async callback (never synchronously in the effect body).
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNote(null);
    const res = await listLiveErrorsAction();
    setReport(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    listLiveErrorsAction()
      .then((res) => {
        if (!alive) return;
        setReport(res);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setReport({ ok: false, reason: 'Could not load the error list.' });
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const retry = async (row: LiveErrorRow) => {
    if (!row.orderId || retrying) return;
    setRetrying(row.id);
    setNote(null);
    const res = await resendInvoiceAction(row.orderId);
    setRetrying(null);
    if (!res.ok) {
      setNote(res.error);
      return;
    }
    setNote('Resent through Pancake.');
    void load();
  };

  const total =
    report && report.ok ? report.messages.length + report.prints.length : 0;

  return (
    <div className="space-y-3" data-testid="error-recovery-panel">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          data-testid="error-recovery-refresh"
        >
          {loading ? 'Checking…' : 'Refresh'}
        </Button>
        {report && report.ok ? (
          <span className="text-xs text-muted-foreground">
            {total === 0 ? 'No failures' : `${total} failure(s)`}
          </span>
        ) : null}
      </div>

      {note ? (
        <p role="status" className="text-xs font-medium text-gold-strong" data-testid="error-recovery-note">
          {note}
        </p>
      ) : null}

      {report && !report.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {report.reason}
        </p>
      ) : null}

      {report && report.ok && total === 0 && !loading ? (
        <p
          className="rounded-md border border-green-600/40 bg-green-600/10 px-3 py-2 text-xs text-green-700"
          data-testid="error-recovery-empty"
        >
          ✓ No failures — every message sent and every label printed.
        </p>
      ) : null}

      {report && report.ok && report.messages.length > 0 ? (
        <section data-testid="error-recovery-messages">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
            Failed message sends ({report.messages.length})
          </h3>
          <ul className="space-y-1.5">
            {report.messages.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {row.title}
                    {row.isTest ? (
                      <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                        Test
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{fmtWhen(row.occurredAt)}</p>
                </div>
                {row.orderId ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void retry(row)}
                    disabled={retrying === row.id}
                    data-testid={`error-recovery-retry-${row.id}`}
                  >
                    {retrying === row.id ? 'Sending…' : 'Retry Send'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report && report.ok && report.prints.length > 0 ? (
        <section data-testid="error-recovery-prints">
          <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
            Failed prints ({report.prints.length})
          </h3>
          <ul className="space-y-1.5">
            {report.prints.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-xs"
              >
                <p className="font-medium break-words">
                  {row.title}
                  {row.isTest ? (
                    <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                      Test
                    </span>
                  ) : null}
                </p>
                {row.detail ? (
                  <p className="text-[10px] text-destructive break-words">{row.detail}</p>
                ) : null}
                <p className="text-[10px] text-muted-foreground">
                  {fmtWhen(row.occurredAt)} — reprint from the order on the capturing device.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
