import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MFA_ENFORCEMENT_IMPLEMENTED, APPROVED_MFA_METHOD } from '@/lib/auth/mfa';
import {
  ALL_OWNER_ONLY_ACTIONS,
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
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

describe('permission catalog (approved 23)', () => {
  it('contains exactly 23 permissions', () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(23);
  });

  it('includes the three permissions named directly in Bible §22', () => {
    expect(ALL_PERMISSION_KEYS).toContain(PERMISSIONS.INVENTORY_MONITORING);
    expect(ALL_PERMISSION_KEYS).toContain(PERMISSIONS.MINER_ALLOCATION_REVIEW);
    expect(ALL_PERMISSION_KEYS).toContain(PERMISSIONS.INITIATE_HIGH_RISK_ACTION);
  });

  it('keeps every permission distinct — none is an alias of another', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('matches the permission catalog seeded in the database migration', () => {
    // The TypeScript catalog and the SQL seed must not drift apart.
    const migration = readFileSync(
      join(
        projectRoot,
        'supabase',
        'migrations',
        '20260715120100_phase1_identity_access.sql',
      ),
      'utf8',
    );

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

  it('defines no role-to-permission mapping (role title is not authority)', () => {
    // A ROLE_PERMISSIONS map would make role imply permission — exactly what the
    // Bible forbids. Its absence is the guarantee, so assert the absence.
    const source = readCode('src', 'lib', 'authz', 'permissions.ts');

    expect(source).not.toMatch(/ROLE_PERMISSIONS|roleGrants|permissionsForRole/);
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
      expect(guard, `${fn} must exist`).toMatch(
        new RegExp(`export async function ${fn}\\b`),
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
