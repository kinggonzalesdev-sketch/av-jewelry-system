'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { recordScrapSalesAction } from '@/lib/scrap/actions';
import type { ScrapItemInput } from '@/lib/scrap/service';
import { formatPeso } from '@/lib/payments/format';
import { PAYMENT_METHOD_OPTIONS, DEFAULT_PAYMENT_METHOD } from '@/lib/payments/methods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';

/**
 * Record a scrap sale the same way as the Orders "New Entry" flow: one shared Customer
 * Name / Sold On / Note, then one or more pieces added with "＋ Add Item". Per piece the
 * operator picks Material + Karat + Grams + Price Per Gram, and the Amount is
 * AUTO-COMPUTED (grams × per gram) — editable if the settled amount differs. Each piece
 * is saved as its own scrap_sales row so the per-material income totals stay correct.
 */

type Item = {
  material: 'gold' | 'silver';
  karat: string;
  grams: string;
  perGram: string;
  /** Auto-filled from grams × perGram; editable. */
  amount: string;
};

const blankItem = (): Item => ({ material: 'gold', karat: '', grams: '', perGram: '', amount: '' });

/** grams × per-gram → a 2-dp amount string, or '' when either is missing/invalid.
 *  Both come from MoneyInput/number fields as RAW (no commas). */
function computeAmount(grams: string, perGram: string): string {
  const g = Number(grams);
  const p = Number(perGram);
  if (!Number.isFinite(g) || !Number.isFinite(p) || g <= 0 || p < 0 || perGram === '') return '';
  return (Math.round(g * p * 100) / 100).toFixed(2);
}

export function ScrapEntryModal({
  open,
  onClose,
  soldOnDefault,
}: {
  open: boolean;
  onClose: () => void;
  soldOnDefault: string;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState('');
  const [contact, setContact] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [soldOn, setSoldOn] = useState(soldOnDefault);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<Item[]>([blankItem()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<Item>) =>
    setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...next } : it)));

  // Editing grams / per-gram re-auto-fills the amount; editing amount overrides it.
  const setGrams = (i: number, v: string) =>
    patch(i, { grams: v, amount: computeAmount(v, items[i]?.perGram ?? '') });
  const setPerGram = (i: number, v: string) =>
    patch(i, { perGram: v, amount: computeAmount(items[i]?.grams ?? '', v) });

  const total = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  const reset = () => {
    setCustomer('');
    setContact('');
    setPaymentMethod(DEFAULT_PAYMENT_METHOD);
    setSoldOn(soldOnDefault);
    setNote('');
    setItems([blankItem()]);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (pending) return;
    // Client-side guard for a friendly message; the server re-validates every field.
    for (const it of items) {
      if (!(Number(it.grams) > 0)) {
        setError('Each item needs grams greater than zero.');
        return;
      }
      if (!(Number(it.amount) >= 0) || it.amount === '') {
        setError('Each item needs an amount (enter a price per gram, or type the amount).');
        return;
      }
    }
    setPending(true);
    setError(null);
    const payload: {
      buyer: string | null;
      contact: string | null;
      paymentMethod: string | null;
      soldOn: string | null;
      note: string | null;
      items: ScrapItemInput[];
    } = {
      buyer: customer.trim() || null,
      contact: contact.trim() || null,
      paymentMethod: paymentMethod || null,
      soldOn: soldOn || null,
      note: note.trim() || null,
      items: items.map((it) => ({
        material: it.material,
        grams: it.grams,
        amount: it.amount,
        perGram: it.perGram || null,
        karat: it.karat.trim() || null,
      })),
    };
    const res = await recordScrapSalesAction(payload);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    reset();
    onClose();
    router.refresh();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Record scrap sale"
      description="One Customer Name, then add each scrap piece. Amount auto-computes from grams × per gram."
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            data-testid="scrap-entry-save"
          >
            {pending ? 'Recording…' : 'Record scrap sale'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Shared header — Customer Name + Contact Number + Sold On. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="scrap-customer" className="text-xs">
              Customer Name
            </Label>
            <Input
              id="scrap-customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Customer / buyer name"
              autoComplete="off"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="scrap-contact" className="text-xs">
              Contact Number
            </Label>
            <Input
              id="scrap-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="e.g. 0917 123 4567"
              autoComplete="off"
              inputMode="tel"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="scrap-soldon" className="text-xs">
              Sold On Date
            </Label>
            <Input
              id="scrap-soldon"
              type="date"
              value={soldOn}
              onChange={(e) => setSoldOn(e.target.value)}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="scrap-mop" className="text-xs">
              Mode of Payment
            </Label>
            <select
              id="scrap-mop"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Item rows. */}
        <div className="space-y-3">
          {items.map((it, i) => (
            <div
              key={i}
              className="rounded-lg border border-border p-3"
              data-testid={`scrap-item-${i}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Item {i + 1}
                </span>
                {items.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setItems((cur) => cur.filter((_, idx) => idx !== i))}
                    className="text-[11px] font-medium text-destructive hover:underline"
                    data-testid={`scrap-item-remove-${i}`}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor={`scrap-material-${i}`} className="text-xs">
                    Material
                  </Label>
                  <select
                    id={`scrap-material-${i}`}
                    value={it.material}
                    onChange={(e) =>
                      patch(i, { material: e.target.value as 'gold' | 'silver' })
                    }
                    className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  >
                    <option value="gold">Gold</option>
                    <option value="silver">Silver</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor={`scrap-karat-${i}`} className="text-xs">
                    Karat
                  </Label>
                  <Input
                    id={`scrap-karat-${i}`}
                    value={it.karat}
                    onChange={(e) => patch(i, { karat: e.target.value })}
                    placeholder="e.g. 18K / 21K / 925"
                    autoComplete="off"
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label htmlFor={`scrap-grams-${i}`} className="text-xs">
                    Grams
                  </Label>
                  <Input
                    id={`scrap-grams-${i}`}
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={it.grams}
                    onChange={(e) => setGrams(i, e.target.value)}
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label htmlFor={`scrap-pergram-${i}`} className="text-xs">
                    Per Gram (₱)
                  </Label>
                  <MoneyInput
                    id={`scrap-pergram-${i}`}
                    value={it.perGram}
                    onValueChange={(raw) => setPerGram(i, raw)}
                    className="mt-1 h-9"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor={`scrap-amount-${i}`} className="text-xs">
                    Amount (auto = grams × per gram)
                  </Label>
                  <MoneyInput
                    id={`scrap-amount-${i}`}
                    value={it.amount}
                    onValueChange={(raw) => patch(i, { amount: raw })}
                    className="mt-1 h-9"
                    data-testid={`scrap-amount-${i}`}
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setItems((cur) => [...cur, blankItem()])}
            data-testid="scrap-add-item"
          >
            ＋ Add Item
          </Button>
        </div>

        {/* Note + running total. */}
        <div>
          <Label htmlFor="scrap-note" className="text-xs">
            Note (optional)
          </Label>
          <Input
            id="scrap-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoComplete="off"
            className="mt-1 h-9"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {items.length} item{items.length > 1 ? 's' : ''} — Total
          </span>
          <span className="font-semibold tabular-nums" data-testid="scrap-entry-total">
            {formatPeso(String(total))}
          </span>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
