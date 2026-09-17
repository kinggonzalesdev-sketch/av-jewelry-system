import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * SHARED WAYBILL / TRACKING NUMBERS (Owner 2026-09-17).
 *
 * One LBC waybill may belong to several orders shipped together in one package. The only thing
 * that refused a repeat was the production-only partial UNIQUE index official_orders_waybill_uidx
 * (set_order_waybill maps its unique_violation to "already used by another active order").
 * Migration 20260917130000 drops ONLY that index. These tests pin that the migration stays narrow
 * and safe: guarded drop, loud failure if uniqueness survives, no data change, no function rewrite,
 * the search index untouched, and a short lock timeout.
 *
 * The production database is not reachable from the test runner, and the waybill column and
 * set_order_waybill have no repository DDL, so the behavioural proof ran in a throwaway
 * PostgreSQL 17 against the recovered 2026-07-30 production SQL. This file guards the text.
 */

const ROOT = join(__dirname, '..', '..');
const RAW = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20260917130000_allow_shared_waybill_numbers.sql'),
  'utf8',
);

/** SQL with `--` comment lines removed, lower-cased, whitespace collapsed to single spaces. */
function normalizedSql(raw: string): string {
  const code = raw
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('--'))
    .join(' ')
    .toLowerCase();
  let s = code.split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(9)).join(' ');
  while (s.includes('  ')) s = s.split('  ').join(' ');
  return s;
}

const SQL = normalizedSql(RAW);

describe('migration 20260917130000 — allow shared waybill numbers', () => {
  it('drops exactly the production unique waybill index', () => {
    expect(SQL).toContain("c.relname = 'official_orders_waybill_uidx'");
    expect(SQL).toContain("execute 'drop index public.official_orders_waybill_uidx'");
  });

  it('only drops it after proving it is the unique lower(waybill_number) index backing no constraint', () => {
    expect(SQL).toContain('i.indisunique');
    expect(SQL).toContain("i.indrelid = 'public.official_orders'::regclass");
    expect(SQL).toContain("position('lower(waybill_number)' in v_def) = 0");
    expect(SQL).toContain('where conindid = v_idx');
  });

  it('fails loudly if any other UNIQUE index on official_orders still covers the waybill', () => {
    expect(SQL).toContain("pg_get_indexdef(i.indexrelid) ilike '%waybill%'");
    expect(SQL).toContain('duplicate waybills would stay blocked');
  });

  it('never creates uniqueness or a replacement index, and leaves the search index alone', () => {
    expect(SQL).not.toContain('create unique index');
    expect(SQL).not.toContain('official_orders_waybill_lower_idx');
    expect(SQL).not.toContain('create index');
    expect(SQL).not.toContain('official_orders_waybill_trgm');
  });

  it('does not rewrite set_order_waybill or any other function', () => {
    expect(SQL).not.toContain('create or replace function');
    expect(SQL).not.toContain('create function');
    expect(SQL).not.toContain('set_order_waybill');
  });

  it('changes no data: no insert, update, delete or truncate', () => {
    expect(SQL).not.toContain('insert into');
    expect(SQL).not.toContain('update public.');
    expect(SQL).not.toContain('delete from');
    expect(SQL).not.toContain('truncate');
  });

  it('bounds the ACCESS EXCLUSIVE lock with a short lock_timeout and resets it', () => {
    expect(SQL.startsWith("set lock_timeout = '5s';")).toBe(true);
    expect(SQL.endsWith('reset lock_timeout;')).toBe(true);
  });
});

describe('Waybill field copy no longer promises uniqueness', () => {
  const FIELD = readFileSync(join(ROOT, 'src', 'components', 'orders', 'order-waybill-field.tsx'), 'utf8');

  it('does not claim the database refuses a duplicate', () => {
    expect(FIELD).not.toContain('refuses a blank or a duplicate');
    expect(FIELD).toContain('several orders shipped together in one');
  });
});
