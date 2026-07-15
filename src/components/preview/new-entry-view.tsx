'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { PreviewButton, inputClass, selectClass } from '@/components/preview/primitives';
import { SAMPLE_SHOPS, SAMPLE_STAFF } from '@/components/preview/sample-data';
import { cn } from '@/lib/utils';

type EntryMode =
  'pending_claim' | 'confirmed_claim' | 'invoice_draft' | 'existing_record';

/**
 * The primary action is DYNAMIC — never a generic "Confirm Order".
 *
 * The visual reference for this screen says CONFIRM ORDER. That label is
 * deliberately NOT used: New Entry creates no Official Order, and only
 * Approve & Send Invoice does. Each mode names the thing it actually does.
 */
const MODES: Array<{
  key: EntryMode;
  label: string;
  button: string;
  permission: string;
  effect: string;
}> = [
  {
    key: 'pending_claim',
    label: 'Pending Claim',
    button: 'Save Pending Claim',
    permission: 'claim_capture',
    effect: 'Creates no reservation. Capture does not confirm.',
  },
  {
    key: 'confirmed_claim',
    label: 'Confirmed Claim',
    button: 'Confirm Claim & Print Label',
    permission: 'confirm_claim_print_label',
    effect: 'Reserves the quantity exactly once and queues a label job.',
  },
  {
    key: 'invoice_draft',
    label: 'Invoice Draft Entry',
    button: 'Add to Invoice Draft',
    permission: 'invoice_preparation',
    effect: 'Keeps the existing reservation. No second deduction.',
  },
  {
    key: 'existing_record',
    label: 'Existing Record / Migration',
    button: 'Save Existing Record',
    permission: 'existing_record_entry',
    effect: 'Enters a historical record at its actual status. Creates no fake claim.',
  },
];

/**
 * The signed-in session. Shop and salesperson are auto-filled from it.
 *
 * Changing either is permission-gated: the fields stay visible and readable,
 * but a staff member without the permission cannot silently re-attribute an
 * entry to another shop or another salesperson.
 */
const SESSION = {
  shop: SAMPLE_SHOPS[0],
  salesperson: SAMPLE_STAFF[0],
  canChangeShop: true, // change_entry_shop
  canChangeSalesperson: true, // change_entry_salesperson
};

/** Small uppercase label, matching the compact reference. */
function L({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 night:text-slate-400">
      {children}
      {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
    </span>
  );
}

/**
 * Photo attachment.
 *
 * Technical upload controls (progress, retry, explicit Upload) stay hidden
 * unless something actually fails — a salesperson mid-Live should see a
 * picture, not a transfer dialog.
 */
function PhotoAttachment() {
  const [state, setState] = useState<'empty' | 'camera' | 'selected'>('empty');
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const pick = (from: string) => {
    setSource(from);
    setState('selected');
    setFailed(false);
  };

  return (
    <div>
      <L required>Photo Attachment</L>

      {/* Live camera — Cancel, Flip, and a single large shutter. */}
      {state === 'camera' ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-emerald-500 bg-black">
          <button
            type="button"
            onClick={() => setState('empty')}
            className="absolute left-2 top-2 rounded-md bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            className="absolute right-2 top-2 rounded-md bg-white/85 px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-white"
          >
            ⟲ Flip
          </button>
          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11px] text-slate-400">
            Prototype camera — no real capture
          </p>
          <button
            type="button"
            aria-label="Take photo"
            onClick={() => pick('Camera')}
            className="absolute bottom-3 left-1/2 h-11 w-11 -translate-x-1/2 rounded-full border-[3px] border-white bg-emerald-500 hover:bg-emerald-400"
          />
        </div>
      ) : state === 'selected' ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border-2 border-emerald-300 night:border-emerald-700 bg-emerald-50 night:bg-emerald-950">
          <div className="flex h-full flex-col items-center justify-center">
            <p className="text-3xl text-emerald-500" aria-hidden="true">
              ▩
            </p>
            <p className="mt-1 text-[11px] font-medium text-emerald-800 night:text-emerald-300">
              Photo preview — sample, from {source}
            </p>
          </div>
          <div className="absolute inset-x-2 bottom-2 flex gap-1.5">
            <PreviewButton
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setState('camera')}
            >
              ⟲ Retake
            </PreviewButton>
            <PreviewButton
              size="sm"
              variant="danger"
              className="flex-1"
              onClick={() => {
                setState('empty');
                setSource(null);
              }}
            >
              Remove
            </PreviewButton>
          </div>
        </div>
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 night:border-slate-600 bg-slate-50 night:bg-slate-800">
          <p className="text-2xl text-slate-300 night:text-slate-600" aria-hidden="true">
            ⛶
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-600 night:text-slate-300">
            Item photo required
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-1.5 px-2">
            <PreviewButton size="sm" variant="outline" onClick={() => setState('camera')}>
              ⛶ Use Camera
            </PreviewButton>
            <PreviewButton size="sm" variant="outline" onClick={() => pick('Gallery')}>
              ⊞ Open Gallery
            </PreviewButton>
            <PreviewButton
              size="sm"
              variant="outline"
              onClick={() => pick('Latest photo')}
            >
              ⭱ Load Latest
            </PreviewButton>
          </div>
        </div>
      )}

      {/* Technical controls surface ONLY on a real failure. */}
      {failed ? (
        <div className="mt-2 rounded-lg border border-rose-200 night:border-rose-800 bg-rose-50 night:bg-rose-950 px-2.5 py-2">
          <p className="text-[11px] font-medium text-rose-800 night:text-rose-200">
            Photo could not be attached.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <PreviewButton size="sm" variant="outline" onClick={() => pick('Retry')}>
              Retry
            </PreviewButton>
            <PreviewButton size="sm" variant="outline" onClick={() => pick('Gallery')}>
              Choose another file
            </PreviewButton>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setFailed(true);
          setState('empty');
        }}
        className="mt-1.5 text-[10px] text-slate-400 night:text-slate-500 underline hover:text-slate-600 night:hover:text-slate-300"
      >
        (prototype: simulate an attachment error)
      </button>
    </div>
  );
}

/** Everything not needed on a normal capture. Collapsed, and quiet. */
function MoreDetails({
  mode,
  setMode,
}: {
  mode: EntryMode;
  setMode: (m: EntryMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = MODES.find((m) => m.key === mode)!;

  return (
    <div className="border-t border-slate-100 night:border-slate-800 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-medium text-slate-600 night:text-slate-300">
          More Details
          <span className="ml-1.5 font-normal text-slate-400 night:text-slate-500">
            {active.label}
          </span>
        </span>
        <span
          className="text-[10px] text-slate-400 night:text-slate-500"
          aria-hidden="true"
        >
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <L>Entry Mode</L>
            <select
              className={selectClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as EntryMode)}
            >
              {MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <L>Item Code</L>
              <input className={inputClass} placeholder="RG-18K-004" />
            </label>
            <label className="block">
              <L>Grams Per Piece</L>
              <input
                className={inputClass}
                type="number"
                step="0.001"
                placeholder="0.000"
              />
            </label>
            <label className="block">
              <L>Payment Arrangement</L>
              <select className={selectClass} defaultValue="Full Payment">
                <option>Full Payment</option>
                <option>Layaway</option>
                <option>Deposit</option>
              </select>
            </label>
            <label className="block">
              <L>Fulfillment Arrangement</L>
              <select className={selectClass} defaultValue="Shipping">
                <option>Shipping</option>
                <option>Pickup</option>
              </select>
            </label>
          </div>

          <label className="block">
            <L>Notes</L>
            <textarea
              className={inputClass + ' h-16 py-2'}
              placeholder="A note never changes transactional state."
            />
          </label>

          <div className="rounded-lg border border-amber-200 night:border-amber-800 bg-amber-50 night:bg-amber-950 p-2.5">
            <L>Existing Record / Migration</L>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                type="date"
                aria-label="Original record date"
                disabled={mode !== 'existing_record'}
              />
              <select
                className={selectClass}
                aria-label="Actual historical status"
                disabled={mode !== 'existing_record'}
              >
                <option>Paid in Full</option>
                <option>Active Layaway</option>
                <option>Deposit Verified</option>
                <option>Fulfilled</option>
              </select>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-amber-800 night:text-amber-300">
              Migrated values and dates are preserved as recorded. No retroactive deposit
              rule, no fake claim.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NewEntryView() {
  const [mode, setMode] = useState<EntryMode>('pending_claim');
  const active = MODES.find((m) => m.key === mode)!;

  return (
    /*
      Compact modal, mobile-first — deliberately NOT a full admin form.
      Fields only, one divider, one primary action.
    */
    <div className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 night:border-slate-800 px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <h1 className="text-xs font-bold uppercase tracking-wide text-slate-900 night:text-slate-100">
              New Entry
            </h1>
          </span>
          <Link
            href="/preview/orders"
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 night:border-slate-700 text-xs text-slate-400 night:text-slate-500 hover:bg-slate-50 night:hover:bg-slate-800"
          >
            ✕
          </Link>
        </div>

        {/* Body */}
        {/*
          Tighter side padding on phones so the paired Shop / Salesperson
          selects keep their full value readable rather than clipping.
        */}
        <div className="space-y-3 px-3 py-4 sm:px-4">
          {/*
            Shop and salesperson stay visible at the top, side by side, and
            stack only on very narrow phones.
          */}
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            <label className="block">
              <L required>Shop Name</L>
              <select
                className={selectClass}
                defaultValue={SESSION.shop}
                disabled={!SESSION.canChangeShop}
                title={
                  SESSION.canChangeShop
                    ? undefined
                    : 'Changing the shop requires the change_entry_shop permission.'
                }
              >
                {SAMPLE_SHOPS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <L required>Salesperson</L>
              <select
                className={selectClass}
                defaultValue={SESSION.salesperson}
                disabled={!SESSION.canChangeSalesperson}
                title={
                  SESSION.canChangeSalesperson
                    ? undefined
                    : 'Changing the salesperson requires the change_entry_salesperson permission.'
                }
              >
                {SAMPLE_STAFF.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-[10px] text-slate-400 night:text-slate-500">
            Auto-filled from your session. Changing either requires permission.
          </p>

          <hr className="border-slate-100 night:border-slate-800" />

          <label className="block">
            <L required>Customer</L>
            <input className={inputClass} placeholder="Search customers…" />
          </label>

          <label className="block">
            <L required>Item Name</L>
            <input className={inputClass} placeholder="Search products…" />
          </label>

          {/* Unit Price and Quantity side by side while they stay readable. */}
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[1fr_88px]">
            <label className="block">
              <L required>Unit Price</L>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-emerald-600"
                  aria-hidden="true"
                >
                  ₱
                </span>
                <input
                  className={inputClass + ' pl-7'}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                />
              </div>
            </label>
            <label className="block">
              <L required>Qty</L>
              <input className={inputClass} type="number" min={1} defaultValue={1} />
            </label>
          </div>

          <PhotoAttachment />

          <MoreDetails mode={mode} setMode={setMode} />
        </div>

        {/* Footer: Reprint Last at the lower left, one large primary action. */}
        <div className="border-t border-slate-100 night:border-slate-800 bg-slate-50 night:bg-slate-800 px-4 py-3">
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              title="Creates only a new print attempt. Does NOT create a new claim, does NOT create another reservation, and does NOT create another Official Order."
              className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-300 night:border-slate-600 bg-white night:bg-slate-900 py-1.5 text-slate-600 night:text-slate-300 hover:bg-slate-50 night:hover:bg-slate-800"
            >
              <span aria-hidden="true">⎙</span>
              <span className="text-[9px] font-semibold uppercase leading-tight">
                Reprint Last
              </span>
            </button>

            <PreviewButton
              className={cn(
                'h-auto min-h-[44px] flex-1 text-sm font-bold uppercase tracking-wide',
              )}
            >
              {active.button}
            </PreviewButton>
          </div>

          <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-500 night:text-slate-400">
            {active.effect} An Official Order is created only at Approve &amp; Send
            Invoice.
          </p>
        </div>
      </div>
    </div>
  );
}
