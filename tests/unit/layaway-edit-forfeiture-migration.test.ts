import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260921130809_edit_layaway_forfeiture.sql',
  ),
  'utf8',
);

describe('Edit Layaway forfeiture migration', () => {
  it('wraps the canonical edit and forfeiture functions in one invoker transaction', () => {
    expect(sql).toContain(
      'create or replace function public.update_layaway_ledger_and_forfeit(',
    );
    expect(sql).toContain('security invoker');
    expect(sql).toContain('v_edit := public.update_layaway_ledger_account(');
    expect(sql).toContain('v_forfeit := public.forfeit_layaway_ledger(p_id);');
  });

  it('does not expose the wrapper to anonymous callers', () => {
    expect(sql).toContain(
      'revoke all on function public.update_layaway_ledger_and_forfeit(',
    );
    expect(sql).toContain(') from public, anon;');
    expect(sql).toContain(') to authenticated, service_role;');
  });
});
