import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260921135356_legacy_safe_layaway_code_release.sql',
  ),
  'utf8',
);

describe('legacy-safe Layaway code release migration', () => {
  it('uses one advisory-lock-protected resolver for both terminal transitions', () => {
    expect(sql).toContain(
      'create or replace function app_private.prepare_layaway_code_for_terminal_release(',
    );
    expect(sql).toContain(
      "perform pg_advisory_xact_lock(hashtext('layaway_code_pool'));",
    );
    expect(sql).toContain("'state', 'already_available'");
    expect(sql).toContain(
      'v_resolution := app_private.prepare_layaway_code_for_terminal_release(',
    );
    expect(sql).toContain(
      'v_result := public.forfeit_layaway_ledger_strict(p_ledger_id);',
    );
    expect(sql).toContain(
      "perform set_config('app_private.defer_layaway_code_release', 'on', true);",
    );
    expect(sql).toContain(
      'v_result := public.update_layaway_ledger_and_transfer_overdue_strict(',
    );
  });

  it('protects an active conflicting assignment and keeps strict functions private', () => {
    expect(sql).toContain(
      'could not be released because it is currently assigned to another active Layaway',
    );
    expect(sql).toContain('rename to forfeit_layaway_ledger_strict;');
    expect(sql).toContain('rename to update_layaway_ledger_and_transfer_overdue_strict;');
    expect(sql).toContain('from public, anon, authenticated, service_role;');
    expect(sql).toContain(
      'create or replace function app_private.release_code_on_close()',
    );
  });

  it('rebinds edit-and-forfeit to the public legacy-safe forfeiture wrapper', () => {
    expect(sql).toContain(
      'create or replace function public.update_layaway_ledger_and_forfeit(',
    );
    expect(sql).toContain('v_forfeit := public.forfeit_layaway_ledger(p_id);');
  });
});
