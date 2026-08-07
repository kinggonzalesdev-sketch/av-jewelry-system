'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { deleteScrapSaleAction, updateScrapSaleAction } from '@/lib/scrap/actions';
import type { ScrapSaleRow } from '@/lib/scrap/service';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';

/** A short local date-time, or an honest dash. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** grams × per-gram → a 2-dp amount string, or '' when either is missing/invalid. */
function computeAmount(grams: string, perGram: string): string {
  const g = Number(grams);
  const p = Number(perGram);
  if (!Number.isFinite(g) || !Number.isFinite(p) || g <= 0 || p < 0 || perGram === '') return '';
  return (Math.round(g * p * 100) / 100).toFixed(2);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

type EditState = {
  material: 'gold' | 'silver';
  karat: string;
  grams: string;
  perGram: string;
  amount: string;
  buyer: string;
  soldOn: string;
  note: string;
};

/**
 * View + Edit + Delete for one scrap sale.
 *
 * View is read-only and shows the full record. Edit (Owner / Selected Admin) corrects
 * every field with the amount auto-computing from grams × per gram. Delete is permanent.
 * Both Edit and Delete are re-checked in the database, so hiding the buttons is
 * convenience only; totals refresh from the remaining rows on every read.
 */
export function ScrapRowActions({
  sale,
  canDelete,
  canEdit = false,
}: {
  sale: ScrapSaleRow;
  canDelete: boolean;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [viewing, setViewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  // ---- Edit ----
  const [editing, setEditing] = useState(false);
  const [ed, setEd] = useState<EditState>(() => ({
    material: sale.material,
    karat: sale.karat ?? '',
    grams: sale.grams,
    perGram: sale.perGram ?? '',
    amount: sale.amount,
    buyer: sale.buyer ?? '',
    soldOn: sale.soldOn,
    note: sale.note ?? '',
  }));
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEdit = () => {
    setEd({
      material: sale.material,
      karat: sale.karat ?? '',
      grams: sale.grams,
      perGram: sale.perGram ?? '',
      amount: sale.amount,
      buyer: sale.buyer ?? '',
      soldOn: sale.soldOn,
      note: sale.note ?? '',
    });
    setEditError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (savingEdit) return;
    if (!(Number(ed.grams) > 0)) {
      setEditError('Grams must be greater than zero.');
      return;
    }
    if (ed.amount === '' || !(Number(ed.amount) >= 0)) {
      setEditError('Enter a valid amount.');
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    const res = await updateScrapSaleAction(sale.id, {
      material: ed.material,
      grams: ed.grams,
      amount: ed.amount,
      buyer: ed.buyer.trim() || null,
      karat: ed.karat.trim() || null,
      perGram: ed.perGram || null,
      soldOn: ed.soldOn || null,
      note: ed.note.trim() || null,
    });
    setSavingEdit(false);
    if (!res.ok) {
      setEditError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  };

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
      {canEdit ? (
        <button
          type="button"
          onClick={openEdit}
          data-testid={`scrap-edit-${sale.id}`}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          Edit
        </button>
      ) : null}
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
          <Row label="Customer Name">{sale.buyer ?? '—'}</Row>
          <Row label="Material">
            <span className="capitalize">{sale.material}</span>
          </Row>
          <Row label="Karat">{sale.karat ?? '—'}</Row>
          <Row label="Grams">{sale.grams || '—'}</Row>
          <Row label="Per Gram">{sale.perGram ? formatPeso(sale.perGram) : '—'}</Row>
          <Row label="Amount">{formatPeso(sale.amount)}</Row>
          <Row label="Sold On">{sale.soldOn || '—'}</Row>
          <Row label="Note">{sale.note ?? '—'}</Row>
          <Row label="Date Encoded">{fmtDateTime(sale.encodedAt)}</Row>
          <Row label="Encoded By">{sale.encodedBy ?? '—'}</Row>
        </div>
      </Modal>

      {/* ---- Edit (Owner / Selected Admin) ---- */}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit scrap sale"
        description="Amount auto-computes from grams × per gram; edit it if the settled amount differs."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveEdit()}
              disabled={savingEdit}
              data-testid={`scrap-edit-save-${sale.id}`}
            >
              {savingEdit ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
          <div className="sm:col-span-2">
            <Label htmlFor={`ed-customer-${sale.id}`} className="text-xs">
              Customer Name
            </Label>
            <Input
              id={`ed-customer-${sale.id}`}
              value={ed.buyer}
              onChange={(e) => setEd((s) => ({ ...s, buyer: e.target.value }))}
              autoComplete="off"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor={`ed-material-${sale.id}`} className="text-xs">
              Material
            </Label>
            <select
              id={`ed-material-${sale.id}`}
              value={ed.material}
              onChange={(e) => setEd((s) => ({ ...s, material: e.target.value as 'gold' | 'silver' }))}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
            </select>
          </div>
          <div>
            <Label htmlFor={`ed-karat-${sale.id}`} className="text-xs">
              Karat
            </Label>
            <Input
              id={`ed-karat-${sale.id}`}
              value={ed.karat}
              onChange={(e) => setEd((s) => ({ ...s, karat: e.target.value }))}
              placeholder="e.g. 18K / 21K / 925"
              autoComplete="off"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor={`ed-grams-${sale.id}`} className="text-xs">
              Grams
            </Label>
            <Input
              id={`ed-grams-${sale.id}`}
              type="number"
              step="0.001"
              min="0.001"
              value={ed.grams}
              onChange={(e) =>
                setEd((s) => ({ ...s, grams: e.target.value, amount: computeAmount(e.target.value, s.perGram) || s.amount }))
              }
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor={`ed-pergram-${sale.id}`} className="text-xs">
              Per Gram (₱)
            </Label>
            <MoneyInput
              id={`ed-pergram-${sale.id}`}
              value={ed.perGram}
              onValueChange={(raw) =>
                setEd((s) => ({ ...s, perGram: raw, amount: computeAmount(s.grams, raw) || s.amount }))
              }
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor={`ed-amount-${sale.id}`} className="text-xs">
              Amount (₱)
            </Label>
            <MoneyInput
              id={`ed-amount-${sale.id}`}
              value={ed.amount}
              onValueChange={(raw) => setEd((s) => ({ ...s, amount: raw }))}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor={`ed-soldon-${sale.id}`} className="text-xs">
              Sold On Date
            </Label>
            <Input
              id={`ed-soldon-${sale.id}`}
              type="date"
              value={ed.soldOn}
              onChange={(e) => setEd((s) => ({ ...s, soldOn: e.target.value }))}
              className="mt-1 h-9"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`ed-note-${sale.id}`} className="text-xs">
              Note (optional)
            </Label>
            <Input
              id={`ed-note-${sale.id}`}
              value={ed.note}
              onChange={(e) => setEd((s) => ({ ...s, note: e.target.value }))}
              autoComplete="off"
              className="mt-1 h-9"
            />
          </div>
          {editError ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {editError}
            </p>
          ) : null}
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
