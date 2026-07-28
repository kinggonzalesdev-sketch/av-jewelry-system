/**
 * Payslip shapes shared by the server reader/actions and the client payslip
 * modal. Kept OUT of any `'server-only'` module so a Client Component can import
 * the types without pulling server code into the bundle.
 *
 * Every money figure is a STRING (numeric in SQL); the client never re-derives
 * salary — it only renders the frozen snapshot.
 */

export type PayslipSnapshot = {
  id: string;
  employeeId: string;
  employeeName: string;
  roleKey: string;
  payrollStartDate: string;
  payrollEndDate: string;
  regularHours: string;
  overtimeHours: string;
  hourlyRate: string | null;
  regularSalary: string;
  overtimePay: string;
  grossSalary: string;
  deductions: string;
  netSalary: string;
  paymentStatus: 'pending' | 'paid';
  paymentDate: string | null;
  generatedAt: string;
};

export type PayslipActionState = {
  error: string | null;
  success: string | null;
  /** The generated/updated snapshot, present on success. */
  snapshot: PayslipSnapshot | null;
};

export const EMPTY_PAYSLIP_STATE: PayslipActionState = {
  error: null,
  success: null,
  snapshot: null,
};
