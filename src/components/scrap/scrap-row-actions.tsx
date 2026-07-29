'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { deleteScrapSaleAction } from '@/lib/scrap/actions';
import type { ScrapSaleRow } from '@/lib/scrap/service';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/** A short local date-time, or an honest dash. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/**
 * View + Delete for one scrap sale.
 *
 * View is read-only and shows the full record, including Date Encoded and Encoded
 * By — the two facts the table has no room for. Delete is permanent and gated on
 * Owner / Selected Admin in the database, so hiding the button is convenience only.
 * A submit ref blocks a repeat delete, and totals refresh without a page reload
 * because they are summed from the remaining rows on every read.
 */
export function ScrapRowActions({
  sale,
  canDelete,
}: {
  sale: ScrapSaleRow;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [viewing, setViewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const run = async () => {
    if (pending || submittingRef.current || confirm !== 'DELETE') return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await deleteScrapSaleAction(sale.id, confirm);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setViewing(true)}
        data-testid={`scrap-view-${sale.id}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        View
      </button>
      {canDelete ? (
        <button
          type="button"
          onClick={() => {
            setConfirm('');
            setError(null);
            setConfirming(true);
          }}
          data-testid={`scrap-delete-${sale.id}`}
          className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      ) : null}

      {/* ---- View (read-only) ---- */}
      <Modal
        open={viewing}
        onClose={() => setViewing(false)}
        title="Scrap sale"
        description="Read-only record."
        size="sm"
        footer={
          <Button type="button" onClick={() => setViewing(false)}>
            Close
          </Button>
        }
      >
        <div className="text-sm" data-testid="scrap-view-body">
          <Row label="Material">
            <span className="capitalize">{sale.material}</span>
          </Row>
          <Row label="Grams">{sale.grams || '—'}</Row>
          <Row label="Amount">{formatPeso(sale.amount)}</Row>
          <Row label="Buyer">{sale.buyer ?? '—'}</Row>
          <Row label="Sold On">{sale.soldOn || '—'}</Row>
          <Row label="Note">{sale.note ?? '—'}</Row>
          <Row label="Date Encoded">{fmtDateTime(sale.encodedAt)}</Row>
          <Row label="Encoded By">{sale.encodedBy ?? '—'}</Row>
        </div>
      </Modal>

      {/* ---- Delete (permanent) ---- */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        critical
        size="sm"
        title="Permanently delete scrap sale"
        description="This cannot be undone."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run()}
              disabled={pending || confirm !== 'DELETE'}
              data-testid={`scrap-delete-confirm-${sale.id}`}
            >
              {pending ? 'Deleting…' : 'Permanently Delete'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-border p-3 text-sm">
            <Row label="Material">
              <span className="capitalize">{sale.material}</span>
            </Row>
            <Row label="Grams">{sale.grams || '—'}</Row>
            <Row label="Amount">{formatPeso(sale.amount)}</Row>
            <Row label="Sold On">{sale.soldOn || '—'}</Row>
          </div>
          <div>
            <Label htmlFor={`scrap-del-${sale.id}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`scrap-del-${sale.id}`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
