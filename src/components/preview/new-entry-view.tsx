'use client';

import { useState } from 'react';

import {
  Card,
  Field,
  PermissionBadge,
  PreviewButton,
  RuleNote,
  SectionTitle,
  StatusBadge,
  inputClass,
  selectClass,
} from '@/components/preview/primitives';
import { SAMPLE_SHOPS, SAMPLE_STAFF } from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';
import { cn } from '@/lib/utils';

type EntryMode =
  'pending_claim' | 'confirmed_claim' | 'invoice_draft' | 'existing_record';

/**
 * The primary button is DYNAMIC — never one generic "Confirm Order".
 * Each mode does a materially different thing, so each says what it does.
 */
const MODES: Array<{
  key: EntryMode;
  label: string;
  button: string;
  permission: string;
  effect: string;
  tone: 'slate' | 'green' | 'amber' | 'blue';
}> = [
  {
    key: 'pending_claim',
    label: 'Pending Claim',
    button: 'Save Pending Claim',
    permission: 'claim_capture',
    effect: 'Creates NO reservation. Capture does not confirm.',
    tone: 'slate',
  },
  {
    key: 'confirmed_claim',
    label: 'Confirmed Claim',
    button: 'Confirm Claim & Print Label',
    permission: 'confirm_claim_print_label',
    effect: 'Reserves the quantity EXACTLY ONCE and queues a label job.',
    tone: 'green',
  },
  {
    key: 'invoice_draft',
    label: 'Invoice Draft Entry',
    button: 'Add to Invoice Draft',
    permission: 'invoice_preparation',
    effect: 'Keeps the existing reservation. No second deduction.',
    tone: 'blue',
  },
  {
    key: 'existing_record',
    label: 'Existing Record / Migration',
    button: 'Save Existing Record',
    permission: 'existing_record_entry',
    effect: 'Enters a historical record at its actual status. Creates no fake claim.',
    tone: 'amber',
  },
];

function PhotoControls() {
  const [state, setState] = useState<
    'empty' | 'captured' | 'uploading' | 'failed' | 'done'
  >('empty');
  const [progress, setProgress] = useState(0);

  const simulateUpload = (fail = false) => {
    setState('uploading');
    setProgress(0);
    let p = 0;
    const timer = setInterval(() => {
      p += 20;
      setProgress(p);
      if (p >= 100) {
        clearInterval(timer);
        setState(fail ? 'failed' : 'done');
      }
    }, 120);
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex aspect-[4/3] w-full items-center justify-center rounded-lg border-2 border-dashed text-center',
          state === 'empty'
            ? 'border-slate-300 night:border-slate-600 bg-slate-50 night:bg-slate-800'
            : 'border-emerald-300 night:border-emerald-700 bg-emerald-50 night:bg-emerald-950',
        )}
      >
        {state === 'empty' ? (
          <div className="px-4">
            <p
              className="text-3xl text-slate-300 night:text-slate-600"
              aria-hidden="true"
            >
              ⛶
            </p>
            <p className="mt-1 text-xs font-medium text-slate-600 night:text-slate-300">
              Item photo required
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 night:text-slate-400">
              Normal jewelry workflow cannot be saved without a photo
            </p>
          </div>
        ) : (
          <div className="px-4">
            <p className="text-3xl text-emerald-500" aria-hidden="true">
              ▩
            </p>
            <p className="mt-1 text-xs font-medium text-emerald-800 night:text-emerald-300">
              Sample photo captured (not a real image)
            </p>
          </div>
        )}
      </div>

      {state === 'uploading' ? (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500 night:text-slate-400">
            Uploading… {progress}%
          </p>
        </div>
      ) : null}

      {state === 'failed' ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 night:border-rose-800 bg-rose-50 night:bg-rose-950 px-2.5 py-2">
          <p className="text-[11px] font-medium text-rose-800 night:text-rose-200">
            Upload failed
          </p>
          <PreviewButton
            size="sm"
            variant="outline"
            onClick={() => simulateUpload(false)}
          >
            Retry Upload
          </PreviewButton>
        </div>
      ) : null}

      {state === 'done' ? <StatusBadge label="Upload complete" tone="green" /> : null}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        <PreviewButton size="sm" variant="outline" onClick={() => setState('captured')}>
          ⛶ Take Photo
        </PreviewButton>
        <PreviewButton size="sm" variant="outline" onClick={() => setState('captured')}>
          ⊞ Gallery
        </PreviewButton>
        <PreviewButton size="sm" variant="outline">
          ⟲ Flip Camera
        </PreviewButton>
        <PreviewButton
          size="sm"
          variant="outline"
          disabled={state === 'empty'}
          onClick={() => setState('captured')}
        >
          Retake
        </PreviewButton>
        <PreviewButton
          size="sm"
          variant="outline"
          disabled={state === 'empty'}
          onClick={() => simulateUpload(false)}
        >
          Upload
        </PreviewButton>
        <PreviewButton
          size="sm"
          variant="danger"
          disabled={state === 'empty'}
          onClick={() => setState('empty')}
        >
          Remove
        </PreviewButton>
      </div>
      <button
        type="button"
        onClick={() => simulateUpload(true)}
        className="text-[10px] text-slate-400 night:text-slate-500 underline hover:text-slate-600"
      >
        (prototype: simulate a failed upload)
      </button>
    </div>
  );
}

export function NewEntryView() {
  const [mode, setMode] = useState<EntryMode>('pending_claim');
  const active = MODES.find((m) => m.key === mode)!;

  return (
    <>
      <PreviewPageHeader
        title="New Entry"
        description="Capture a claim, confirm one, add to a draft, or enter a historical record."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Entry mode */}
          <Card className="p-4">
            <SectionTitle
              title="Entry Mode"
              description="The primary action changes with the mode — there is no generic Confirm Order."
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    mode === m.key
                      ? 'border-emerald-500 bg-emerald-50 night:bg-emerald-950 ring-1 ring-emerald-500'
                      : 'border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 hover:border-slate-300',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 night:text-slate-100">
                      {m.label}
                    </span>
                    <PermissionBadge permission={m.permission} />
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600 night:text-slate-300">
                    {m.effect}
                  </p>
                </button>
              ))}
            </div>
          </Card>

          {/* Fields */}
          <Card className="p-4">
            <SectionTitle title="Entry Details" />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Shop / Page" required>
                <select className={selectClass} defaultValue={SAMPLE_SHOPS[0]}>
                  {SAMPLE_SHOPS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Staff / Salesperson" required>
                <select className={selectClass} defaultValue={SAMPLE_STAFF[0]}>
                  {SAMPLE_STAFF.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Customer Search"
                required
                hint="No automatic merge — a possible duplicate is flagged for review only."
              >
                <input className={inputClass} placeholder="Name or Facebook name…" />
              </Field>
              <Field label="Item Search">
                <input className={inputClass} placeholder="Search items…" />
              </Field>
              <Field label="Item Code" required>
                <input className={inputClass} placeholder="RG-18K-004" />
              </Field>
              <Field label="Grams Per Piece" required>
                <input
                  className={inputClass}
                  type="number"
                  step="0.001"
                  placeholder="0.000"
                />
              </Field>
              <Field label="Quantity" required>
                <input className={inputClass} type="number" min={1} defaultValue={1} />
              </Field>
              <Field label="Total Price Per Piece" required>
                <input
                  className={inputClass}
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes" hint="A note never changes transactional state.">
                  <textarea
                    className={inputClass + ' h-20 py-2'}
                    placeholder="Optional context…"
                  />
                </Field>
              </div>
            </div>
          </Card>

          <RuleNote tone="amber">
            <strong>Capture does not confirm.</strong> Saving a Pending Claim reserves
            nothing. Only <em>Confirm Claim &amp; Print Label</em> reserves inventory, and
            it reserves exactly once. An Official Order is created only at{' '}
            <em>Approve &amp; Send Invoice</em>— never here.
          </RuleNote>
        </div>

        {/* Photo + action rail */}
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle
              title="Item Photo"
              description="Required for normal jewelry workflow."
            />
            <div className="mt-3">
              <PhotoControls />
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-xs font-medium text-slate-500 night:text-slate-400">
              Primary action
            </p>
            <PreviewButton className="mt-2 w-full">{active.button}</PreviewButton>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500 night:text-slate-400">
              {active.effect}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 night:text-slate-400">
                Requires
              </span>
              <PermissionBadge permission={active.permission} />
            </div>

            <div className="mt-4 border-t border-slate-100 night:border-slate-800 pt-3">
              <PreviewButton variant="outline" size="sm" className="w-full">
                ⎙ Reprint Last Label
              </PreviewButton>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 night:text-slate-400">
                  Requires
                </span>
                <PermissionBadge permission="retry_reprint_label" />
              </div>
              <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-slate-500 night:text-slate-400">
                <li>• Creates only a new print attempt</li>
                <li>• Does NOT create a new claim</li>
                <li>• Does NOT create another reservation</li>
                <li>• Does NOT create another Official Order</li>
                <li>• Audit required; reason may be required</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
