/**
 * Export sections shared by the client modal and the server workbook builder.
 * Pure constants (no server code) so a Client Component can import them.
 */
export const EXPORT_SECTIONS = [
  { key: 'inventory', label: 'Inventory' },
  { key: 'active_layaways', label: 'Active Layaways' },
  { key: 'completed_layaways', label: 'Completed Layaways' },
  { key: 'all_layaways', label: 'All Layaways' },
  { key: 'scrap', label: 'Scrap Sales' },
  { key: 'all_sales', label: 'All Sales' },
  { key: 'orders', label: 'Orders' },
  { key: 'payments', label: 'Payments' },
  { key: 'customers', label: 'Customers' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'payroll', label: 'Payroll' },
] as const;

export type ExportSectionKey = (typeof EXPORT_SECTIONS)[number]['key'];

export const ALL_EXPORT_SECTION_KEYS: ExportSectionKey[] = EXPORT_SECTIONS.map(
  (s) => s.key,
);
