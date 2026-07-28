import { jsPDF } from 'jspdf';

import type { PayslipSnapshot } from '@/lib/hr/payslip-types';

/**
 * Generate and download a REAL .pdf payslip (no browser print dialog). The layout
 * mirrors the compact approved on-screen payslip: header (employee, role, period,
 * status), a two-column payroll summary with Net Pay highlighted, and a signature
 * footer. Every figure comes straight from the frozen snapshot — nothing is
 * recomputed here.
 *
 * Amounts are written as "PHP 1,234.00" (not the ₱ glyph) because jsPDF's built-in
 * fonts don't include ₱, and a missing glyph would render as garbage on some
 * devices. Grouping is done with string ops so no float ever touches money.
 */

const SOFT_GOLD: [number, number, number] = [178, 139, 63];
const INK: [number, number, number] = [17, 17, 17];
const MUTED: [number, number, number] = [120, 120, 120];

/** "1234.5" → "PHP 1,234.50" using string ops only (never a float). */
function peso(value: string | null): string {
  if (!value) return 'PHP 0.00';
  const negative = value.trim().startsWith('-');
  const clean = value.replace(/[^\d.]/g, '');
  const [wholeRaw = '0', fracRaw = ''] = clean.split('.');
  const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = `${fracRaw}00`.slice(0, 2);
  return `${negative ? '-' : ''}PHP ${grouped}.${frac}`;
}

function safeSegment(value: string): string {
  return (value || '')
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'unknown';
}

/** Filename: AV-Jewelry-Payslip-[Employee]-[Pay-Period].pdf */
export function payslipFileName(snap: PayslipSnapshot): string {
  const employee = safeSegment(snap.employeeName);
  const period = `${safeSegment(snap.payrollStartDate)}_${safeSegment(snap.payrollEndDate)}`;
  return `AV-Jewelry-Payslip-${employee}-${period}.pdf`;
}

export function downloadPayslipPdf(snap: PayslipSnapshot): void {
  // A5 portrait: compact, prints cleanly, readable on desktop and mobile viewers.
  const doc = new jsPDF({ unit: 'pt', format: 'a5' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 36;
  const right = pageW - margin;
  let y = margin;

  // Header — logo mark + shop, and employee block on the right.
  doc.setFillColor(...SOFT_GOLD);
  doc.circle(margin + 9, y + 6, 9, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('AV', margin + 9, y + 9, { align: 'center' });

  doc.setTextColor(...INK);
  doc.setFontSize(12);
  doc.text('A.V. Jewelry', margin + 24, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Payslip', margin + 24, y + 15);

  doc.setTextColor(...INK);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(snap.employeeName, right, y + 2, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.text(snap.roleKey.replace(/_/g, ' '), right, y + 13, { align: 'right' });
  doc.text(`${snap.payrollStartDate} - ${snap.payrollEndDate}`, right, y + 23, {
    align: 'right',
  });
  const paidLine =
    snap.paymentStatus === 'paid'
      ? `Paid${snap.paymentDate ? ` - ${snap.paymentDate}` : ''}`
      : 'Unpaid';
  doc.text(paidLine, right, y + 33, { align: 'right' });

  y += 52;
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, right, y);
  y += 18;

  // Two-column summary.
  const rate = snap.hourlyRate ? peso(snap.hourlyRate) : 'No rate set';
  const leftRows: Array<[string, string]> = [
    ['Regular hours', snap.regularHours],
    ['Overtime hours', snap.overtimeHours],
    ['Hourly rate', rate],
  ];
  const rightRows: Array<[string, string]> = [
    ['Regular salary', peso(snap.regularSalary)],
    ['Overtime pay', peso(snap.overtimePay)],
    ['Gross salary', peso(snap.grossSalary)],
    ['Deductions', `- ${peso(snap.deductions)}`],
  ];

  const colGap = 12;
  const colW = (right - margin - colGap) / 2;
  const rowH = 15;
  doc.setFontSize(9);

  leftRows.forEach(([label, value], i) => {
    const ry = y + i * rowH;
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text(label, margin, ry);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.text(value, margin + colW, ry, { align: 'right' });
  });

  const rx = margin + colW + colGap;
  rightRows.forEach(([label, value], i) => {
    const ry = y + i * rowH;
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text(label, rx, ry);
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.text(value, right, ry, { align: 'right' });
  });

  // Net pay — highlighted, below the right column.
  const netY = y + rightRows.length * rowH + 6;
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.text('Net pay', rx, netY);
  doc.setTextColor(...SOFT_GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(peso(snap.netSalary), right, netY, { align: 'right' });

  // Signature footer.
  const footY = Math.max(netY, y + leftRows.length * rowH) + 48;
  doc.setDrawColor(150, 150, 150);
  doc.line(margin, footY, margin + colW, footY);
  doc.line(rx, footY, right, footY);
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Employee signature', margin + colW / 2, footY + 11, { align: 'center' });
  doc.text('Approved by', rx + colW / 2, footY + 11, { align: 'center' });

  doc.save(payslipFileName(snap));
}
