/**
 * Export sections shared by the client modal and the server workbook builder.
 * Pure constants (no server code) so a Client Component can import them.
 *
 * `sensitive: true` marks a sheet the UI offers to the Owner ONLY (personnel, audit,
 * approvals, capture metadata). The workbook builder also skips those for a non-owner
 * caller, and RLS is the real control on top of both (Bible §30.3 r2). Owner + Selected
 * Admin still get every non-sensitive sheet.
 */
export const EXPORT_SECTIONS = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'active_layaways', label: 'Active Layaways' },
  { key: 'completed_layaways', label: 'Completed Layaways' },
  { key: 'all_layaways', label: 'All Layaways' },
  { key: 'layaway_payments', label: 'Layaway Payment History' },
  { key: 'scrap', label: 'Scrap Sales' },
  { key: 'all_sales', label: 'All Sales' },
  { key: 'orders', label: 'Orders' },
  { key: 'payments', label: 'Payments' },
  { key: 'customers', label: 'Customers' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'team', label: 'Team / Employees', sensitive: true },
  { key: 'approvals', label: 'Approvals', sensitive: true },
  { key: 'audit', label: 'Audit Log', sensitive: true },
  { key: 'capture_meta', label: 'Capture Metadata', sensitive: true },
] as const;

export type ExportSectionKey = (typeof EXPORT_SECTIONS)[number]['key'];

export const ALL_EXPORT_SECTION_KEYS: ExportSectionKey[] = EXPORT_SECTIONS.map(
  (s) => s.key,
);

/** Owner-only sheets (personnel / audit / approvals / capture metadata). */
export const SENSITIVE_SECTION_KEYS: ReadonlySet<ExportSectionKey> = new Set(
  EXPORT_SECTIONS.filter((s) => 'sensitive' in s && s.sensitive).map((s) => s.key),
);

/** The section keys a caller may choose, given whether they are the Owner. */
export function sectionsForRole(isOwner: boolean): readonly ExportSectionKey[] {
  return isOwner
    ? ALL_EXPORT_SECTION_KEYS
    : ALL_EXPORT_SECTION_KEYS.filter((k) => !SENSITIVE_SECTION_KEYS.has(k));
}
