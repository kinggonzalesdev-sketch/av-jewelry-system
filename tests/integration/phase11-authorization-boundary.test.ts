import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Phase 11 — Integration sweep across the authorization boundary
 * (Bible §29.3-29.4, §30.3 r1-r3; §34.3 stage 4; roadmap invariant #1).
 *
 * Stage 4 is "integration testing — module interactions". The interaction that
 * matters most in this codebase is the one between a server action (transport)
 * and the domain module behind it (authority). The architecture puts every
 * permission check in the domain module and the database, so an action that
 * reaches the database directly would be a real hole: it would be callable from
 * a crafted request with no permission check anywhere in the path.
 *
 * These are static assertions over the whole of src/lib rather than a mocked
 * call, on purpose. A mocked test proves the module you mocked; this proves no
 * module ANYWHERE took the shortcut — including the ones a future phase adds.
 * That is the cross-phase question stage 4 exists to ask, and it is why these
 * live in tests/integration rather than beside a single phase's unit tests.
 */

const projectRoot = join(__dirname, '..', '..');
const libRoot = join(projectRoot, 'src', 'lib');

const GUARD_CALL =
  /requirePermission|requireOwnerApprovalAuthority|requireOwner|requireActiveStaff|requireAuthenticatedStaff/;
const DIRECT_DB = /supabase\/server|supabase\/admin|createClient|createServerClient/;
const WRITE_CALL = /\.insert\(|\.update\(|\.delete\(/;

function libFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: libRoot }).map((p) => p.replace(/\\/g, '/'));
}

function read(relative: string): string {
  return readFileSync(join(libRoot, relative), 'utf8');
}

/**
 * Actions that legitimately reach the database without a guard in front.
 *
 * Both are principled, not grandfathered:
 *   - auth/actions.ts signs a user IN. Requiring an authenticated staff member
 *     in order to authenticate would be circular; there is no session yet.
 *   - audit/log.ts records what happened, INCLUDING denials (Bible §31: denials
 *     and failures are logged too). If writing an audit row required the
 *     permission being denied, a denial could never be recorded — the logger
 *     would fail exactly when it matters most.
 *
 * Anything else appearing here is a finding, not a new exception.
 */
const AUTHORIZED_EXCEPTIONS = {
  'auth/actions.ts': 'sign-in cannot require an authenticated session',
  'audit/log.ts': 'logging a denial cannot require the permission that was denied',
} as const;

describe('server actions are transport only (Bible §29.3, invariant #1)', () => {
  const actionFiles = libFiles('*/actions.ts');

  it('finds the action modules to check', () => {
    // A guard on the guard: if the glob silently matched nothing, every
    // assertion below would vacuously pass and prove nothing.
    expect(actionFiles.length).toBeGreaterThanOrEqual(9);
  });

  it.each(actionFiles.filter((f) => !(f in AUTHORIZED_EXCEPTIONS)))(
    '%s reaches the database only through a guarded domain module',
    (file) => {
      expect(read(file)).not.toMatch(DIRECT_DB);
    },
  );

  it('documents every exception with a reason', () => {
    for (const [file, reason] of Object.entries(AUTHORIZED_EXCEPTIONS)) {
      expect(reason.length).toBeGreaterThan(20);
      // The exception must still exist; a stale entry silently widens the rule.
      expect(() => read(file)).not.toThrow();
    }
  });
});

describe('every writing domain module checks permission (Bible §30.3 r3)', () => {
  const writingModules = libFiles('**/*.ts')
    .filter((f) => !f.endsWith('actions.ts'))
    .filter((f) => WRITE_CALL.test(read(f)));

  it('finds the writing modules to check', () => {
    expect(writingModules.length).toBeGreaterThan(5);
  });

  it.each(writingModules.filter((f) => !(f in AUTHORIZED_EXCEPTIONS)))(
    '%s calls a guard before writing',
    (file) => {
      expect(read(file)).toMatch(GUARD_CALL);
    },
  );
});

describe('the audit logger stays able to record denials (Bible §31)', () => {
  const log = read('audit/log.ts');

  it('does not require a permission in order to log', () => {
    // This is the inverse of the rule above, asserted deliberately: the moment
    // audit/log.ts starts guarding, denial logging breaks silently and the
    // audit stops recording exactly the events it exists to record.
    expect(log).not.toMatch(/requirePermission\(/);
  });

  it('records denied and failed outcomes, not only successes', () => {
    expect(log).toMatch(/denied/);
    expect(log).toMatch(/failed/);
  });
});
