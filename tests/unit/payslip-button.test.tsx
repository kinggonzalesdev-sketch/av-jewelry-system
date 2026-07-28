import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PayslipButton } from '@/components/hr/payslip-button';
import type { PayslipSnapshot } from '@/lib/hr/payslip-types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/hr/payslip-actions', () => ({
  generatePayslipAction: vi.fn(),
  markPayslipPaidAction: vi.fn(),
}));

const snapshot: PayslipSnapshot = {
  id: 'p1',
  employeeId: 's1',
  employeeName: 'King Gonzales',
  roleKey: 'staff',
  payrollStartDate: '2026-07-01',
  payrollEndDate: '2026-07-31',
  regularHours: '40.00',
  overtimeHours: '2.00',
  hourlyRate: '100.00',
  regularSalary: '4000.00',
  overtimePay: '300.00',
  grossSalary: '4300.00',
  deductions: '0.00',
  netSalary: '4300.00',
  paymentStatus: 'pending',
  paymentDate: null,
  generatedAt: '2026-07-31T00:00:00.000Z',
};

describe('PayslipButton', () => {
  it('offers "Generate Payslip" (owner) and opens a generate form', () => {
    render(
      <PayslipButton
        employeeId="s1"
        from="2026-07-01"
        to="2026-07-31"
        existingSnapshot={null}
        canManage
      />,
    );
    fireEvent.click(screen.getByTestId('generate-payslip-s1'));
    expect(screen.getByLabelText(/Deductions/i)).toBeInTheDocument();
    expect(screen.getByTestId('modal')).toBeInTheDocument();
  });

  it('shows the frozen payslip document + print/PDF for an existing snapshot', () => {
    render(
      <PayslipButton
        employeeId="s1"
        from="2026-07-01"
        to="2026-07-31"
        existingSnapshot={snapshot}
        canManage
      />,
    );
    fireEvent.click(screen.getByTestId('generate-payslip-s1'));
    expect(screen.getByText('King Gonzales')).toBeInTheDocument();
    // ₱4,300 shows for both gross and net (whole amount → no decimals).
    expect(screen.getAllByText(/₱4,300\b/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^print$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as paid/i })).toBeInTheDocument();
  });
});
