/**
 * Minimal, dependency-free CSV reader for the import preview (spec §B). Handles
 * quoted fields, escaped quotes (""), commas and newlines inside quotes, a
 * leading UTF-8 BOM, and CRLF/CR line endings. Pure and unit-tested — the import
 * modal only ever PREVIEWS this; nothing is written until the user confirms.
 */

export type ParsedCsv = { headers: string[]; rows: string[][] };

/**
 * Parse a CSV into its RAW grid (every record, no header assumption). Needed by
 * importers whose real header row is NOT the first line (extra title/spacer rows
 * above it). `parseCsv` below is the header-first convenience built on top.
 */
export function parseCsvGrid(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      if (field === '') inQuotes = true;
      else field += c;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (c === '\r') {
      // ignore
    } else {
      field += c;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(text: string): ParsedCsv {
  const s = text.replace(/^﻿/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      // A quote only OPENS a quoted field at the start of a field; a bare quote
      // mid-field (e.g. the inch mark in 16") is a literal character.
      if (field === '') inQuotes = true;
      else field += c;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (c === '\r') {
      // ignore — the \n (if any) closes the record
    } else {
      field += c;
    }
  }
  // Flush the final field/record if the file did not end with a newline.
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const headers = (records.shift() ?? []).map((h) => h.trim());
  // Drop fully-empty rows (trailing blank lines, spacer rows).
  const rows = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  return { headers, rows };
}
