'use client';

import { useState } from 'react';

import { listRecentActivityAction } from '@/lib/live/live-ops-actions';
import type { ActivityRow } from '@/lib/live/activity-types';
import { Button } from '@/components/ui/button';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/** Humanise "layaway_ledger.add_payment" → "Layaway ledger add payment". */
function humanise(v: string): string {
  return v
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function outcomeClass(outcome: string): string {
  const o = outcome.toLowerCase();
  if (
    o.includes('fail') ||
    o.includes('denied') ||
    o.includes('error') ||
    o.includes('block')
  ) {
    return 'bg-destructive/10 text-destructive';
  }
  if (o.includes('success') || o.includes('ok') || o.includes('complete')) {
    return 'bg-green-600/10 text-green-700';
  }
  return 'bg-muted text-muted-foreground';
}

/**
 * Recent Activity (Live Operations). A read-only window on the audit trail — the
 * latest actions with who did them, on what, the outcome and time — so during a live
 * the Super Admin can watch what is happening and spot anything unexpected in one
 * place. Append-only and RLS-scoped; the audit context payload is never surfaced.
 */
export function RecentActivityPanel() {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Collapsed by default — the log is long and only needed on demand, so it no longer
  // clutters the page and no longer fetches 100 rows on every page load.
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setFailed(false);
    return listRecentActivityAction()
      .then((data) => {
        setRows(data);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null) void load(); // lazy-load the first time it is opened
  };

  return (
    <div className="space-y-3" data-testid="recent-activity-panel">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        data-testid="recent-activity-toggle"
        className="flex w-full items-center justify-between rounded-md border border-border bg-card/50 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="font-medium">
          {open ? 'Hide activity log' : 'Show activity log'}
          {rows ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length === 0 ? 'no activity yet' : `latest ${rows.length}`}
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              data-testid="recent-activity-refresh"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
          </div>

          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              The activity log could not be read.
            </p>
          ) : null}

          {rows && rows.length === 0 && !loading ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="recent-activity-empty"
            >
              No recorded activity yet.
            </p>
          ) : null}

          {rows && rows.length > 0 ? (
            <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium">{humanise(r.action)}</span>
                  <span className="text-muted-foreground">
                    · {humanise(r.entityType)}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${outcomeClass(
                      r.outcome,
                    )}`}
                  >
                    {r.outcome}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {r.actorLabel ? `${r.actorLabel} · ` : ''}
                    {fmtWhen(r.occurredAt)}
                  </span>
                  {r.reason ? (
                    <span className="w-full text-[10px] text-muted-foreground">
                      {r.reason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
