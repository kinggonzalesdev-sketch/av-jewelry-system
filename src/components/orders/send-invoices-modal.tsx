'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  loadInvoiceSendListAction,
  recordBulkInvoiceSendAction,
  sendInvoiceInBulkAction,
  sendReminderInBulkAction,
} from '@/lib/orders/actions';
import type { InvoiceSendList, InvoiceSendRow } from '@/lib/orders/bulk-invoice';
import {
  INVOICE_FILTERS,
  type BulkRowOutcome,
  type InvoiceFilter,
} from '@/lib/orders/bulk-invoice-rules';
import { cn } from '@/lib/utils';

/**
 * Orders → For Invoice → "Send Invoices" (Owner 2026-09-25): select invoice-ready customers and
 * send their invoices (or reminders) in one controlled action. Every row is sent through the
 * individual Send Invoice path on the server, claimed in the database first, a few at a time,
 * and one failure never stops the rest. The list itself comes from the server a page at a time.
 */

/** How many sends run at once: small, to respect Pancake's rate limits. */
const CONCURRENCY = 2;

type Kind = 'invoice' | 'reminder';
type Run = {
  kind: Kind;
  total: number;
  done: number;
  results: Record<string, BulkRowOutcome>;
  finished: boolean;
};

function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sendStateLine(r: InvoiceSendRow): string {
  switch (r.sendState) {
    case 'sent': {
      const at = when(r.sentAt);
      return r.sentManually
        ? `Invoice marked sent${at ? ` ${at}` : ''}`
        : `Invoice sent${at ? ` ${at}` : ''}`;
    }
    case 'failed':
      return 'Not sent · last try failed';
    case 'sending':
      return 'Sending…';
    case 'unconfirmed':
      return 'Send not confirmed';
    default:
      return 'Not sent';
  }
}

export function SendInvoicesModal({
  open,
  onClose,
  onChanged,
  onViewOrder,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a batch so the Orders list refreshes. */
  onChanged: () => void;
  /** Open one order's details (the individual Send Invoice lives there). */
  onViewOrder?: (orderId: string) => void;
}) {
  const [filter, setFilter] = useState<InvoiceFilter>('not_sent');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<InvoiceSendList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ kind: Kind; ids: string[]; names: string[] } | null>(
    null,
  );
  const [run, setRun] = useState<Run | null>(null);
  // Synchronous lock: a double click on Send cannot start a second batch.
  const runningRef = useRef(false);

  const kind: Kind = filter === 'sent' ? 'reminder' : 'invoice';
  const canPick = (r: InvoiceSendRow) =>
    kind === 'invoice' ? r.invoice.eligible : r.reminder.eligible;

  // The list comes from the server for the current filter / search / page; bumping
  // reloadTick re-reads it (after a batch). A reply to an older request is ignored.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadInvoiceSendListAction({ filter, search: query, page })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setList(res.list);
          setLoadError(null);
        } else setLoadError(res.error);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the invoices.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, filter, query, page, reloadTick]);

  // Search waits for a short pause in typing, then starts from page 1.
  useEffect(() => {
    if (search.trim() === query) return;
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search, query]);

  const changeFilter = (f: InvoiceFilter) => {
    setFilter(f);
    setPage(1);
    setSelected(new Set());
  };

  const rows = list?.rows ?? [];
  const pickable = rows.filter(canPick);
  const allPicked = pickable.length > 0 && pickable.every((r) => selected.has(r.orderId));
  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (allPicked) for (const r of pickable) next.delete(r.orderId);
      else for (const r of pickable) next.add(r.orderId);
      return next;
    });
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const askToSend = (k: Kind, ids: string[]) => {
    if (runningRef.current || ids.length === 0) return;
    const names = rows.filter((r) => ids.includes(r.orderId)).map((r) => r.customerName);
    setConfirm({ kind: k, ids, names });
  };

  const start = async () => {
    if (!confirm || runningRef.current) return;
    runningRef.current = true;
    const { kind: k, ids } = confirm;
    setConfirm(null);
    const results: Record<string, BulkRowOutcome> = {};
    setRun({ kind: k, total: ids.length, done: 0, results: {}, finished: false });
    const queue = [...ids];
    const send = k === 'invoice' ? sendInvoiceInBulkAction : sendReminderInBulkAction;
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const orderId = id;
        const outcome = await send(orderId).catch(
          (): BulkRowOutcome => ({ orderId, outcome: 'failed', reason: 'Network error' }),
        );
        results[orderId] = outcome;
        setRun((cur) =>
          cur ? { ...cur, done: cur.done + 1, results: { ...cur.results, [orderId]: outcome } } : cur,
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()));
    const all = Object.values(results);
    const summary = {
      sent: all.filter((r) => r.outcome === 'sent').length,
      failed: all.filter((r) => r.outcome === 'failed').length,
      skipped: all.filter((r) => r.outcome === 'skipped').length,
      kind: k,
    };
    setRun((cur) => (cur ? { ...cur, finished: true } : cur));
    setSelected(new Set());
    runningRef.current = false;
    await recordBulkInvoiceSendAction(summary).catch(() => undefined);
    reload();
    onChanged();
  };

  const running = run !== null && !run.finished;
  const selectedIds = [...selected].filter((id) => rows.some((r) => r.orderId === id && canPick(r)));
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const counts = run
    ? Object.values(run.results).reduce(
        (acc, r) => ({ ...acc, [r.outcome]: acc[r.outcome] + 1 }),
        { sent: 0, failed: 0, skipped: 0 },
      )
    : null;

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {pages > 1 ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || running}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <span className="px-1 tabular-nums">
              {page} / {pages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page >= pages || running}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              Next
            </Button>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={running}>
          Close
        </Button>
        <Button
          type="button"
          onClick={() => askToSend(kind, selectedIds)}
          disabled={running || confirm !== null || selectedIds.length === 0}
          data-testid="send-invoices-send-selected"
        >
          {kind === 'invoice'
            ? `Send Selected${selectedIds.length ? ` (${selectedIds.length})` : ''}`
            : `Send Reminders${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!running) onClose();
      }}
      title="Send Invoices"
      size="lg"
      critical={running}
      footer={footer}
    >
      <div className="space-y-3" data-testid="send-invoices">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer name or item code"
          // Phones: 44px tall with 16px text (iOS zooms into smaller fields); compact from sm up.
          className="h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus:border-gold sm:h-9 sm:text-sm"
          aria-label="Search invoices"
        />
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Invoice filter">
          {INVOICE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => changeFilter(f.key)}
              disabled={running}
              data-testid={`send-invoices-filter-${f.key}`}
              className={cn(
                // tap-44: a 44px hit area on touch screens without enlarging the chip.
                'tap-44 rounded-full border px-2.5 py-1 text-xs font-medium',
                filter === f.key
                  ? 'border-gold bg-gold/15 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {f.label}
              {list ? <span className="ml-1 tabular-nums">{list.counts[f.key]}</span> : null}
            </button>
          ))}
        </div>

        {confirm ? (
          <div
            role="alertdialog"
            aria-label="Confirm send"
            className="space-y-2 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-sm"
            data-testid="send-invoices-confirm-panel"
          >
            <p className="font-semibold">
              {confirm.kind === 'invoice'
                ? `Send invoices to ${confirm.ids.length} customer${confirm.ids.length === 1 ? '' : 's'}?`
                : `Send reminders to ${confirm.ids.length} customer${confirm.ids.length === 1 ? '' : 's'}?`}
            </p>
            <p className="text-xs">
              {confirm.kind === 'invoice'
                ? 'Only eligible and chat-linked invoices will be sent. Each is checked again before it goes out; an invoice already sent is never sent twice.'
                : 'Each reminder uses the Reminder message from Settings and goes to the linked chat. A reminder already sent is never sent twice.'}
            </p>
            {confirm.names.length <= 5 ? (
              <p className="text-xs text-muted-foreground">{confirm.names.join(', ')}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void start()}
                data-testid="send-invoices-confirm"
              >
                {confirm.kind === 'invoice'
                  ? `Send ${confirm.ids.length} Invoice${confirm.ids.length === 1 ? '' : 's'}`
                  : `Send ${confirm.ids.length} Reminder${confirm.ids.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        ) : null}
        {run ? (
          <div
            className="rounded-md border border-border bg-card/60 px-3 py-2 text-xs"
            role="status"
            data-testid="send-invoices-progress"
          >
            {run.finished ? (
              <span>
                {run.kind === 'invoice' ? 'Invoices' : 'Reminders'} — Sent successfully:{' '}
                {counts?.sent ?? 0} · Failed: {counts?.failed ?? 0} · Skipped:{' '}
                {counts?.skipped ?? 0}
              </span>
            ) : (
              <span>
                Sending {Math.min(run.done + 1, run.total)}/{run.total}…
              </span>
            )}
          </div>
        ) : null}

        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : null}

        {pickable.length > 0 ? (
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-0">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 sm:h-4 sm:w-4"
              checked={allPicked}
              onChange={toggleAll}
              disabled={running}
              data-testid="send-invoices-select-all"
            />
            {kind === 'invoice' ? 'Select all eligible' : 'Select all due for a reminder'}
          </label>
        ) : null}

        {list === null && !loadError ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 && list ? (
          <p className="rounded-md border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing here.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => {
              const verdict = kind === 'invoice' ? r.invoice : r.reminder;
              const result = run?.results[r.orderId];
              return (
                <li
                  key={r.orderId}
                  className="rounded-md border border-border bg-card/60 px-3 py-2 text-sm"
                  data-testid={`send-invoices-row-${r.orderId}`}
                >
                  <div className="flex items-start gap-2">
                    {/* Phones: a bigger box with a 44px hit area (tap-44) — the row's main action. */}
                    <label className="tap-44 mt-0.5 flex shrink-0 items-center">
                      <input
                        type="checkbox"
                        className="h-5 w-5 sm:h-4 sm:w-4"
                        checked={selected.has(r.orderId)}
                        disabled={!verdict.eligible || running}
                        onChange={() => toggle(r.orderId)}
                        aria-label={`Select ${r.customerName}`}
                        data-testid={`send-invoices-pick-${r.orderId}`}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{r.customerName}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span>
                          {r.itemCount} confirmed item{r.itemCount === 1 ? '' : 's'}
                        </span>
                        {r.itemCodes.length ? (
                          <span className="break-all">{r.itemCodes.slice(0, 3).join(', ')}</span>
                        ) : null}
                        {r.chat ? (
                          <span className="text-emerald-600">● Chat linked</span>
                        ) : (
                          <span className="text-amber-700">No Facebook link</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs">{sendStateLine(r)}</p>
                      {r.reminderCount > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Reminders sent: {r.reminderCount}
                          {r.lastReminderAt ? ` · last ${when(r.lastReminderAt)}` : ''}
                        </p>
                      ) : null}
                      <p
                        className={cn(
                          'mt-0.5 text-xs font-medium',
                          verdict.eligible ? 'text-emerald-600' : 'text-amber-700',
                        )}
                      >
                        {verdict.eligible
                          ? kind === 'invoice'
                            ? '✓ Available for Invoice'
                            : `✓ Reminder ${r.reminder.nextNumber} available`
                          : verdict.reason}
                      </p>
                      {result ? (
                        <p
                          className={cn(
                            'mt-0.5 text-xs font-semibold',
                            result.outcome === 'sent'
                              ? 'text-emerald-600'
                              : result.outcome === 'failed'
                                ? 'text-destructive'
                                : 'text-muted-foreground',
                          )}
                          data-testid={`send-invoices-result-${r.orderId}`}
                        >
                          {result.outcome === 'sent'
                            ? 'Sent ✓'
                            : result.outcome === 'failed'
                              ? `Failed${result.reason ? ` · ${result.reason}` : ''}`
                              : `Skipped${result.reason ? ` · ${result.reason}` : ''}`}
                        </p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {kind === 'reminder' && r.reminder.eligible ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={running}
                            onClick={() => askToSend('reminder', [r.orderId])}
                            data-testid={`send-invoices-remind-${r.orderId}`}
                          >
                            Send Reminder
                          </Button>
                        ) : null}
                        {onViewOrder ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={running}
                            onClick={() => onViewOrder(r.orderId)}
                          >
                            View
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </Modal>
  );
}
