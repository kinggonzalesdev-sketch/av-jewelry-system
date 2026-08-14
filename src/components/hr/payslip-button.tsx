'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { generatePayslipAction, markPayslipPaidAction } from '@/lib/hr/payslip-actions';
import { downloadPayslipPdf } from '@/lib/hr/payslip-pdf';
import { EMPTY_PAYSLIP_STATE, type PayslipSnapshot } from '@/lib/hr/payslip-types';
import { Money } from '@/components/shell/privacy';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Per-row payslip control (Bible §F). Opens the standard modal; with no snapshot
 * yet it shows a tiny generate form (deductions), then flips to a WHITE, printable
 * payslip document. Print / Download-PDF both use the browser print dialog (Save
 * as PDF) against a print-isolated document, so no extra library is needed. All
 * figures come from the immutable SQL snapshot — never recomputed here.
 */

// Print isolation: when printing, only #payslip-doc is visible, laid out as a
// clean white sheet regardless of the dark app around it.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #payslip-doc, #payslip-doc * { visibility: visible !important; }
  #payslip-doc {
    position: fixed !important; inset: 0 !important; margin: 0 !important;
    padding: 32px !important; background: #fff !important; color: #000 !important;
  }
  .no-print { display: none !important; }
}
`;

// Soft Gold, darkened just enough to stay readable as an accent on white — used
// ONLY for the small logo mark and the single Net Pay highlight.
const SOFT_GOLD = '#b28b3f';

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-neutral-500">{label}</span>
      <span
        className={accent ? 'font-bold tabular-nums' : 'font-medium tabular-nums'}
        style={accent ? { color: SOFT_GOLD } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function PayslipDocument({ snap }: { snap: PayslipSnapshot }) {
  const rate: ReactNode = snap.hourlyRate ? (
    <Money amount={snap.hourlyRate} />
  ) : (
    'No rate set'
  );
  return (
    <div id="payslip-doc" className="rounded-lg bg-white p-6 text-sm text-black">
      {/* 1 · Header — small logo, employee, role, period, status */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: SOFT_GOLD }}
          >
            AV
          </div>
          <div className="leading-tight">
            <p className="font-bold">A.V. Jewelry</p>
            <p className="text-xs text-neutral-500">Payslip</p>
          </div>
        </div>
        <div className="text-right text-xs leading-snug text-neutral-500">
          <p className="font-medium text-black">{snap.employeeName}</p>
          <p className="capitalize">{snap.roleKey.replace(/_/g, ' ')}</p>
          <p>
            {snap.payrollStartDate} – {snap.payrollEndDate}
          </p>
          <p
            className={
              snap.paymentStatus === 'paid' ? 'text-green-700' : 'text-amber-600'
            }
          >
            {snap.paymentStatus === 'paid'
              ? `Paid${snap.paymentDate ? ` · ${snap.paymentDate}` : ''}`
              : 'Pending'}
          </p>
        </div>
      </div>

      {/* 2 · Payroll Summary — compact two-column grid, Net Pay highlighted */}
      <div className="mt-4 grid grid-cols-2 gap-x-8">
        <div>
          {/* A payslip states the basis it was actually computed on — legacy
              payslips were hourly, and relabelling them would misstate issued pay. */}
          {snap.rateBasis === 'daily' ? (
            <>
              <Row label="Days worked" value={String(snap.daysWorked)} />
              <Row label="Regular hours" value={snap.regularHours} />
              <Row label="Night shifts (₱300 each)" value={String(snap.nightShifts)} />
              <Row label="Daily rate" value={rate} />
            </>
          ) : (
            <>
              <Row label="Regular hours" value={snap.regularHours} />
              <Row label="Overtime hours" value={snap.overtimeHours} />
              <Row label="Hourly rate" value={rate} />
            </>
          )}
        </div>
        <div>
          <Row label="Regular salary" value={<Money amount={snap.regularSalary} />} />
          <Row label="Overtime pay" value={<Money amount={snap.overtimePay} />} />
          <Row label="Gross salary" value={<Money amount={snap.grossSalary} />} />
          <Row
            label="Deductions"
            value={
              <>
                - <Money amount={snap.deductions} />
              </>
            }
          />
          <Row label="Net pay" value={<Money amount={snap.netSalary} />} accent />
        </div>
      </div>

      {/* 3 · Signature Footer — both signatures on one row */}
      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <div className="border-t border-neutral-400 pt-1 text-center">
          Employee signature
        </div>
        <div className="border-t border-neutral-400 pt-1 text-center">Approved by</div>
      </div>
    </div>
  );
}

export function PayslipButton({
  employeeId,
  from,
  to,
  existingSnapshot,
  canManage,
}: {
  employeeId: string;
  from: string;
  to: string;
  existingSnapshot: PayslipSnapshot | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PayslipSnapshot | null>(existingSnapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deductions, setDeductions] = useState('0');

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('employeeId', employeeId);
      fd.set('from', from);
      fd.set('to', to);
      // Trim a trailing decimal point the money input may leave mid-type.
      fd.set('deductions', deductions.replace(/\.$/, '') || '0');
      const result = await generatePayslipAction(EMPTY_PAYSLIP_STATE, fd);
      if (result.error || !result.snapshot) {
        setError(result.error ?? 'The payslip could not be generated.');
        return;
      }
      setSnapshot(result.snapshot);
      router.refresh();
    } catch {
      setError('The payslip could not be generated.');
    } finally {
      setPending(false);
    }
  }

  async function markPaid() {
    if (!snapshot) return;
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('snapshotId', snapshot.id);
      const result = await markPayslipPaidAction(EMPTY_PAYSLIP_STATE, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSnapshot({
        ...snapshot,
        paymentStatus: 'paid',
        paymentDate: new Date().toISOString().slice(0, 10),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const footer = snapshot ? (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        Close
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => downloadPayslipPdf(snapshot)}
        data-testid="payslip-download-pdf"
      >
        Download PDF
      </Button>
      <Button type="button" variant="outline" onClick={() => window.print()}>
        Print
      </Button>
      {canManage && snapshot.paymentStatus === 'pending' ? (
        <Button type="button" onClick={() => void markPaid()} disabled={pending}>
          {pending ? 'Saving…' : 'Mark as Paid'}
        </Button>
      ) : null}
    </>
  ) : (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Button type="button" onClick={() => void generate()} disabled={pending}>
        {pending ? 'Generating…' : 'Generate payslip'}
      </Button>
    </>
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid={`generate-payslip-${employeeId}`}
      >
        {existingSnapshot ? 'View payslip' : 'Generate Payslip'}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Payslip"
        description={`Payroll period ${from} – ${to}. Figures are a frozen snapshot.`}
        size="md"
        footer={footer}
      >
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
        {snapshot ? (
          <PayslipDocument snap={snapshot} />
        ) : (
          <div className="space-y-3">
            {canManage ? (
              <>
                <div className="max-w-[12rem]">
                  <Label htmlFor="ded" className="text-xs">
                    Deductions
                  </Label>
                  <MoneyInput
                    id="ded"
                    value={deductions}
                    onValueChange={setDeductions}
                    className="mt-1 h-9 text-right tabular-nums"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Overtime pay = the recorded ₱300 flat late-night overtime for the
                  period.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No payslip has been generated for this period yet. Ask the Owner to
                generate it.
              </p>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
        {snapshot && error ? (
          <p role="alert" className="no-print mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
