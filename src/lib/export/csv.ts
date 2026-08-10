/**
 * CSV export (UI/UX spec §18). Pure, dependency-free, and Excel-friendly: values
 * are quoted/escaped correctly and the file is written with a UTF-8 BOM so Excel
 * shows ₱ and accented names correctly. Columns use business-friendly headings;
 * the caller decides which fields to expose (no internal DB ids unless asked).
 */

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

/** Builds the CSV text. Pure — unit-tested. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.header)).join(',');
  const body = rows
    .map((r) => columns.map((c) => esc(c.value(r))).join(','))
    .join('\r\n');
  return rows.length ? `${head}\r\n${body}` : head;
}

/** Triggers a browser download of already-built CSV text (e.g. a multi-section export
 *  where several tables are joined with blank lines). Adds the Excel UTF-8 BOM. */
export function downloadCsvText(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Triggers a browser download of the rows as a .csv (opens in Excel). */
export function downloadCsv<T>(
  filename: string,
  columns: CsvColumn<T>[],
  rows: T[],
): void {
  const csv = toCsv(columns, rows);
  // Leading BOM so Excel reads it as UTF-8.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
