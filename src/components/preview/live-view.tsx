'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  Card,
  PermissionBadge,
  PreviewButton,
  RuleNote,
  SectionTitle,
  StatusBadge,
  selectClass,
} from '@/components/preview/primitives';
import { SAMPLE_SHOPS, type IntegrationState } from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';

const INTEGRATION_TONE: Record<IntegrationState, 'green' | 'amber' | 'red' | 'slate'> = {
  'Not Connected': 'slate',
  'Connected Demo': 'amber',
  'Needs Reauthorization': 'amber',
  'API Access Pending Validation': 'amber',
  'Connection Error': 'red',
};

const STATES: IntegrationState[] = [
  'Not Connected',
  'Connected Demo',
  'Needs Reauthorization',
  'API Access Pending Validation',
  'Connection Error',
];

export function LiveView() {
  const [batchOpen, setBatchOpen] = useState(false);
  // Honest default: nothing is connected, because nothing has been validated.
  const [pancake, setPancake] = useState<IntegrationState>('Not Connected');

  return (
    <>
      <PreviewPageHeader
        title="Live"
        description="Live batch operation, item entry, and capture."
        actions={
          batchOpen ? (
            <PreviewButton variant="outline" onClick={() => setBatchOpen(false)}>
              End Live Batch
            </PreviewButton>
          ) : (
            <PreviewButton onClick={() => setBatchOpen(true)}>
              Open Live Batch
            </PreviewButton>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* Current batch */}
          <Card className="p-4">
            <SectionTitle
              title="Current Live Batch"
              right={
                <StatusBadge
                  label={batchOpen ? 'Active (Live)' : 'No active batch'}
                  tone={batchOpen ? 'green' : 'slate'}
                />
              }
            />
            {batchOpen ? (
              <>
                <p className="mt-2 font-mono text-xs text-slate-500 night:text-slate-400">
                  LB-2026-000014
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <PreviewButton variant="outline" size="sm">
                    + Quick Add Item
                  </PreviewButton>
                  <PreviewButton variant="outline" size="sm">
                    ◉ Set Current Flex Item
                  </PreviewButton>
                  <PreviewButton variant="outline" size="sm">
                    Post-Live Item Entry
                  </PreviewButton>
                  <PreviewButton variant="danger" size="sm">
                    Withdraw Item
                  </PreviewButton>
                </div>

                <div className="mt-3 rounded-lg border border-emerald-200 night:border-emerald-800 bg-emerald-50 night:bg-emerald-950 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 night:text-emerald-300">
                    Current Flex Item
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 night:text-slate-100">
                    RG-18K-004
                  </p>
                  <p className="text-[11px] text-slate-600 night:text-slate-300">
                    3.2 g/pc · ₱12,500/pc · sample item
                  </p>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500 night:text-slate-400">
                No batch is open. Opening a batch never confirms claims or changes
                inventory.
              </p>
            )}
          </Card>

          {/* Manual fallback */}
          <Card className="p-4">
            <SectionTitle
              title="Manual Capture Fallback"
              description="Always available — it never depends on an integration."
              right={<PermissionBadge permission="claim_capture" />}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/preview/new-entry">
                <PreviewButton size="sm">Manual Claim Entry</PreviewButton>
              </Link>
              <PreviewButton size="sm" variant="outline">
                Paste Comment Text
              </PreviewButton>
            </div>
            <RuleNote>
              Manual claim entry and manual customer-message fallback remain available
              whether or not Pancake is connected. No integration is a dependency for
              operating.
            </RuleNote>
          </Card>

          {/* History */}
          <Card className="p-4">
            <SectionTitle title="Live Batch History" />
            <ul className="mt-2 divide-y divide-slate-100 night:divide-slate-800 text-xs">
              {[
                ['LB-2026-000013', 'Closed', '2026-07-12'],
                ['LB-2026-000012', 'Closed', '2026-07-10'],
                ['LB-2026-000011', 'Closed', '2026-07-08'],
              ].map(([ref, state, date]) => (
                <li key={ref} className="flex items-center justify-between gap-2 py-2">
                  <span className="font-mono text-slate-700 night:text-slate-300">
                    {ref}
                  </span>
                  <span className="text-slate-500 night:text-slate-400">{date}</span>
                  <StatusBadge label={state!} tone="slate" />
                </li>
              ))}
            </ul>
            <RuleNote>
              Closing a batch never auto-confirms claims, invoices, creates orders, or
              changes inventory. Reopening a closed batch is an{' '}
              <strong>Owner approval</strong>.
            </RuleNote>
          </Card>
        </div>

        {/* Page + connection rail */}
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle title="Selected Facebook Page" />
            <select className={selectClass + ' mt-2'} defaultValue={SAMPLE_SHOPS[0]}>
              {SAMPLE_SHOPS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-500 night:text-slate-400">
              The Page is read from Pancake. The Owner approves which Page is used.
            </p>
          </Card>

          <Card className="p-4">
            <SectionTitle title="Pancake Connection" />
            <div className="mt-2">
              <StatusBadge label={pancake} tone={INTEGRATION_TONE[pancake]} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-600 night:text-slate-300">
              A.V. Jewelry connects to <strong>Pancake</strong>, and reads the approved{' '}
              <strong>Facebook Page</strong> from it. There is no direct Facebook
              connector.
            </p>
            <div className="mt-3">
              <Link href="/preview/settings/integrations/pancake">
                <PreviewButton variant="outline" size="sm" className="w-full">
                  Manage in Settings → Integrations
                </PreviewButton>
              </Link>
            </div>

            <div className="mt-3 border-t border-slate-100 night:border-slate-800 pt-2.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 night:text-slate-500">
                Prototype: preview each state
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {STATES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setPancake(s)}
                    className="rounded border border-slate-200 night:border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500 night:text-slate-400 hover:bg-slate-50 night:hover:bg-slate-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <RuleNote tone="amber">
            <strong>No real Pancake or Facebook connection exists.</strong> These are
            display states only — no API is called, no token is stored. The integration
            remains unverified until it is actually tested.
          </RuleNote>
        </div>
      </div>
    </>
  );
}
