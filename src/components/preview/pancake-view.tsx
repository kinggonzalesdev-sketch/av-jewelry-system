'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  Card,
  Field,
  OwnerOnlyBadge,
  PreviewButton,
  RuleNote,
  SectionTitle,
  StatusBadge,
  inputClass,
} from '@/components/preview/primitives';
import type { IntegrationState } from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';

const TONE: Record<IntegrationState, 'green' | 'amber' | 'red' | 'slate'> = {
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

export function PancakeView() {
  const [state, setState] = useState<IntegrationState>('Not Connected');

  return (
    <>
      <PreviewPageHeader
        title="Pancake Integration"
        description="Settings → Integrations → Pancake"
        actions={<OwnerOnlyBadge />}
      />

      {/* Architecture — the whole point of this page */}
      <Card className="mb-4 p-4">
        <SectionTitle
          title="How the connection works (V1)"
          description="Pancake-first. There is no direct Facebook connector."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {[
            'Facebook Page',
            'connected inside Pancake',
            'MineFlow connects to Pancake',
            'MineFlow reads the approved Page',
          ].map((node, i, arr) => (
            <span key={node} className="flex items-center gap-2">
              <span className="rounded-lg border border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 px-2.5 py-1.5 font-medium text-slate-700 night:text-slate-300">
                {node}
              </span>
              {i < arr.length - 1 ? (
                <span className="text-slate-400 night:text-slate-500">→</span>
              ) : null}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle
              title="Connection"
              right={<StatusBadge label={state} tone={TONE[state]} />}
            />
            <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {[
                ['Connection Status', state],
                ['Pancake Workspace', '—'],
                ['Connected Channel', 'Facebook'],
                ['Facebook Page', '—'],
                ['Default Live Page', '—'],
                ['Last Sync', 'Never'],
                ['API Health', 'Not validated'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-slate-500 night:text-slate-400">{k}</dt>
                  <dd className="text-sm font-medium text-slate-900 night:text-slate-100">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-3">
              <Field label="Connection Notes">
                <textarea
                  className={inputClass + ' h-16 py-2'}
                  placeholder="Notes for the Owner…"
                />
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 night:border-slate-800 pt-3">
              <PreviewButton size="sm">Connect Pancake</PreviewButton>
              <PreviewButton size="sm" variant="outline">
                Test Connection
              </PreviewButton>
              <PreviewButton size="sm" variant="outline">
                Sync Facebook Page
              </PreviewButton>
              <PreviewButton size="sm" variant="outline">
                Reconnect
              </PreviewButton>
              <PreviewButton size="sm" variant="danger">
                Disconnect
              </PreviewButton>
            </div>
            <p className="mt-2 text-[11px] text-slate-500 night:text-slate-400">
              Prototype buttons. No token is requested, no credential is stored, and no
              API is called.
            </p>
          </Card>

          {/* Channels */}
          <Card className="p-4">
            <SectionTitle title="Channels" />
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 night:border-emerald-800 bg-emerald-50 night:bg-emerald-950 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 night:text-slate-100">
                    Facebook
                  </p>
                  <p className="text-[11px] text-slate-600 night:text-slate-300">
                    The only channel in V1, read through Pancake
                  </p>
                </div>
                <StatusBadge label="V1 channel" tone="green" />
              </div>
              <div className="rounded-lg border border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 p-3">
                <p className="text-sm font-medium text-slate-700 night:text-slate-300">
                  Future channels
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 night:text-slate-400">
                  TikTok, Shopee, and Lazada may become available later{' '}
                  <strong>through Pancake</strong>, after a Pancake subscription upgrade
                  and API validation. They are <strong>not</strong> separate connectors
                  and are not offered here.
                </p>
              </div>
            </div>
          </Card>

          {/* Access */}
          <Card className="p-4">
            <SectionTitle title="Who can do what" />
            <ul className="mt-3 divide-y divide-slate-100 night:divide-slate-800 text-xs">
              {[
                [
                  'Owner',
                  'Connect, reconnect, disconnect, approve the Facebook Page',
                  'violet',
                ],
                [
                  'Selected Admin',
                  'Test or sync only, and only with an explicit permission',
                  'slate',
                ],
                ['Staff', 'View and use the approved Page only', 'slate'],
              ].map(([role, can, tone]) => (
                <li key={role} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="shrink-0 font-semibold text-slate-900 night:text-slate-100">
                    {role}
                  </span>
                  <span className="text-right text-slate-600 night:text-slate-300">
                    {can}
                  </span>
                  {tone === 'violet' ? <OwnerOnlyBadge /> : null}
                </li>
              ))}
            </ul>
            <RuleNote>
              Role title is not authority. Even a Selected Admin needs an explicit
              permission, and production re-checks it server-side at execution time.
            </RuleNote>
          </Card>
        </div>

        {/* Rail */}
        <div className="space-y-4">
          <RuleNote tone="amber">
            <strong>This integration does not work yet.</strong> No Pancake or Facebook
            account is connected, no API has been called, and no credential exists. The
            integration remains <strong>unverified until it is actually tested</strong> —
            nothing on this screen should be read as a working connection.
          </RuleNote>

          <Card className="p-4">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 night:text-slate-500">
              Prototype: preview each status
            </p>
            <div className="mt-2 space-y-1">
              {STATES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState(s)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 night:border-slate-700 px-2.5 py-1.5 text-left text-[11px] text-slate-600 night:text-slate-300 hover:bg-slate-50 night:hover:bg-slate-800"
                >
                  {s}
                  <StatusBadge label="preview" tone={TONE[s]} />
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500 night:text-slate-400">
              &quot;Connected Demo&quot; means a demo shape only — never a verified live
              connection.
            </p>
          </Card>

          <Card className="p-4">
            <p className="text-xs font-medium text-slate-700 night:text-slate-300">
              Manual fallback
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500 night:text-slate-400">
              Whether or not Pancake is connected, manual claim entry and manual
              customer-message sending remain available. The business never depends on
              this integration.
            </p>
            <Link href="/preview/live" className="mt-2 block">
              <PreviewButton size="sm" variant="outline" className="w-full">
                Go to Live
              </PreviewButton>
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
