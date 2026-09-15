import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * System audit 2026-09-16 — regression guards for the security/integrity hardening batch.
 *
 * Two kinds of test live here:
 *   - behaviour of the new TypeScript helpers (constant-time secret compare, CSV date parsing,
 *     the mobile permission check, the throttled failed-sign-in audit);
 *   - content assertions over the two migrations. The production database is not reachable from
 *     the test runner, so these pin the exact SQL decisions a reviewer verified — a later edit
 *     that silently reverts one (e.g. returning NULL from current_staff_role again, or granting
 *     every definer function to authenticated) fails here.
 */

// ---- sign-in action dependencies (mocked before the module under test is imported) ----------
const signInWithPassword = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { signInWithPassword } }),
}));
const recordSystemAuditEvent = vi.fn((_e: unknown) => Promise.resolve());
const recordAuditEvent = vi.fn((_e: unknown) => Promise.resolve());
vi.mock('@/lib/audit/log', () => ({
  recordSystemAuditEvent: (e: unknown) => recordSystemAuditEvent(e),
  recordAuditEvent: (e: unknown) => recordAuditEvent(e),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

import { signIn } from '@/lib/auth/actions';
import { toDate } from '@/lib/import/layaway-csv';
import { mobileHasPermission, type MobileStaff } from '@/lib/mobile/auth';
import { secretMatches, secretMatchesAny } from '@/lib/security/secret-compare';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');
const SECURITY_SQL = readFileSync(
  join(MIGRATIONS, '20260916120000_security_hardening_definer_grants_owner_guards.sql'),
  'utf8',
);
const INDEX_SQL = readFileSync(
  join(MIGRATIONS, '20260916130000_hotpath_indexes_audit_payments_customers.sql'),
  'utf8',
);

function form(email: string, password = 'wrong-password'): FormData {
  const f = new FormData();
  f.set('email', email);
  f.set('password', password);
  return f;
}

describe('secretMatches — constant-time shared-secret compare', () => {
  it('accepts only the exact secret', () => {
    expect(secretMatches('Bearer s3cret', 'Bearer s3cret')).toBe(true);
    expect(secretMatches('Bearer s3creT', 'Bearer s3cret')).toBe(false);
    expect(secretMatches('Bearer s3cret-longer', 'Bearer s3cret')).toBe(false);
    expect(secretMatches('', 'Bearer s3cret')).toBe(false);
    expect(secretMatches('Bearer ', '')).toBe(false);
  });

  it('accepts the current OR the next secret during rotation', () => {
    expect(secretMatchesAny('b', ['a', 'b'])).toBe(true);
    expect(secretMatchesAny('c', ['a', 'b'])).toBe(false);
    expect(secretMatchesAny('a', [])).toBe(false);
  });
});

describe('toDate — layaway CSV dates land on the written calendar day', () => {
  it('keeps a valid ISO date and rejects an impossible one', () => {
    expect(toDate('2026-06-20')).toBe('2026-06-20');
    expect(toDate('2026-02-31')).toBeNull();
    expect(toDate('2026-13-01')).toBeNull();
  });

  it('parses written dates to the SAME calendar day (never one day early)', () => {
    expect(toDate('June 20, 2026')).toBe('2026-06-20');
    expect(toDate('Jun 1, 2026')).toBe('2026-06-01');
  });

  it('returns null for blanks and junk', () => {
    expect(toDate('')).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('not a date')).toBeNull();
  });
});

describe('mobileHasPermission — the capture phone needs a real grant', () => {
  function staffWith(
    role: MobileStaff['roleKey'],
    result: { data: unknown; error: unknown },
  ) {
    const limit = vi.fn(() => Promise.resolve(result));
    const chain = { select: () => chain, eq: () => chain, limit };
    const supabase = { from: vi.fn(() => chain) };
    return {
      staff: {
        staffProfileId: 'sp-1',
        authUserId: 'u-1',
        roleKey: role,
        fullName: 'Tester',
        supabase,
      } as unknown as MobileStaff,
      supabase,
    };
  }

  it('the Owner holds every permission without a lookup', async () => {
    const { staff, supabase } = staffWith('owner', { data: [], error: null });
    expect(await mobileHasPermission(staff, 'claim_capture')).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('a staff member passes only with an explicit grant', async () => {
    const granted = staffWith('staff', {
      data: [{ permission_key: 'claim_capture' }],
      error: null,
    });
    expect(await mobileHasPermission(granted.staff, 'claim_capture')).toBe(true);
    const none = staffWith('staff', { data: [], error: null });
    expect(await mobileHasPermission(none.staff, 'claim_capture')).toBe(false);
  });

  it('fails closed when the grant list cannot be read', async () => {
    const broken = staffWith('selected_admin', {
      data: null,
      error: { message: 'boom' },
    });
    expect(await mobileHasPermission(broken.staff, 'claim_capture')).toBe(false);
  });
});

describe('signIn — failed attempts are audited, but bounded', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    recordSystemAuditEvent.mockClear();
  });

  it('records a wrong-password attempt as a SYSTEM event with a redacted email only', async () => {
    signInWithPassword.mockResolvedValue({
      error: {
        code: 'invalid_credentials',
        status: 400,
        message: 'Invalid login credentials',
      },
    });
    const res = await signIn({ error: null }, form('alice.audit@example.com'));
    expect(res.error).toBeTruthy();
    expect(recordSystemAuditEvent).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(recordSystemAuditEvent.mock.calls[0]);
    expect(entry).toContain('auth.sign_in_failed');
    expect(entry).not.toContain('alice.audit@example.com');
    expect(entry).not.toContain('wrong-password');
  });

  it('does not write a row for an attempt Supabase already rate-limited', async () => {
    signInWithPassword.mockResolvedValue({
      error: {
        code: 'over_request_rate_limit',
        status: 429,
        message: 'Too many requests',
      },
    });
    await signIn({ error: null }, form('bob.rate@example.com'));
    expect(recordSystemAuditEvent).not.toHaveBeenCalled();
  });

  it('caps repeated failures for the same email + kind', async () => {
    signInWithPassword.mockResolvedValue({
      error: {
        code: 'invalid_credentials',
        status: 400,
        message: 'Invalid login credentials',
      },
    });
    for (let i = 0; i < 8; i += 1) {
      await signIn({ error: null }, form('carol.flood@example.org'));
    }
    expect(recordSystemAuditEvent.mock.calls.length).toBe(5);
  });

  it('refuses an over-long email before calling Supabase', async () => {
    const res = await signIn({ error: null }, form(`${'a'.repeat(250)}@example.com`));
    expect(res.error).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('the new migrations are syntactically sound SQL', () => {
  // Regression guard: a JS String.replace() once collapsed `$$` to `$` in inserted DO blocks,
  // which would have aborted both migrations on apply.
  for (const [name, sql] of [
    ['20260916120000', SECURITY_SQL],
    ['20260916130000', INDEX_SQL],
  ] as const) {
    it(`${name}: every dollar-quoted block opens and closes with a matching tag`, () => {
      expect(sql).not.toMatch(/^do \$$/m);
      expect(sql).not.toMatch(/^end \$;$/m);
      const opens = (sql.match(/^do \$\$$/gm) ?? []).length;
      const closes = (sql.match(/^end \$\$;$/gm) ?? []).length;
      expect(opens).toBe(closes);
      const fnOpens = (sql.match(/\bas \$function\$/g) ?? []).length;
      const fnCloses = (sql.match(/^\$function\$;$/gm) ?? []).length;
      expect(fnOpens).toBe(fnCloses);
      // Every `as $$` body (functions written with plain $$) is closed by a `$$;` line.
      const asOpens = (sql.match(/\bas \$\$$/gm) ?? []).length;
      const asCloses = (sql.match(/^\$\$;$/gm) ?? []).length;
      expect(asOpens).toBe(asCloses);
    });
  }
});

describe('20260916120000 — security hardening migration content', () => {
  it('§1 returns a non-NULL sentinel for a deactivated profile (NULL would OPEN role gates)', () => {
    expect(SECURITY_SQL).toContain(
      "select case when sp.is_active then sp.role_key else 'inactive' end",
    );
    // The earlier, unsafe form filtered inactive rows out and returned NULL.
    expect(SECURITY_SQL).not.toMatch(
      /where sp\.auth_user_id = \(select auth\.uid\(\)\)\s+and sp\.is_active\s+limit 1/,
    );
  });

  it('§2 only REVOKES — it never grants a definer function to authenticated in bulk', () => {
    expect(SECURITY_SQL).toContain(
      "execute format('revoke all on function %s from public, anon', v_sig);",
    );
    expect(SECURITY_SQL).not.toContain('grant execute on function %s to authenticated');
    expect(SECURITY_SQL).toContain("'webhook_store_pancake_live_comment'");
    expect(SECURITY_SQL).toContain("'webhook_upsert_conversation_identity'");
  });

  it('§3/§4 gate order_completion_block and refuse deleting an Owner', () => {
    expect(SECURITY_SQL).toMatch(
      /order_completion_block[\s\S]*?if not app_private\.is_active_staff\(\)/,
    );
    expect(SECURITY_SQL).toContain("if v_target_role = 'owner' then");
  });

  it('§5 keeps a usable Owner: demo owners do not count and removals are serialized', () => {
    expect(SECURITY_SQL).toContain(
      'lock table public.staff_profiles in share row exclusive mode;',
    );
    expect(SECURITY_SQL).toContain(
      "sp.role_key = 'owner' and sp.is_active and not sp.is_demo",
    );
    expect(SECURITY_SQL).toContain('create trigger staff_profiles_owner_floor');
  });

  it('§6 narrows audit reads but keeps the per-order history for staff', () => {
    expect(SECURITY_SQL).toMatch(
      /create policy audit_read[\s\S]*?app_private\.is_owner\(\)/,
    );
    expect(SECURITY_SQL).toContain(
      "(app_private.is_active_staff() and entity_type = 'official_order')",
    );
  });

  it('§7 syncs payment status atomically and never rewrites historical payments', () => {
    expect(SECURITY_SQL).toContain('create trigger payment_verifications_sync_status');
    expect(SECURITY_SQL).not.toMatch(
      /update public\.payments p\s+set status = v\.outcome/,
    );
    expect(SECURITY_SQL).toContain('raise notice');
  });

  it('§8/§9/§10: Manila work_date, Owner-gated session revoke, device-checked kiosk', () => {
    expect(SECURITY_SQL).toContain(
      "set default ((now() at time zone 'Asia/Manila')::date)",
    );
    expect(SECURITY_SQL).toMatch(
      /create or replace function public\.revoke_staff_sessions[\s\S]*?if not app_private\.is_owner\(\)/,
    );
    expect(SECURITY_SQL).toContain(
      'delete from auth.sessions where user_id = v_auth_user_id;',
    );
    expect(SECURITY_SQL).toContain(
      "raise exception 'This device is not an approved time clock.'",
    );
  });
});

describe('20260916130000 — index migration can apply on either pg_trgm layout', () => {
  it('resolves the trigram operator class schema at apply time', () => {
    expect(INDEX_SQL).not.toContain('extensions.gin_trgm_ops');
    expect(INDEX_SQL).toContain('pg_catalog.pg_opclass');
  });

  it('guards the index on the live-only layaway_ledger table', () => {
    expect(INDEX_SQL).toContain(
      "table_name = 'layaway_ledger' and column_name = 'inventory_item_id'",
    );
  });

  it('creates the hot-path indexes the audit identified', () => {
    for (const name of [
      'audit_events_occurred_at_idx',
      'payments_recorded_at_idx',
      'payments_unverified_idx',
      'customers_display_name_idx',
      'capture_records_floating_open_idx',
    ]) {
      expect(INDEX_SQL).toContain(name);
    }
  });
});
