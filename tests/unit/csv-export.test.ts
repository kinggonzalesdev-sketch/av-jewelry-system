import { describe, expect, it } from 'vitest';

import { toCsv } from '@/lib/export/csv';

/** CSV export (§18) — headers, quoting/escaping, and empty-rows behaviour. */

type Row = { code: string; name: string; amount: string };

const columns = [
  { header: 'Code', value: (r: Row) => r.code },
  { header: 'Name', value: (r: Row) => r.name },
  { header: 'Amount', value: (r: Row) => r.amount },
];

describe('toCsv', () => {
  it('writes a header row and one line per record', () => {
    const csv = toCsv(columns, [
      { code: 'SBA-N-2683', name: 'Necklace', amount: '1800.00' },
    ]);
    expect(csv).toBe('Code,Name,Amount\r\nSBA-N-2683,Necklace,1800.00');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = toCsv(columns, [
      { code: 'X', name: 'Cruz, Ana', amount: 'say "hi"' },
    ]);
    expect(csv).toContain('"Cruz, Ana"');
    expect(csv).toContain('"say ""hi"""');
  });

  it('returns just the header when there are no rows', () => {
    expect(toCsv(columns, [])).toBe('Code,Name,Amount');
  });
});
