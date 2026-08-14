'use client';

import { useState } from 'react';

import type { PayrollRow } from '@/lib/hr/payroll';
import type { PayslipSnapshot } from '@/lib/hr/payslip-types';
import { Money } from '@/components/shell/privacy';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * "Print Payroll Summary" (Bible §F). Prints a WHITE summary sheet of the whole
 * period from the existing SQL payroll rows, enriched with each generated
 * payslip's deductions / net / status when one exists. No figure is recomputed
 * here — gross comes from report_payroll, net/deductions/status from the snapshot.
 */

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #payroll-summary-doc, #payroll-summary-doc * { visibility: visible !important; }
  #payroll-summary-doc {
    position: fixed !important; inset: 0 !important; margin: 0 !important;
    padding: 24px !important; background: #fff !important; color: #000 !important;
    overflow: auto !important;
  }
  .no-print { display: none !important; }
}
`;

/** Peso string → integer centavos (exact; never via a float). */
function toCentavos(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  const w = /^\d+$/.test(whole) ? whole : '0';
  return BigInt(w) * 100n + BigInt(`${fraction}00`.slice(0, 2) || '0');
}
function fromCentavos(c: bigint): string {
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}

export function PayrollSummaryButton({
  rows,
  payslips,
  from,
  to,
}: {
  rows: PayrollRow[];
  payslips: Record<string, PayslipSnapshot>;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false);

  // Total payroll = sum of net (when a payslip exists) else gross (computed salary).
  let totalCentavos = 0n;
  for (const r of rows) {
    const snap = payslips[r.staffProfileId];
    const amount = snap ? snap.netSalary : (r.computedSalary ?? '0');
    totalCentavos += toCentavos(amount);
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Print Payroll Summary
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Payroll Summary"
        description={`Period ${from} – ${to}`}
        size="lg"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
          </>
        }
      >
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        <div id="payroll-summary-doc" className="rounded-lg bg-white p-5 text-black">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                A.V
              </div>
              <div>
                <p className="text-base font-bold">A.V. Jewelry — Payroll Summary</p>
                <p className="text-xs text-neutral-500">
                  Period {from} – {to}
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[720px] text-left text-xs">
              <colgroup>
                <col style={{ width: '15%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
              </colgroup>
              <thead className="border-b border-neutral-300 text-[10px] uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-1.5 text-center">Employee</th>
                  <th className="px-3 py-1.5 text-right">Reg. hrs</th>
                  <th className="px-3 py-1.5 text-right">OT hrs</th>
                  <th className="px-3 py-1.5 text-right">Rate</th>
                  <th className="px-3 py-1.5 text-right">Gross</th>
                  <th className="px-3 py-1.5 text-right">Deductions</th>
                  <th className="px-3 py-1.5 text-right">Net</th>
                  <th className="px-3 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const snap = payslips[r.staffProfileId];
                  return (
                    <tr key={r.staffProfileId} className="border-b border-neutral-200">
                      <td className="px-3 py-1.5 text-center">{r.fullName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.totalHours.toFixed(2)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.overtimeHours.toFixed(2)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.dailyRate ? <Money amount={r.dailyRate} /> : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.computedSalary ? <Money amount={r.computedSalary} /> : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {snap ? <Money amount={snap.deductions} /> : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {snap ? (
                          <Money amount={snap.netSalary} />
                        ) : r.computedSalary ? (
                          <Money amount={r.computedSalary} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5 capitalize">
                        {snap ? snap.paymentStatus : 'not generated'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-400 font-bold">
                  <td className="px-3 py-2" colSpan={6}>
                    Total payroll
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" colSpan={2}>
                    <Money amount={fromCentavos(totalCentavos)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-neutral-500">
            Gross is from attendance in SQL. Deductions / Net / Status come from each
            generated payslip; rows without a payslip show gross as net.
          </p>
        </div>
      </Modal>
    </>
  );
}
