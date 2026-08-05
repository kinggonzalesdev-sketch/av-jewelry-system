import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MFA_ENFORCEMENT_IMPLEMENTED, APPROVED_MFA_METHOD } from '@/lib/auth/mfa';
import {
  ALL_OWNER_ONLY_ACTIONS,
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  permissionsForRole,
  ROLES,
} from '@/lib/authz/permissions';
import {
  MINIMUM_PASSWORD_LENGTH,
  passwordSchema,
  signInSchema,
} from '@/lib/validation/auth';

const projectRoot = join(__dirname, '..', '..');

function collectFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full, pattern);
    return pattern.test(full) ? [full] : [];
  });
}

/**
 * Strips comments before scanning source for forbidden constructs.
 *
 * Without this, these guards match their own documentation: a comment reading
 * "there is deliberately no ROLE_PERMISSIONS map" would fail the very test
 * asserting no ROLE_PERMISSIONS map exists. We are asserting things about CODE,
 * so the prose must be removed first.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* block */
    .replace(/^\s*\/\/.*$/gm, '') // // line
    .replace(/^\s*--.*$/gm, ''); // -- sql line
}

function readCode(...segments: string[]): string {
  return stripComments(readFileSync(join(projectRoot, ...segments), 'utf8'));
}

describe('permission catalog (approved 23 + Portal & Access)', () => {
  it('keeps the original 23 approved permissions', () => {
    // The Portal & Access catalogue (Owner request) ADDED keys; it never removed
    // one. The original 23 must all still be here.
    for (const key of [
      'claim_capture', 'claim_review', 'confirm_claim_print_label',
      'invoice_preparation', 'payment_verification', 'layaway_monitoring',
      'fulfillment_preparation', 'fulfillment_release', 'existing_record_entry',
      'live_batch_operation', 'live_batch_closure', 'current_flex_item_control',
      'item_withdrawal', 'post_live_item_entry', 'message_preparation',
      'message_sending', 'retry_reprint_label', 'void_cancel_label_job',
      'export_data_reports', 'payment_correction', 'inventory_monitoring',
      'miner_allocation_review', 'initiate_high_risk_action',
    ]) {
      expect(ALL_PERMISSION_KEYS).toContain(key);
    }
  });

  it('adds the Portal & Access keys that gate pages and record actions', () => {
    for (const key of [
      'nav_dashboard', 'nav_orders', 'nav_customers', 'nav_inventory',
      'nav_payments', 'nav_layaway', 'nav_scrap', 'view_reports', 'view_settings',
      'order_add_deposit', 'order_cancel', 'fulfillment_delivery',
      'fulfillment_shipping', 'fulfillment_pickup', 'customer_edit',
      'customer_delete', 'inventory_edit', 'inventory_delete', 'hr_attendance',
      'hr_review_attendance', 'hr_payroll',
    ]) {
      expect(ALL_PERMISSION_KEYS).toContain(key);
    }
  });

  it('includes the three permissions named directly in Bible §22', () => {
    expect(ALL_PERMISSION_KEYS).toContain(PERMISSIONS.INVENTORY_MONITORING);
    expect(ALL_PERMISSION_KEYS).toContain(PERMISSIONS.MINER_ALLOCATION_REVIEW);
    expect(ALL_PERMISSION_KEYS).toContain(PERMISSIONS.INITIATE_HIGH_RISK_ACTION);
  });

  it('keeps every permission distinct — none is an alias of another', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('matches the permission catalog seeded in the database migrations', () => {
    // The TypeScript catalog and the SQL seeds must not drift apart. The original
    // 23 live in the phase-1 migration; the Portal & Access keys were added later;
    // Edit/Delete Layaway were added later still (each new migration is immutable,
    // so a new key seeds in its own file rather than editing an applied one).
    const migration = [
      readFileSync(
        join(
          projectRoot,
          'supabase',
          'migrations',
          '20260715120100_phase1_identity_access.sql',
        ),
        'utf8',
      ),
      readFileSync(
        join(
          projectRoot,
          'supabase',
          'migrations',
          '20260729120000_portal_access_permissions.sql',
        ),
        'utf8',
      ),
      readFileSync(
        join(
          projectRoot,
          'supabase',
          'migrations',
          '20260805120000_layaway_edit_delete_permissions.sql',
        ),
        'utf8',
      ),
      readFileSync(
        join(
          projectRoot,
          'supabase',
          'migrations',
          '20260805140000_manage_access_redesign.sql',
        ),
        'utf8',
      ),
    ].join('\n');

    for (const key of ALL_PERMISSION_KEYS) {
      expect(migration, `permission ${key} must exist in the migration`).toContain(
        `'${key}'`,
      );
    }
  });

  it('defines exactly three roles', () => {
    expect(Object.values(ROLES)).toEqual(['owner', 'selected_admin', 'staff']);
  });

  it('defines exactly the six non-delegable Owner actions', () => {
    expect(ALL_OWNER_ONLY_ACTIONS).toHaveLength(6);
    expect(ALL_OWNER_ONLY_ACTIONS).toContain('official_order_cancellation');
    expect(ALL_OWNER_ONLY_ACTIONS).toContain('layaway_forfeiture');
    expect(ALL_OWNER_ONLY_ACTIONS).toContain('price_override');
    expect(ALL_OWNER_ONLY_ACTIONS).toContain('exceptional_fulfillment_release');
    expect(ALL_OWNER_ONLY_ACTIONS).toContain('live_batch_reopen');
    expect(ALL_OWNER_ONLY_ACTIONS).toContain('wrong_payment_to_order_correction');
  });

  it('has no general role-to-permission map; only the approved Owner rule confers by role', () => {
    // A general ROLE_PERMISSIONS map would make ANY role imply permissions —
    // forbidden for Selected Admin / Staff (Bible §5.13). Its absence stands.
    const source = readCode('src', 'lib', 'authz', 'permissions.ts');
    expect(source).not.toMatch(/ROLE_PERMISSIONS|roleGrants/);

    // The ONE approved role rule (Owner-approved): the Owner is the main
    // administrator and holds every permission (Bible §5); every other role
    // holds ONLY its explicit grants — role title is still not authority for them.
    expect(permissionsForRole('owner', []).size).toBe(ALL_PERMISSION_KEYS.length);
    expect(permissionsForRole('staff', []).size).toBe(0);
    expect(
      permissionsForRole('selected_admin', ['claim_review']).has('claim_review'),
    ).toBe(true);
    expect(
      permissionsForRole('staff', ['claim_review']).has('payment_verification'),
    ).toBe(false);
  });
});

describe('password policy', () => {
  it('requires at least 12 characters', () => {
    expect(MINIMUM_PASSWORD_LENGTH).toBe(12);
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true);
  });

  it('does not apply the length policy at sign-in', () => {
    // Applying it here would tell a legitimate user with an older password that it
    // is "invalid" rather than wrong, leaking policy state and blocking reset.
    const result = signInSchema.safeParse({
      email: 'staff@example.com',
      password: 'short',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an empty password at sign-in', () => {
    expect(signInSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(
      false,
    );
  });

  it('implements no custom password hashing anywhere', () => {
    const sources = collectFiles(join(projectRoot, 'src'), /\.(ts|tsx)$/);
    const offenders = sources.filter((file) =>
      /\b(bcrypt|scrypt|argon2|pbkdf2|createHash\(['"]sha)/i.test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    );

    expect(offenders).toEqual([]);
  });
});

describe('MFA status is not overclaimed', () => {
  it('records TOTP as the approved method', () => {
    expect(APPROVED_MFA_METHOD).toBe('totp');
  });

  it('does not claim MFA enforcement is implemented', () => {
    // This guard is deliberate: flipping the flag without real enforcement fails here.
    expect(MFA_ENFORCEMENT_IMPLEMENTED).toBe(false);
  });

  it('implements no SMS, WhatsApp, or email MFA', () => {
    const mfa = readCode('src', 'lib', 'auth', 'mfa.ts');

    expect(mfa).not.toMatch(/factorType:\s*['"]phone['"]/);
    expect(mfa).not.toMatch(/\bsendSms\b|\bwhatsapp\b/i);
  });

  it('invents no unsupported recovery API', () => {
    const mfa = readCode('src', 'lib', 'auth', 'mfa.ts');

    expect(mfa).not.toMatch(/recoveryCode|backupCode|generateRecovery/i);
  });
});

describe('server-side authorization boundary', () => {
  const guardRaw = readFileSync(
    join(projectRoot, 'src', 'lib', 'authz', 'guard.ts'),
    'utf8',
  );
  const guard = stripComments(guardRaw);

  it('exposes the required guards', () => {
    for (const fn of [
      'requireAuthenticatedStaff',
      'requireActiveStaff',
      'requirePermission',
      'requireScope',
      'requireOwner',
      'requireOwnerApprovalAuthority',
      'requireAal2',
    ]) {
      // Either a plain async function, or the request-cached form
      // `export const fn = cache(async ...` (a perf dedupe; same guard).
      expect(guard, `${fn} must exist`).toMatch(
        new RegExp(
          `export async function ${fn}\\b|export const ${fn} = cache\\(async\\b`,
        ),
      );
    }
  });

  it('derives permissions from explicit grants, never from role_key', () => {
    // getGrantedPermissions must query the grants table and must not branch on role.
    expect(guard).toMatch(/from\('staff_permission_grants'\)/);
    expect(guard).not.toMatch(/roleKey === 'selected_admin'\s*\)\s*return true/);
  });

  it('fails closed when the grant list cannot be read', () => {
    expect(guard).toMatch(/return new Set\(\)/);
  });

  it('keeps Owner-approval authority separate from any permission', () => {
    // requireOwnerApprovalAuthority must not consult has_permission: no permission
    // confers Owner authority.
    const fnBody = guard.slice(
      guard.indexOf('export async function requireOwnerApprovalAuthority'),
    );
    const untilNext = fnBody.slice(0, fnBody.indexOf('\n}'));

    expect(untilNext).not.toMatch(/hasPermission|requirePermission/);
    expect(untilNext).toMatch(/roleKey !== 'owner'/);
  });

  it('is server-only', () => {
    expect(guardRaw).toMatch(/^import 'server-only';/m);
  });
});

describe('no public registration and no customer login', () => {
  const appDir = join(projectRoot, 'src', 'app');

  it('exposes no sign-up or customer-login route', () => {
    const files = collectFiles(appDir, /\.(ts|tsx)$/);
    const offenders = files.filter((f) =>
      /(sign-up|signup|register|create-account|customer-login|customer-portal)/i.test(f),
    );

    expect(offenders).toEqual([]);
  });

  it('calls no Supabase signUp anywhere', () => {
    const sources = collectFiles(join(projectRoot, 'src'), /\.(ts|tsx)$/);
    const offenders = sources.filter((f) =>
      /auth\s*\.\s*signUp\s*\(/.test(readFileSync(f, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

describe('RLS policy migration hygiene', () => {
  const policySql = readCode(
    'supabase',
    'migrations',
    '20260715130100_phase2_rls_policies.sql',
  );

  it('grants no policy to anon', () => {
    expect(policySql).not.toMatch(/create policy[\s\S]{0,200}?\bto\s+anon\b/i);
  });

  it('creates no unconditional using(true) or with check(true) policy', () => {
    expect(policySql).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(policySql).not.toMatch(/with check\s*\(\s*true\s*\)/i);
  });

  it('never grants delete to authenticated (records are not destroyed)', () => {
    expect(policySql).toMatch(
      /revoke delete on all tables in schema public from authenticated/i,
    );
  });

  it('pins search_path on every security definer helper', () => {
    // Comments are stripped first, so prose about SECURITY DEFINER cannot skew
    // the count — only real declarations are compared.
    const helpers = readCode(
      'supabase',
      'migrations',
      '20260715130000_phase2_authz_helpers.sql',
    );

    const definerCount = (helpers.match(/security definer/gi) ?? []).length;
    const pinnedCount = (helpers.match(/set search_path = ''/gi) ?? []).length;

    expect(definerCount).toBeGreaterThan(0);
    expect(pinnedCount).toBeGreaterThanOrEqual(definerCount);
  });
});
