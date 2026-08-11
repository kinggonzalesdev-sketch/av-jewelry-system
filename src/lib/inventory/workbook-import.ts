import 'server-only';

import ExcelJS from 'exceljs';

import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { parseCsvGrid } from '@/lib/import/parse-csv';
import {
  detectInventory,
  type DetectResult,
  type SheetInput,
} from '@/lib/inventory/import-detect';
import { createClient } from '@/lib/supabase/server';

/**
 * Reads an uploaded inventory workbook into a plain matrix of string cells per
 * worksheet — the input to the pure detection engine (`import-detect`).
 *
 *  - `.csv` → one sheet (the whole grid, header row included).
 *  - `.xlsx` → EVERY worksheet, in order, with every used row/column.
 *
 * Cell values are flattened to strings without losing meaning: numbers, dates,
 * rich text, hyperlinks, and formula results are all rendered readably.
 */

/** Stringify a JSON primitive; anything else (object/array) → ''. */
function primitive(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
    return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return '';
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const o = value as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
  }
  if (typeof o.text === 'string') return o.text;
  if (o.result !== undefined) return primitive(o.result);
  return '';
}

export async function readWorkbook(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<SheetInput[]> {
  if (/\.csv$/i.test(fileName)) {
    const text = new TextDecoder().decode(buffer);
    return [
      { name: fileName.replace(/\.csv$/i, '').trim() || 'CSV', rows: parseCsvGrid(text) },
    ];
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets: SheetInput[] = [];
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cells[colNumber - 1] = cellToString(cell.value);
      });
      for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
      rows.push(cells);
    });
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

export type ParseWorkbookResult =
  ({ ok: true } & DetectResult) | { ok: false; error: string };

/**
 * Owner-only: read an uploaded inventory workbook (every sheet) and return the
 * detected candidates + summary for the import PREVIEW. Reads nothing into the
 * database — the actual insert is a separate, confirmed step. Duplicate detection
 * runs against the codes already in inventory (the DB unique index is the final
 * guard on import).
 */
export async function parseInventoryWorkbook(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<ParseWorkbookResult> {
  // Inventory import is SUPER ADMIN only — hidden from Admin/Staff (spec).
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  let sheets: SheetInput[];
  try {
    sheets = await readWorkbook(fileName, buffer);
  } catch {
    return { ok: false, error: 'The file could not be read. Use a valid .xlsx or .csv.' };
  }
  if (sheets.every((s) => s.rows.length === 0)) {
    return { ok: false, error: 'That file has no rows.' };
  }

  const supabase = await createClient();
  const { data } = await supabase.from('inventory_items').select('item_code');
  const existing = ((data ?? []) as Array<{ item_code: string }>).map((r) => r.item_code);

  return { ok: true, ...detectInventory(sheets, existing) };
}
