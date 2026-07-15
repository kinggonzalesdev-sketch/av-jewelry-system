'use client';

import { useState } from 'react';

import {
  LAYAWAY_FEE_NOTE,
  LAYAWAY_RULES,
  LAYAWAY_STATUS_TONE,
  SAMPLE_LAYAWAYS,
  type LayawayAccount,
} from '@/components/preview/layaway-data';
import {
  Card,
  OwnerOnlyBadge,
  PermissionBadge,
  PreviewButton,
  RuleNote,
  SampleBadge,
  SectionTitle,
  StatusBadge,
  inputClass,
} from '@/components/preview/primitives';
import { SAMPLE_ORDERS, peso } from '@/components/preview/sample-data';
import { PreviewPageHeader } from '@/components/preview/shell';
import { cn } from '@/lib/utils';

/**
 * PAYMENTS & LAYAWAY workspace.
 *
 * Layaway is deliberately NOT hidden under a generic "Payments" label — it has
 * its own queues, its own Owner-gated forfeiture path, and its own rules.
 */

const TABS = [
  'Payment Verification',
  'Layaway Accounts',
  'Installments',
  'Overdue / Grace Period',
  'Forfeiture Review',
  'Payment History',
] as const;

type Tab = (typeof TABS)[number];

const VERIF_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  Verified: 'green',
  'Evidence Submitted': 'amber',
  Rejected: 'red',
  None: 'slate',
};

/** The approved safe flow — no automatic forfeiture, no automatic stock return. */
function ForfeitureFlow() {
  const steps = [
    'Overdue',
    'Grace Period',
    'Forfeiture Review',
    'Owner Approval',
    'Execute Forfeiture',
    'Returned-to-Stock Review',
  ];
  return (
    <div className="rounded-lg border border-amber-200 night:border-amber-800 bg-amber-50 night:bg-amber-950 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 night:text-amber-200">
        Approved flow — there is no automatic forfeiture
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-medium',
                s === 'Owner Approval'
                  ? 'border-violet-300 night:border-violet-700 bg-violet-100 night:bg-violet-950 text-violet-900 night:text-violet-300'
                  : 'border-amber-300 night:border-amber-700 bg-white night:bg-slate-900 text-amber-900 night:text-amber-200',
              )}
            >
              {s}
            </span>
            {i < steps.length - 1 ? (
              <span className="text-amber-400" aria-hidden="true">
                →
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function RulesPanel() {
  return (
    <Card className="p-4">
      <SectionTitle title="Approved layaway rules" right={<SampleBadge />} />
      <ul className="mt-2.5 grid gap-1.5 text-[11px] text-slate-600 night:text-slate-300 sm:grid-cols-2">
        <li>
          • Minimum <strong>{LAYAWAY_RULES.minimumDownPaymentPercent}%</strong> down
          payment
        </li>
        <li>
          • Maximum <strong>{LAYAWAY_RULES.maximumMonths} months</strong>
        </li>
        <li>
          • Maximum <strong>{LAYAWAY_RULES.maximumGraceDays}-day</strong> grace period
        </li>
        <li>
          • A Layaway <strong>belongs to an Official Order</strong> — it is not another
          order
        </li>
        <li>
          • <strong>Payment evidence and verification stay separate</strong>
        </li>
        <li>
          • <strong>Non-cancellable after deposit</strong>
        </li>
        <li>
          • <strong>Forfeiture requires Owner approval</strong>; no automatic forfeiture
        </li>
        <li>
          • Forfeited items → <strong>Returned-to-Stock Review</strong>; no automatic
          stock return
        </li>
      </ul>
      <RuleNote tone="amber">{LAYAWAY_FEE_NOTE}</RuleNote>
    </Card>
  );
}

function AccountRow({
  account,
  onOpen,
}: {
  account: LayawayAccount;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 p-3 text-left transition-colors hover:bg-slate-50 night:hover:bg-slate-800"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 night:text-slate-100">
            {account.customer}
          </p>
          <p className="truncate font-mono text-[10px] text-slate-500 night:text-slate-400">
            {account.officialOrderNumber} · {account.invoiceNumber}
          </p>
        </div>
        <StatusBadge label={account.status} tone={LAYAWAY_STATUS_TONE[account.status]} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-slate-500 night:text-slate-400">Total</dt>
          <dd className="font-semibold tabular-nums text-slate-900 night:text-slate-100">
            {peso(account.totalOrderAmount)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 night:text-slate-400">Remaining</dt>
          <dd className="font-semibold tabular-nums text-slate-900 night:text-slate-100">
            {peso(account.remainingBalance)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 night:text-slate-400">Due</dt>
          <dd className="text-slate-700 night:text-slate-300">{account.dueDate}</dd>
        </div>
        <div>
          <dt className="text-slate-500 night:text-slate-400">Grace ends</dt>
          <dd className="text-slate-700 night:text-slate-300">
            {account.gracePeriodEnd}
          </dd>
        </div>
      </dl>
    </button>
  );
}

function AccountDetail({ account }: { account: LayawayAccount }) {
  const paidDown = account.downPaymentPaid >= account.requiredDownPayment;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <SectionTitle
            title={account.customer}
            description={`${account.facebookName} · ${account.shop}`}
          />
          <StatusBadge
            label={account.status}
            tone={LAYAWAY_STATUS_TONE[account.status]}
          />
        </div>

        <RuleNote>
          This Layaway{' '}
          <strong>belongs to Official Order {account.officialOrderNumber}</strong>. It is
          not a separate order.
        </RuleNote>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px] sm:grid-cols-3 lg:grid-cols-4">
          {(
            [
              ['Customer', account.customer],
              ['Official Order Number', account.officialOrderNumber],
              ['Invoice Number', account.invoiceNumber],
              ['Item summary', account.itemSummary],
              ['Total Order Amount', peso(account.totalOrderAmount)],
              [
                'Required Down Payment',
                `${peso(account.requiredDownPayment)} (${LAYAWAY_RULES.minimumDownPaymentPercent}%)`,
              ],
              ['Down Payment Paid', peso(account.downPaymentPaid)],
              ['Remaining Balance', peso(account.remainingBalance)],
              ['Start Date', account.startDate],
              ['Due Date', account.dueDate],
              ['Grace Period End', account.gracePeriodEnd],
              [
                'Number of Months',
                `${account.months} of ${LAYAWAY_RULES.maximumMonths} max`,
              ],
              ['Layaway Fee', peso(account.layawayFee)],
              ['Financer', account.financer],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-slate-500 night:text-slate-400">{k}</dt>
              <dd className="font-medium text-slate-900 night:text-slate-100">{v}</dd>
            </div>
          ))}
          <div>
            <dt className="text-slate-500 night:text-slate-400">
              Down Payment Verification
            </dt>
            <dd>
              <StatusBadge
                label={account.downPaymentVerification}
                tone={VERIF_TONE[account.downPaymentVerification] ?? 'slate'}
              />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500 night:text-slate-400">
              Current Layaway Status
            </dt>
            <dd>
              <StatusBadge
                label={account.status}
                tone={LAYAWAY_STATUS_TONE[account.status]}
              />
            </dd>
          </div>
        </dl>

        <RuleNote tone="amber">
          <strong>Layaway Fee shown is a concept, not a rule.</strong> {LAYAWAY_FEE_NOTE}{' '}
          Computed here as ₱150 × {account.itemGrams}g × {account.months} months.
        </RuleNote>

        {paidDown ? (
          <RuleNote tone="amber">
            <strong>Non-cancellable after deposit.</strong> The down payment is verified,
            so this arrangement cannot be cancelled — it can only complete, or reach
            forfeiture through Owner approval.
          </RuleNote>
        ) : null}
      </Card>

      {/* Installment schedule */}
      <Card className="p-4">
        <SectionTitle
          title="Installment Schedule"
          description="Evidence and verification are separate — evidence alone verifies nothing."
          right={<SampleBadge />}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 text-[10px] uppercase text-slate-500 night:text-slate-400">
              <tr>
                <th className="px-2.5 py-2">#</th>
                <th className="px-2.5 py-2">Due date</th>
                <th className="px-2.5 py-2 text-right">Amount due</th>
                <th className="px-2.5 py-2 text-right">Paid</th>
                <th className="px-2.5 py-2">Payment Evidence</th>
                <th className="px-2.5 py-2">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 night:divide-slate-800">
              {account.installments.map((i) => (
                <tr key={i.number}>
                  <td className="px-2.5 py-2 font-semibold text-slate-900 night:text-slate-100">
                    {i.number}
                  </td>
                  <td className="px-2.5 py-2 text-slate-700 night:text-slate-300">
                    {i.dueDate}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-slate-900 night:text-slate-100">
                    {peso(i.amountDue)}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-slate-700 night:text-slate-300">
                    {i.paidAmount === null ? '—' : peso(i.paidAmount)}
                  </td>
                  <td className="px-2.5 py-2">
                    {i.evidence ? (
                      <span className="font-mono text-[10px] text-slate-600 night:text-slate-300">
                        {i.evidence}
                      </span>
                    ) : (
                      <span className="text-slate-400 night:text-slate-500">None</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <StatusBadge
                      label={i.verification}
                      tone={VERIF_TONE[i.verification]!}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Actions */}
      <Card className="p-4">
        <SectionTitle title="Available actions" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          <PreviewButton size="sm" variant="outline">
            Record Payment Evidence
          </PreviewButton>
          <PreviewButton size="sm" variant="outline">
            Verify Payment
          </PreviewButton>
          <PreviewButton size="sm" variant="outline">
            Send Reminder
          </PreviewButton>
          <PreviewButton size="sm" variant="outline">
            View Audit Trail
          </PreviewButton>
          {account.status === 'Forfeiture-Eligible' ? (
            <PreviewButton size="sm" variant="danger">
              Request Forfeiture (Owner approval)
            </PreviewButton>
          ) : null}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500 night:text-slate-400">
            Permissions
          </span>
          <PermissionBadge permission="layaway_monitoring" />
          <PermissionBadge permission="payment_verification" />
          <PermissionBadge permission="initiate_high_risk_action" />
        </div>
        <RuleNote tone="amber">
          There is <strong>no direct Forfeit button</strong>. Requesting forfeiture
          creates an Owner Approval Request and executes nothing. Only the Owner may
          approve it, and the item then goes to <strong>Returned-to-Stock Review</strong>{' '}
          — never straight back to available stock.
        </RuleNote>
      </Card>
    </div>
  );
}

export function PaymentsView() {
  const [tab, setTab] = useState<Tab>('Payment Verification');
  const [openId, setOpenId] = useState<string | null>(null);

  const open = SAMPLE_LAYAWAYS.find((l) => l.id === openId) ?? null;

  const overdue = SAMPLE_LAYAWAYS.filter(
    (l) => l.status === 'Overdue' || l.status === 'Grace Period',
  );
  const eligible = SAMPLE_LAYAWAYS.filter((l) => l.status === 'Forfeiture-Eligible');
  const allInstallments = SAMPLE_LAYAWAYS.flatMap((l) =>
    l.installments.map((i) => ({ account: l, inst: i })),
  );

  return (
    <>
      <PreviewPageHeader
        title="Payments & Layaway"
        description="Payment verification and the full layaway lifecycle."
      />

      <div
        className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 night:border-slate-700 bg-white night:bg-slate-900 p-1"
        role="tablist"
        aria-label="Payments and Layaway tabs"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setOpenId(null);
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 night:text-slate-300 hover:bg-slate-100 night:hover:bg-slate-800',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ---------------- Payment Verification ---------------- */}
      {tab === 'Payment Verification' ? (
        <div className="space-y-4">
          <Card className="p-4">
            <SectionTitle
              title="Payment Verification Queue"
              description="Recording evidence is not verifying it."
              right={<PermissionBadge permission="payment_verification" />}
            />
            <div className="mt-3 space-y-2">
              {SAMPLE_ORDERS.filter((o) => o.paymentState === 'Evidence Submitted').map(
                (o) => (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 night:border-slate-700 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 night:text-slate-100">
                        {o.customer}
                      </p>
                      <p className="truncate font-mono text-[10px] text-slate-500 night:text-slate-400">
                        {o.orderNumber} · {peso(o.amount)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge label="Evidence Submitted" tone="amber" />
                      <PreviewButton size="sm" variant="outline">
                        Review Evidence
                      </PreviewButton>
                      <PreviewButton size="sm">Verify Payment</PreviewButton>
                    </div>
                  </div>
                ),
              )}
            </div>
            <RuleNote tone="amber">
              <strong>Required Payment Verified is not Paid in Full.</strong> Paid in Full
              has no approved definition yet, so no screen claims it. Evidence and
              verification remain separate records.
            </RuleNote>
          </Card>
        </div>
      ) : null}

      {/* ---------------- Layaway Accounts ---------------- */}
      {tab === 'Layaway Accounts' ? (
        <div className="space-y-4">
          {open ? (
            <>
              <PreviewButton size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                ‹ Back to accounts
              </PreviewButton>
              <AccountDetail account={open} />
            </>
          ) : (
            <>
              <Card className="p-3">
                <input
                  className={inputClass}
                  placeholder="Search customer, order number, invoice number…"
                  aria-label="Search layaway accounts"
                />
              </Card>
              <div className="space-y-2">
                {SAMPLE_LAYAWAYS.map((l) => (
                  <AccountRow key={l.id} account={l} onOpen={() => setOpenId(l.id)} />
                ))}
              </div>
              <RulesPanel />
            </>
          )}
        </div>
      ) : null}

      {/* ---------------- Installments ---------------- */}
      {tab === 'Installments' ? (
        <Card className="p-4">
          <SectionTitle
            title="Installments"
            description="Every scheduled installment across all layaway accounts."
            right={<SampleBadge />}
          />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b border-slate-200 night:border-slate-700 bg-slate-50 night:bg-slate-800 text-[10px] uppercase text-slate-500 night:text-slate-400">
                <tr>
                  <th className="px-2.5 py-2">Customer</th>
                  <th className="px-2.5 py-2">Order</th>
                  <th className="px-2.5 py-2">#</th>
                  <th className="px-2.5 py-2">Due</th>
                  <th className="px-2.5 py-2 text-right">Amount</th>
                  <th className="px-2.5 py-2 text-right">Paid</th>
                  <th className="px-2.5 py-2">Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 night:divide-slate-800">
                {allInstallments.map(({ account, inst }) => (
                  <tr key={`${account.id}-${inst.number}`}>
                    <td className="px-2.5 py-2 font-medium text-slate-900 night:text-slate-100">
                      {account.customer}
                    </td>
                    <td className="px-2.5 py-2 font-mono text-[10px] text-slate-500 night:text-slate-400">
                      {account.officialOrderNumber}
                    </td>
                    <td className="px-2.5 py-2">{inst.number}</td>
                    <td className="px-2.5 py-2 text-slate-700 night:text-slate-300">
                      {inst.dueDate}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {peso(inst.amountDue)}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {inst.paidAmount === null ? '—' : peso(inst.paidAmount)}
                    </td>
                    <td className="px-2.5 py-2">
                      <StatusBadge
                        label={inst.verification}
                        tone={VERIF_TONE[inst.verification]!}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* ---------------- Overdue / Grace Period ---------------- */}
      {tab === 'Overdue / Grace Period' ? (
        <div className="space-y-4">
          <ForfeitureFlow />
          <Card className="p-4">
            <SectionTitle
              title="Overdue / Grace Period queue"
              description={`${overdue.length} account(s). Grace period is capped at ${LAYAWAY_RULES.maximumGraceDays} days.`}
              right={<PermissionBadge permission="layaway_monitoring" />}
            />
            <div className="mt-3 space-y-2">
              {overdue.map((l) => (
                <AccountRow
                  key={l.id}
                  account={l}
                  onOpen={() => {
                    setTab('Layaway Accounts');
                    setOpenId(l.id);
                  }}
                />
              ))}
            </div>
            <RuleNote tone="amber">
              Reaching the end of the grace period does <strong>not</strong> forfeit
              anything. It only makes the account <strong>Forfeiture-Eligible</strong> —
              eligibility is not approval.
            </RuleNote>
          </Card>
        </div>
      ) : null}

      {/* ---------------- Forfeiture Review ---------------- */}
      {tab === 'Forfeiture Review' ? (
        <div className="space-y-4">
          <ForfeitureFlow />
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <SectionTitle
                title="Forfeiture Review"
                description={`${eligible.length} account(s) past grace period.`}
              />
              <OwnerOnlyBadge />
            </div>
            <div className="mt-3 space-y-2">
              {eligible.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg border border-rose-200 night:border-rose-800 bg-rose-50 night:bg-rose-950 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 night:text-slate-100">
                        {l.customer}
                      </p>
                      <p className="truncate font-mono text-[10px] text-slate-500 night:text-slate-400">
                        {l.officialOrderNumber} · grace ended {l.gracePeriodEnd}
                      </p>
                    </div>
                    <StatusBadge label="Forfeiture-Eligible" tone="red" />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-600 night:text-slate-300">
                    Paid {peso(l.downPaymentPaid)} of {peso(l.totalOrderAmount)} ·{' '}
                    {peso(l.remainingBalance)} remaining
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <PreviewButton size="sm" variant="outline">
                      View Details
                    </PreviewButton>
                    <PreviewButton size="sm" variant="danger">
                      Request Forfeiture
                    </PreviewButton>
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-500 night:text-slate-400">
                    Creates an Owner Approval Request. Executes nothing.
                  </p>
                </div>
              ))}
            </div>
            <RuleNote tone="amber">
              <strong>Forfeiture requires Owner approval.</strong> There is no automatic
              forfeiture and no automatic stock return — an approved forfeiture sends the
              item to <strong>Returned-to-Stock Review</strong>, where a person decides.
            </RuleNote>
          </Card>
        </div>
      ) : null}

      {/* ---------------- Payment History ---------------- */}
      {tab === 'Payment History' ? (
        <Card className="p-4">
          <SectionTitle
            title="Payment History"
            description="Append-oriented record of payments and verifications."
            right={<SampleBadge />}
          />
          <ul className="mt-3 divide-y divide-slate-100 night:divide-slate-800 text-xs">
            {allInstallments
              .filter(({ inst }) => inst.paidAmount !== null)
              .map(({ account, inst }) => (
                <li
                  key={`${account.id}-${inst.number}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="font-medium text-slate-900 night:text-slate-100">
                    {account.customer}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 night:text-slate-400">
                    {account.officialOrderNumber} · #{inst.number}
                  </span>
                  <span className="text-slate-600 night:text-slate-300">
                    {inst.paidDate}
                  </span>
                  <span className="tabular-nums text-slate-900 night:text-slate-100">
                    {peso(inst.paidAmount!)}
                  </span>
                  <StatusBadge
                    label={inst.verification}
                    tone={VERIF_TONE[inst.verification]!}
                  />
                </li>
              ))}
          </ul>
          <RuleNote>
            Payments are never silently reassigned between orders. A correction is an
            explicit, reasoned, Owner-approved action.
          </RuleNote>
        </Card>
      ) : null}
    </>
  );
}
