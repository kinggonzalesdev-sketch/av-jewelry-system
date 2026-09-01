'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  Card,
  Field,
  OwnerOnlyBadge,
  PermissionBadge,
  PreviewButton,
  RuleNote,
  SectionTitle,
  StatusBadge,
  inputClass,
  selectClass,
} from '@/components/preview/primitives';
import { PreviewPageHeader } from '@/components/preview/shell';
import { cn } from '@/lib/utils';

const SECTIONS = [
  'Business Profile',
  'Shops / Pages',
  'Invoice Settings',
  'Reminder and Hold Settings',
  'Order Defaults',
  'Sticker and Printing',
  'Feature Toggles',
  'Integrations',
  'Import Records',
  'Data Maintenance',
  'Audit Log',
] as const;

type Section = (typeof SECTIONS)[number];

/** Sections whose settings are business-wide and therefore Owner-only. */
const OWNER_ONLY: Section[] = [
  'Invoice Settings',
  'Reminder and Hold Settings',
  'Sticker and Printing',
  'Integrations',
  'Data Maintenance',
];

function Toggle({
  label,
  description,
  checked,
  locked,
  lockReason,
  onChange,
  badge,
}: {
  label: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  lockReason?: string;
  onChange?: (v: boolean) => void;
  badge?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 night:border-slate-800 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-medium text-slate-900 night:text-slate-100">
            {label}
          </p>
          {locked ? <StatusBadge label="Locked ON" tone="green" /> : null}
          {badge ? <StatusBadge label={badge} tone="amber" /> : null}
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 night:text-slate-400">
          {description}
        </p>
        {locked && lockReason ? (
          <p className="mt-1 text-[11px] font-medium text-emerald-800 night:text-emerald-300">
            {lockReason}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={locked}
        onClick={() => onChange?.(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-emerald-600' : 'bg-slate-300',
          locked && 'cursor-not-allowed opacity-70',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white night:bg-slate-900 transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

function ResetTestDataPanel() {
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const ok = phrase === 'RESET TEST DATA' && reason.trim().length > 0;

  return (
    <div className="rounded-xl border-2 border-rose-300 night:border-rose-700 bg-rose-50 night:bg-rose-950 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-rose-900 night:text-rose-200">
          Reset Test Data
        </p>
        <OwnerOnlyBadge />
        <StatusBadge label="Local / staging only" tone="red" />
        <StatusBadge label="AAL2 required later" tone="amber" />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-rose-900 night:text-rose-200">
        <strong>Destroys all test records in this environment.</strong> This action is
        disabled in production and can never be run there. It is audited.
      </p>
      <div className="mt-3 space-y-2">
        <Field label="Type the confirmation phrase" required>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="RESET TEST DATA"
            className={inputClass}
          />
        </Field>
        <Field label="Reason" required>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being reset?"
            className={inputClass}
          />
        </Field>
        <PreviewButton variant="danger" disabled={!ok} className="w-full">
          {ok ? 'Reset Test Data' : 'Type the phrase and a reason to enable'}
        </PreviewButton>
      </div>
    </div>
  );
}

function ImportPanel({ kind }: { kind: 'Customers' | 'Items' }) {
  return (
    <Card className="p-4">
      <SectionTitle
        title={`Import ${kind}`}
        right={<PermissionBadge permission="existing_record_entry" />}
      />
      <ol className="mt-3 space-y-1.5 text-xs text-slate-600 night:text-slate-300">
        {[
          'Download Template',
          'Upload File',
          'Column Mapping',
          'Preview',
          'Duplicate Warning',
          'Validation Results',
          'Import Results',
        ].map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 night:bg-slate-800 text-[10px] font-semibold text-slate-600 night:text-slate-300">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <PreviewButton size="sm" variant="outline">
          Download Template
        </PreviewButton>
        <PreviewButton size="sm" variant="outline">
          Upload File
        </PreviewButton>
      </div>
      <RuleNote>
        Imports create <strong>no fake claims, reservations, orders, or payments</strong>.
        Records enter at their actual historical status and keep their source.
      </RuleNote>
    </Card>
  );
}

export function SettingsView() {
  const [section, setSection] = useState<Section>('Business Profile');
  const [photoRequired] = useState(true);
  const [trackUnpaid] = useState(true);
  const [openCamera, setOpenCamera] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [usePancake, setUsePancake] = useState(false);

  return (
    <>
      <PreviewPageHeader
        title="Settings"
        description="Business setup and configuration."
      />

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Section list */}
        <Card className="h-fit p-2">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setSection(s)}
                  className={cn(
                    'flex w-full items-center justify-between gap-1.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors',
                    section === s
                      ? 'bg-emerald-50 night:bg-emerald-950 text-emerald-800 night:text-emerald-300'
                      : 'text-slate-600 night:text-slate-300 hover:bg-slate-100 night:hover:bg-slate-800',
                  )}
                >
                  <span className="truncate">{s}</span>
                  {OWNER_ONLY.includes(s) ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
                      title="Owner only"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-slate-100 night:border-slate-800 px-2.5 pt-2 text-[10px] text-slate-400 night:text-slate-500">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-500 align-middle" />
            Owner-only section
          </p>
        </Card>

        <div className="space-y-4">
          {section === 'Business Profile' ? (
            <Card className="p-4">
              <SectionTitle title="Business Profile" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Business Name">
                  <input className={inputClass} defaultValue="A.V. Jewelry" />
                </Field>
                <Field label="Contact Number">
                  <input className={inputClass} placeholder="—" />
                </Field>
                <Field label="Address">
                  <input className={inputClass} placeholder="—" />
                </Field>
                <Field
                  label="Time Zone"
                  hint="Standard remains To be confirmed (Bible §32.16)."
                >
                  <select className={selectClass}>
                    <option>Asia/Manila</option>
                  </select>
                </Field>
              </div>
              <PreviewButton className="mt-3" size="sm">
                Save Changes
              </PreviewButton>
            </Card>
          ) : null}

          {section === 'Shops / Pages' ? (
            <Card className="p-4">
              <SectionTitle
                title="Shops / Pages"
                description="Scope for staff and records."
              />
              <ul className="mt-3 divide-y divide-slate-100 night:divide-slate-800 text-sm">
                {['A.V. Jewelry Main', 'A.V. Jewelry Live 2'].map((s) => (
                  <li key={s} className="flex items-center justify-between gap-2 py-2.5">
                    <span className="text-slate-900 night:text-slate-100">{s}</span>
                    <StatusBadge label="Active" tone="green" />
                  </li>
                ))}
              </ul>
              <PreviewButton className="mt-3" size="sm" variant="outline">
                + Add Shop / Page
              </PreviewButton>
            </Card>
          ) : null}

          {section === 'Invoice Settings' ? (
            <Card className="p-4">
              <SectionTitle title="Invoice Settings" right={<OwnerOnlyBadge />} />
              <div className="mt-3 space-y-3">
                <Field label="Invoice Header">
                  <input
                    className={inputClass}
                    defaultValue="A.V. Jewelry — Official Invoice"
                  />
                </Field>
                <Field label="Invoice Footer">
                  <input
                    className={inputClass}
                    defaultValue="Thank you for your purchase."
                  />
                </Field>
                <Field label="Default Invoice Message">
                  <textarea
                    className={inputClass + ' h-24 py-2'}
                    defaultValue="Hi {customer}, here is your invoice {invoice_number} for {amount}. Please settle within the hold period."
                  />
                </Field>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 night:text-slate-400">
                  Preview
                </p>
                <p className="mt-1 text-xs text-slate-700 night:text-slate-300">
                  Hi Ana Reyes, here is your invoice INV-2026-000088 for ₱12,500. Please
                  settle within the hold period.
                </p>
              </div>
              <PreviewButton className="mt-3" size="sm">
                Save Changes
              </PreviewButton>
              <RuleNote tone="amber">
                New settings affect <strong>future invoices only</strong>. Invoices
                already sent are never rewritten — their content is part of the record.
              </RuleNote>
            </Card>
          ) : null}

          {section === 'Reminder and Hold Settings' ? (
            <Card className="p-4">
              <SectionTitle
                title="Reminder and Hold Settings"
                right={<OwnerOnlyBadge />}
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Days Before First Reminder">
                  <input className={inputClass} type="number" defaultValue={1} />
                </Field>
                <Field label="Days Before Cancellation Review">
                  <input className={inputClass} type="number" defaultValue={3} />
                </Field>
                <Field label="Maximum Reminder Attempts">
                  <input className={inputClass} type="number" defaultValue={3} />
                </Field>
                <Field label="Reminder Interval (days)">
                  <input className={inputClass} type="number" defaultValue={1} />
                </Field>
                <Field label="Reminder Header">
                  <input className={inputClass} placeholder="—" />
                </Field>
                <Field label="Reminder Footer">
                  <input className={inputClass} placeholder="—" />
                </Field>
              </div>
              <div className="mt-3">
                <Toggle
                  label="Automatic Reminder Preparation"
                  description="Prepares reminder drafts. Staff still trigger the send — V1 reminders are staff-triggered."
                  checked={false}
                />
              </div>
              <div className="mt-3 rounded-lg border border-amber-200 night:border-amber-800 bg-amber-50 night:bg-amber-950 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 night:text-amber-200">
                  Approved flow — there is no automatic cancellation
                </p>
                <p className="mt-1.5 text-xs font-medium leading-relaxed text-amber-900 night:text-amber-200">
                  Hold Period Reached → For Cancellation Review → Owner Review → Owner
                  Approval → Execute Cancellation → Returned-to-Stock Review
                </p>
              </div>
            </Card>
          ) : null}

          {section === 'Order Defaults' ? (
            <Card className="p-4">
              <SectionTitle title="Order Defaults" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Default Social Channel">
                  <select className={selectClass}>
                    <option>Facebook</option>
                  </select>
                </Field>
                <Field label="Default Shop / Page">
                  <select className={selectClass}>
                    <option>A.V. Jewelry Main</option>
                    <option>A.V. Jewelry Live 2</option>
                  </select>
                </Field>
                <Field label="Default Item">
                  <input className={inputClass} placeholder="—" />
                </Field>
                <Field label="Sticker Note">
                  <input className={inputClass} placeholder="—" />
                </Field>
                <Field label="Default Payment Arrangement">
                  <select className={selectClass}>
                    <option>Full Payment</option>
                    <option>Layaway</option>
                    <option>Deposit</option>
                  </select>
                </Field>
                <Field label="Default Fulfillment Method">
                  <select className={selectClass}>
                    <option>Shipping</option>
                    <option>Pickup</option>
                  </select>
                </Field>
                <Field label="Default Printer">
                  <select className={selectClass}>
                    <option>None selected</option>
                  </select>
                </Field>
                <Field label="Default Label Size">
                  <select className={selectClass}>
                    <option>40mm × 30mm</option>
                    <option>50mm × 30mm</option>
                  </select>
                </Field>
                <Field label="Default Camera Behavior">
                  <select className={selectClass}>
                    <option>Ask each time</option>
                    <option>Open camera immediately</option>
                  </select>
                </Field>
              </div>
              <PreviewButton className="mt-3" size="sm">
                Save Changes
              </PreviewButton>
            </Card>
          ) : null}

          {section === 'Sticker and Printing' ? (
            <Card className="p-4">
              <SectionTitle title="Sticker and Printing" right={<OwnerOnlyBadge />} />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Label Size">
                  <select className={selectClass}>
                    <option>40mm × 30mm</option>
                  </select>
                </Field>
                <Field label="Sticker Fields">
                  <input
                    className={inputClass}
                    defaultValue="Item code, grams, claim no."
                  />
                </Field>
              </div>
              <RuleNote>
                Printer integration remains <strong>unverified</strong> (Bible §27).
                Manual fallback always remains — a print failure never blocks a Confirmed
                Claim.
              </RuleNote>
            </Card>
          ) : null}

          {section === 'Feature Toggles' ? (
            <Card className="p-4">
              <SectionTitle title="Feature Toggles" />
              <div className="mt-1">
                <Toggle
                  label="Order Form Photo Required"
                  description="Requires an item photo for normal jewelry workflows."
                  checked={photoRequired}
                  locked
                  lockReason="Locked ON — the approved jewelry workflow requires a photo."
                />
                <Toggle
                  label="Track Unpaid Orders"
                  description="Keeps unpaid orders visible for follow-up."
                  checked={trackUnpaid}
                  locked
                  lockReason="Locked ON — unpaid follow-up is core to the approved workflow."
                />
                <Toggle
                  label="Inventory Tracking Mode"
                  description="Reserve-once at Confirmed Claim; commit at Official Order."
                  checked
                  locked
                  lockReason="Locked ON — a core system dependency, not an option."
                />
                <Toggle
                  label="Use Pancake Integration"
                  description="Read the approved Facebook Page through Pancake."
                  checked={usePancake}
                  onChange={setUsePancake}
                  badge="Pending Validation"
                />
                <Toggle
                  label="Open Camera Immediately"
                  description="Skips the picker and opens the camera on New Entry."
                  checked={openCamera}
                  onChange={setOpenCamera}
                />
                <Toggle
                  label="Auto Print"
                  description="Prints the label automatically at Confirm. Requires a ready printer."
                  checked={autoPrint}
                  onChange={setAutoPrint}
                />
              </div>
              <RuleNote>
                Toggles removed on purpose: <strong>Use Meta Main App</strong>,{' '}
                <strong>Use TikTok Main App</strong>, <strong>Shopee</strong>, and{' '}
                <strong>Lazada</strong> direct integrations. V1 connects through Pancake
                only.
              </RuleNote>
            </Card>
          ) : null}

          {section === 'Integrations' ? (
            <Card className="p-4">
              <SectionTitle title="Integrations" right={<OwnerOnlyBadge />} />
              <Link href="/preview/settings/integrations/pancake" className="mt-3 block">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 night:border-slate-700 p-3 transition-colors hover:bg-slate-50 night:hover:bg-slate-800">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 night:text-slate-100">
                      Pancake
                    </p>
                    <p className="text-[11px] text-slate-500 night:text-slate-400">
                      Facebook Page access for Live capture
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge label="Not Connected" tone="slate" />
                    <span className="text-slate-400 night:text-slate-500">›</span>
                  </div>
                </div>
              </Link>
              <RuleNote>
                There is <strong>one</strong> integration in V1. No separate TikTok,
                Shopee, Lazada, or direct Facebook connectors exist.
              </RuleNote>
            </Card>
          ) : null}

          {section === 'Import Records' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ImportPanel kind="Customers" />
              <ImportPanel kind="Items" />
            </div>
          ) : null}

          {section === 'Data Maintenance' ? (
            <div className="space-y-4">
              <Card className="p-4">
                <SectionTitle title="Archive" right={<OwnerOnlyBadge />} />
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 night:border-slate-700 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 night:text-slate-100">
                        Archive Closed Orders
                      </p>
                      <p className="text-[11px] text-slate-500 night:text-slate-400">
                        Hides completed orders from active views. Records are retained.
                      </p>
                    </div>
                    <PreviewButton size="sm" variant="outline">
                      Archive
                    </PreviewButton>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 night:border-slate-700 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 night:text-slate-100">
                        Archive Inactive Customers
                      </p>
                      <p className="text-[11px] text-slate-500 night:text-slate-400">
                        Hides inactive customers. Records and history are retained.
                      </p>
                    </div>
                    <PreviewButton size="sm" variant="outline">
                      Archive
                    </PreviewButton>
                  </div>
                </div>
                <RuleNote tone="amber">
                  There is deliberately no <strong>Clear All Orders</strong> or{' '}
                  <strong>Clear All Customers</strong>. Records are archived, never
                  destroyed — audit attribution must survive.
                </RuleNote>
              </Card>
              <ResetTestDataPanel />
            </div>
          ) : null}

          {section === 'Audit Log' ? (
            <Card className="p-4">
              <SectionTitle
                title="Audit Log"
                right={<PermissionBadge permission="export_data_reports" />}
              />
              <ul className="mt-3 divide-y divide-slate-100 night:divide-slate-800 text-xs">
                {[
                  [
                    '2026-07-14 14:22',
                    'Maria Santos',
                    'claim.confirm',
                    'CLM-2026-000451',
                  ],
                  [
                    '2026-07-14 14:20',
                    'Maria Santos',
                    'claim.capture',
                    'CLM-2026-000451',
                  ],
                  [
                    '2026-07-13 09:05',
                    'Owner',
                    'order.cancel.approved',
                    'INV-2026-000095',
                  ],
                ].map(([when, who, action, entity]) => (
                  <li key={String(when)} className="grid grid-cols-4 gap-2 py-2">
                    <span className="text-slate-500 night:text-slate-400">{when}</span>
                    <span className="font-medium text-slate-900 night:text-slate-100">
                      {who}
                    </span>
                    <span className="font-mono text-slate-600 night:text-slate-300">
                      {action}
                    </span>
                    <span className="font-mono text-slate-500 night:text-slate-400">
                      {entity}
                    </span>
                  </li>
                ))}
              </ul>
              <RuleNote>
                Audit is append-only. Entries cannot be edited or deleted, and attribution
                survives rename and deactivation.
              </RuleNote>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
