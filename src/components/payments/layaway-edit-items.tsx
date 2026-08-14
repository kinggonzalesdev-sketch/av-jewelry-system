'use client';

import { useState } from 'react';

import {
  addLayawayItemAction,
  addLayawayLedgerPaymentAction,
  removeLayawayItemAction,
  setLayawayTermAction,
  splitLayawayItemToOrderAction,
} from '@/lib/payments/actions';
import type { CaptureItem } from '@/lib/orders/service';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';
import { formatPeso } from '@/lib/payments/format';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
import {
  centavosToStr,
  effectiveGrams,
  perGramTotalCentavos,
  priceCentavos,
  rowTotalCentavos,
} from '@/lib/orders/item-pricing';
import {
  AddItemSearchRow,
  newAddRow,
  pickedGrams,
  type AddRow,
} from '@/components/orders/order-item-edit';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

/**
 * Multi-item layaway editing (Owner request 2026-08-09; New-Entry-style form
 * 2026-08-14). Owner / Selected Admin only (the DB re-checks).
 *
 * The item LIST at the top removes a piece (returns to stock) or splits it into its
 * own new Order. BELOW it is a full New-Entry-style form — the SAME layout as Layaway
 * → New Entry (Term · Items · Monthly Interest · Date Purchased · Remarks · Payment ·
 * totals · No Interest) — but it operates on THIS EXISTING account and NEVER creates a
 * new one. Saving orchestrates only three safe, existing actions in order: add each
 * picked item, set the term (when it changed), then record the payment (when entered).
 * Every figure shown is a client preview; the database recomputes the account's grams →
 * interest → grand total → balance authoritatively on each action.
 */
type Item = LayawayLedgerDetail['items'][number];

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold';

/** Today in the USER'S LOCAL date (never the UTC date, which rolls a day early in PH). */
const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

/** A term is 1, 2 or 3 months; anything else (null / legacy import) defaults to 3. */
const clampTerm = (t: number | null | undefined): 1 | 2 | 3 =>
  t === 1 || t === 2 || t === 3 ? t : 3;

/** Grams as a finite number for the interest base; blank / junk → 0. */
const gramsNum = (v: string | null): number => {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

/** Exact centavos → a NEGATIVE-SAFE display string (centavosToStr is for positive
 *  DB prices only; the previewed balance can go negative on an overpayment). */
function toDisplay(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function LayawayEditItems({
  ledgerId,
  items,
  canManage,
  layawayTerm,
  existingPayment,
  datePurchased,
  remarks,
  interestType,
  onRefresh,
}: {
  ledgerId: string;
  items: Item[];
  canManage: boolean;
  /** The account's current term (1/2/3) — seeds the toggle; null defaults to 3. */
  layawayTerm: number | null;
  /** Total already paid on the account — the base for the previewed balance. */
  existingPayment: string | null;
  /** Prefilled, read-only (no safe action changes it here). */
  datePurchased: string | null;
  /** Financer / remarks — prefilled, read-only (no safe action changes it here). */
  remarks: string | null;
  /** 'zero' ⇒ the account carries No Interest. Read-only here. */
  interestType: string | null;
  onRefresh: () => void;
}) {
  // The toggle seeds from the account's term. `initialTerm` is what the operator sees
  // on open; Save fires the term action ONLY when they move the toggle away from it, so
  // recording a payment or adding an item never silently rewrites the term.
  const initialTerm = clampTerm(layawayTerm);

  // ---- New-Entry-style form state -----------------------------------------
  const [rows, setRows] = useState<AddRow[]>([newAddRow()]);
  const [term, setTerm] = useState<1 | 2 | 3>(initialTerm);
  const [payment, setPayment] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [mop, setMop] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // ---- Remove / Split (item list) -----------------------------------------
  const [target, setTarget] = useState<{ kind: 'remove' | 'split'; item: Item } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  if (!canManage) return null;

  const patch = (key: string, next: Partial<AddRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));
  // Select an item → prefill Fixed price from the catalogue and grams from the item's
  // per-piece weight (like New Entry), so switching to Per Gram already has grams. A null
  // clears the row back to an unpicked, Fixed-price blank.
  const pick = (key: string, item: CaptureItem | null) =>
    patch(key, {
      picked: item,
      priceMode: 'fixed',
      price: item?.unitPrice ?? '',
      perGram: '',
      grams: item?.gramsPerPiece ?? '',
    });

  const pickedRows = rows.filter((r) => r.picked);
  const noInterest = interestType === 'zero';

  // ---- Live preview, exact centavos (the DB recomputes on Save) ------------
  // itemTotal = existing items' amounts + each new picked row's computed total.
  const existingItemC = items.reduce((c, it) => c + priceCentavos(it.itemAmount ?? ''), 0n);
  const newItemC = pickedRows.reduce(
    (c, r) => c + rowTotalCentavos(r, pickedGrams(r.picked)),
    0n,
  );
  const itemTotalC = existingItemC + newItemC;
  // totalGrams = existing items' grams + each new picked row's effective grams. Grams feed
  // interest only; the server recomputes the authoritative figure.
  const totalGrams =
    items.reduce((g, it) => g + gramsNum(it.grams), 0) +
    pickedRows.reduce(
      (g, r) => g + gramsNum(effectiveGrams(r, pickedGrams(r.picked))),
      0,
    );
  const monthlyC =
    noInterest || totalGrams <= 0 ? 0n : perGramTotalCentavos(String(totalGrams), '150');
  const interestC = monthlyC * BigInt(term); // whole term reflected
  const grandC = itemTotalC + interestC;
  const paidC = priceCentavos(existingPayment ?? '') + priceCentavos(payment);
  const balanceC = grandC - paidC;

  const termChanged = term !== initialTerm;
  const paymentCents = priceCentavos(payment);
  const hasPayment = paymentCents > 0n;

  const save = async () => {
    if (saving) return;

    // Validate each picked row's COMPUTED total (Fixed price, or grams × rate) — the exact
    // value it will send. Unpicked rows are skipped.
    for (const r of pickedRows) {
      if (rowTotalCentavos(r, pickedGrams(r.picked)) <= 0n) {
        setError(
          r.priceMode === 'per_gram'
            ? `Enter grams and a price per gram greater than zero for ${r.picked!.itemCode}.`
            : `Enter a price greater than zero for ${r.picked!.itemCode}.`,
        );
        return;
      }
    }

    if (pickedRows.length === 0 && !termChanged && !hasPayment) {
      setError('Nothing to save — add an item, change the term, or enter a payment.');
      return;
    }

    setSaving(true);
    setError(null);

    const added: string[] = [];
    let termSaved = false;
    let paymentSaved = false;

    // Prefix any partial-failure message with what already succeeded (like the Order
    // Add-items panel: each step is its own action, so a later failure never undoes an
    // earlier success).
    const soFar = (): string => {
      const parts: string[] = [];
      if (added.length)
        parts.push(`added ${added.length} item${added.length === 1 ? '' : 's'}`);
      if (termSaved) parts.push(`set the term to ${term} mos`);
      return parts.length ? `Saved so far: ${parts.join(', ')}. ` : '';
    };

    // 1) Items FIRST — send the UI-computed row total as a Fixed price (item_amount = the
    //    exact shown line total). Adding an item seeds the account's item rows, which the
    //    term step below then requires.
    for (const r of pickedRows) {
      const total = centavosToStr(rowTotalCentavos(r, pickedGrams(r.picked)));
      const res = await addLayawayItemAction(ledgerId, r.picked!.id, 'fixed', total);
      if (!res.ok) {
        setSaving(false);
        setError(`${soFar()}${r.picked!.itemCode} could not be added: ${res.error}`);
        return;
      }
      added.push(r.picked!.itemCode);
    }

    // 2) Term — only when the toggle moved. The action requires the account to have item
    //    rows (the DB enforces it); surface its error if the account still has none.
    if (termChanged) {
      const res = await setLayawayTermAction(ledgerId, term);
      if (!res.ok) {
        setSaving(false);
        setError(`${soFar()}The term change failed: ${res.error}`);
        return;
      }
      termSaved = true;
    }

    // 3) Payment — only when an amount was entered. The DB re-checks it never exceeds the
    //    balance and captures the recorder as Received By.
    if (hasPayment) {
      const res = await addLayawayLedgerPaymentAction({
        ledgerId,
        amount: payment.trim(),
        paymentDate: paymentDate || null,
        mop: mop || null,
        reference: null,
      });
      if (!res.ok) {
        setSaving(false);
        setError(`${soFar()}The payment could not be recorded: ${res.error}`);
        return;
      }
      paymentSaved = true;
    }

    setSaving(false);
    setNote(
      `Saved — added ${added.length} item(s)` +
        (termSaved ? `, term set to ${term} mos` : '') +
        (paymentSaved ? ', payment recorded' : '') +
        '.',
    );
    // Reset to one empty item row + clear the payment; term / mop reflect the account
    // again once onRefresh reloads the detail.
    setRows([newAddRow()]);
    setPayment('');
    onRefresh();
  };

  const runRowAction = async () => {
    if (!target?.item.id || busy) return;
    setBusy(true);
    setRowError(null);
    if (target.kind === 'remove') {
      const res = await removeLayawayItemAction(ledgerId, target.item.id);
      setBusy(false);
      if (!res.ok) {
        setRowError(res.error);
        return;
      }
      setNote(
        `Removed ${target.item.itemCode ?? 'the item'} — returned to Active inventory.`,
      );
    } else {
      const res = await splitLayawayItemToOrderAction(ledgerId, target.item.id);
      setBusy(false);
      if (!res.ok) {
        setRowError(res.error);
        return;
      }
      setNote(`Split into new order ${res.orderNumber}.`);
    }
    setTarget(null);
    onRefresh();
  };

  // A real (persisted) item can be removed/split only when the account keeps more
  // than one — the DB enforces the same rule.
  const canEditRows = items.filter((i) => i.id).length > 1;

  return (
    <div className="rounded-lg border border-border p-3" data-testid="layaway-edit-items">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
          Edit Items
        </p>
        <span className="rounded-full bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-strong">
          Owner / Admin
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
        Remove a piece (returns to Active inventory) or split it into its own order above;
        add items, change the term, or record a payment on this account below.
      </p>
      {note ? (
        <p
          className="mb-2 text-xs font-medium text-emerald-600"
          data-testid="layaway-edit-items-note"
        >
          {note}
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={it.id ?? `synth-${i}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{it.itemCode ?? '—'}</span>
              {it.grams ? (
                <span className="text-muted-foreground">{it.grams}g</span>
              ) : null}
              <span className="text-muted-foreground">
                {it.itemAmount ? formatPeso(it.itemAmount) : '—'}
              </span>
            </span>
            {it.id && canEditRows ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRowError(null);
                    setTarget({ kind: 'split', item: it });
                  }}
                  data-testid={`layaway-item-split-${it.id}`}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                >
                  Split to new order
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRowError(null);
                    setTarget({ kind: 'remove', item: it });
                  }}
                  data-testid={`layaway-item-remove-${it.id}`}
                  className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                >
                  Remove
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {/* New-Entry-style form — operates on THIS account, never creates a new one. */}
      <div className="mt-3 space-y-3 rounded-md border border-border/60 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-foreground">Add to this account</p>
          <span className="text-[10px] text-muted-foreground">
            Updates this account — never creates a new one
          </span>
        </div>

        {/* ---- Term ------------------------------------------------------- */}
        <div>
          <L>Term</L>
          <div className="flex h-10 items-center gap-1 rounded-lg border border-border px-1">
            {([1, 2, 3] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTerm(t)}
                data-testid={`layaway-edit-term-${t}`}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-[11px] font-semibold',
                  term === t
                    ? 'bg-gold text-black'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {t} {t === 1 ? 'mo' : 'mos'}
              </button>
            ))}
          </div>
        </div>

        {/* ---- Items (multi, shared row UI + math) ----------------------- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <L>Items</L>
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, newAddRow()])}
              data-testid="layaway-edit-add-row"
              className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
            >
              ＋ Add item
            </button>
          </div>
          {rows.map((r, i) => (
            <AddItemSearchRow
              key={r.key}
              index={i}
              row={r}
              canRemove={rows.length > 1}
              // Keep the historical test id on the first row's search input.
              searchTestId={i === 0 ? 'layaway-add-item-search' : undefined}
              onPick={(item) => pick(r.key, item)}
              onPatch={(next) => patch(r.key, next)}
              onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            />
          ))}
        </div>

        {/* ---- Monthly Interest + Date Purchased ------------------------- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Monthly Interest (Total Grams × ₱150)</L>
            <input
              className={cn(fieldClass, noInterest && 'opacity-60')}
              value={noInterest ? '0% Interest' : formatPeso(toDisplay(monthlyC))}
              readOnly
              data-testid="layaway-edit-interest"
            />
          </label>
          <label className="block">
            <L>Date Purchased</L>
            <input
              type="date"
              className={cn(fieldClass, 'opacity-70')}
              value={datePurchased ?? ''}
              readOnly
              data-testid="layaway-edit-date"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              from account
            </span>
          </label>
        </div>

        {/* ---- Remarks / Financer (read-only, from account) -------------- */}
        <label className="block">
          <L>Remarks / Financer</L>
          <input
            className={cn(fieldClass, 'opacity-70')}
            value={remarks ?? ''}
            readOnly
            placeholder="—"
            data-testid="layaway-edit-remarks"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            from account
          </span>
        </label>

        {/* ---- Payment + Date Payment + Mode of Payment ------------------ */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <label className="block">
            <L>Payment</L>
            <MoneyInput
              className={fieldClass}
              placeholder="0.00"
              value={payment}
              onValueChange={setPayment}
              data-testid="layaway-edit-payment"
            />
          </label>
          <label className="block">
            <L>Date Payment</L>
            <input
              type="date"
              className={fieldClass}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              data-testid="layaway-edit-payment-date"
            />
          </label>
          <label className="block">
            <L>Mode of Payment</L>
            <select
              className={fieldClass}
              value={mop}
              onChange={(e) => setMop(e.target.value)}
              data-testid="layaway-edit-mop"
            >
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ---- Totals preview -------------------------------------------- */}
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm"
          data-testid="layaway-edit-totals"
        >
          <Fig label="Item amount" value={toDisplay(itemTotalC)} testId="layaway-edit-item-amount" />
          <Fig
            label={`Total interest (${term} ${term === 1 ? 'mo' : 'mos'})`}
            value={noInterest ? '0' : toDisplay(interestC)}
            testId="layaway-edit-total-interest"
          />
          <Fig
            label="Current balance"
            value={toDisplay(balanceC)}
            strong
            testId="layaway-edit-balance"
          />
          <Fig
            label="Monthly interest"
            value={noInterest ? '0' : toDisplay(monthlyC)}
            testId="layaway-edit-monthly"
          />
          <Fig label="Grand total" value={toDisplay(grandC)} strong testId="layaway-edit-grand" />
        </dl>

        {/* ---- No Interest — READ-ONLY, reflecting the account ----------- */}
        <div>
          <div
            role="status"
            data-testid="layaway-edit-no-interest"
            aria-label={noInterest ? 'No Interest applied' : 'Per-gram interest applies'}
            className={cn(
              'flex h-10 w-full items-center justify-center rounded-lg border text-sm font-semibold',
              noInterest
                ? 'border-gold bg-gold/20 text-gold-strong'
                : 'border-border text-muted-foreground',
            )}
          >
            {noInterest ? '✓ No Interest — 0% applied' : 'Interest: Grams × ₱150'}
          </div>
          <span className="mt-1 block text-center text-[11px] text-muted-foreground">
            from account — no safe way to change this here yet
          </span>
        </div>

        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={saving}
          data-testid="layaway-edit-items-save"
          className="w-full"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <Modal
        open={target !== null}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        critical
        size="sm"
        title={
          target?.kind === 'remove'
            ? 'Remove item from layaway'
            : 'Split item to a new order'
        }
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            {target?.kind === 'remove' ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void runRowAction()}
                disabled={busy}
                data-testid="layaway-item-edit-confirm"
              >
                {busy ? 'Removing…' : 'Remove item'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void runRowAction()}
                disabled={busy}
                data-testid="layaway-item-edit-confirm"
              >
                {busy ? 'Splitting…' : 'Split to new order'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-mono">{target?.item.itemCode ?? ''}</p>
          {target?.kind === 'remove' ? (
            <p className="text-muted-foreground">
              This piece returns to Active inventory and the layaway&apos;s grams,
              interest, grand total and balance recompute. Payments already made stay on
              the account.
            </p>
          ) : (
            <p className="text-muted-foreground">
              This piece moves to a brand-new For-Invoice order (same customer, unpaid).
              The layaway keeps its other items and all payments; its money recomputes.
            </p>
          )}
          {rowError ? (
            <p role="alert" className="text-sm text-destructive">
              {rowError}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

function Fig({
  label,
  value,
  strong,
  testId,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn('tabular-nums', strong ? 'font-bold' : 'font-medium')}
        {...(testId ? { 'data-testid': testId } : {})}
      >
        {formatPeso(value)}
      </dd>
    </div>
  );
}
