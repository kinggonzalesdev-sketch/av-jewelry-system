import { describe, expect, it } from 'vitest';

import { parseCsv } from '@/lib/import/parse-csv';

/** CSV reader for the inventory import preview (spec §B). */

describe('parseCsv', () => {
  it('reads headers and rows', () => {
    const { headers, rows } = parseCsv('Item,Price\r\nSBA-N-2683 1.80g 16",8000\r\n');
    expect(headers).toEqual(['Item', 'Price']);
    expect(rows).toEqual([['SBA-N-2683 1.80g 16"', '8000']]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const { rows } = parseCsv('Item,Note\r\n"Cruz, Ana","say ""hi"""\r\n');
    expect(rows[0]).toEqual(['Cruz, Ana', 'say "hi"']);
  });

  it('strips a UTF-8 BOM and skips blank rows', () => {
    const { headers, rows } = parseCsv('﻿Item\r\nA\r\n\r\nB\r\n');
    expect(headers).toEqual(['Item']);
    expect(rows).toEqual([['A'], ['B']]);
  });

  it('reads the final row without a trailing newline', () => {
    const { rows } = parseCsv('Item\nLast');
    expect(rows).toEqual([['Last']]);
  });
});
