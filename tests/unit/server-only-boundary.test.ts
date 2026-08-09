import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The privileged Supabase client must never be reachable from browser code
 * (ADR §11, Bible §30.15, Invariant #15).
 *
 * Enforcement is layered:
 *   1. `server-only` import   — fails the BUILD if a Client Component reaches it
 *   2. ESLint no-restricted-imports — fails the LINT gate earlier and more clearly
 *   3. These tests            — fail the TEST gate and document the intent
 *
 * Each layer is independent; none is sufficient alone.
 */

const projectRoot = join(__dirname, '..', '..');
const srcDir = join(projectRoot, 'src');

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);

    if (statSync(fullPath).isDirectory()) {
      return collectSourceFiles(fullPath);
    }

    return /\.(ts|tsx)$/.test(fullPath) ? [fullPath] : [];
  });
}

describe('privileged Supabase client isolation', () => {
  const adminModulePath = join(srcDir, 'lib', 'supabase', 'admin.ts');
  const adminSource = readFileSync(adminModulePath, 'utf8');

  it("marks the privileged module 'server-only'", () => {
    expect(adminSource).toMatch(/^import 'server-only';/m);
  });

  it('reads the service-role key only through the guarded accessor', () => {
    // Direct `process.env.SUPABASE_SERVICE_ROLE_KEY` access would skip the
    // throw-if-absent guard and could silently produce an under-privileged client.
    expect(adminSource).toMatch(/requireServiceRoleKey\(\)/);
  });

  it('never marks the service-role key as NEXT_PUBLIC', () => {
    const sourceFiles = collectSourceFiles(srcDir);

    const leaking = sourceFiles.filter((file) =>
      /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(readFileSync(file, 'utf8')),
    );

    expect(leaking).toEqual([]);
  });

  it('is not imported by any client component', () => {
    const sourceFiles = collectSourceFiles(srcDir);

    const clientFilesImportingAdmin = sourceFiles.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      const isClientComponent = /^\s*['"]use client['"]/m.test(contents);
      const importsAdmin = /from\s+['"][^'"]*supabase\/admin['"]/.test(contents);

      return isClientComponent && importsAdmin;
    });

    expect(clientFilesImportingAdmin).toEqual([]);
  });

  it('has exactly the sanctioned callers of the privileged client, each server-only', () => {
    // The service-role client bypasses RLS, so its callers are an explicit, audited
    // whitelist. Each MUST be server-only and carry its OWN authorization:
    //   - lib/authz/team-accounts.ts — Owner-gated (requireOwner); UI account
    //     create/reset (Owner request 2026-07-22, a deliberate ADR §11 override).
    //   - lib/integrations/pancake-system.ts — the daily Pancake link sync; it has no
    //     user session, so its authority is the CRON_SECRET check in its only caller,
    //     the /api/cron/pancake-sync route.
    //   - lib/integrations/pancake-webhook.ts — realtime Pancake identity ingest; no
    //     user session, so its authority is the PANCAKE_WEBHOOK_SECRET check in its only
    //     caller, the /api/webhooks/pancake route. The write is strictly fill-only.
    const sanctioned = [/team-accounts\.ts$/, /pancake-system\.ts$/, /pancake-webhook\.ts$/];

    const sourceFiles = collectSourceFiles(srcDir).filter(
      (file) => file !== adminModulePath,
    );
    const callers = sourceFiles.filter((file) =>
      /from\s+['"][^'"]*supabase\/admin['"]/.test(readFileSync(file, 'utf8')),
    );

    // No UNSANCTIONED caller slipped in, and there are exactly as many as we sanction.
    for (const caller of callers) {
      expect(sanctioned.some((re) => re.test(caller))).toBe(true);
      // Every caller of the RLS-bypassing client must itself be server-only.
      expect(readFileSync(caller, 'utf8')).toMatch(/^import 'server-only';/m);
    }
    expect(callers).toHaveLength(sanctioned.length);

    // team-accounts re-checks Owner before touching the client ...
    const teamAccounts = callers.find((f) => /team-accounts\.ts$/.test(f));
    expect(teamAccounts).toBeDefined();
    expect(readFileSync(teamAccounts as string, 'utf8')).toMatch(/requireOwner\(\)/);

    // ... and the Pancake system sync is reachable only through the CRON_SECRET-gated
    // route (its authority, since it has no user session).
    const cronRoute = readFileSync(
      join(srcDir, 'app', 'api', 'cron', 'pancake-sync', 'route.ts'),
      'utf8',
    );
    expect(cronRoute).toMatch(/CRON_SECRET/);

    // ... and the Pancake webhook ingest is reachable only through the
    // PANCAKE_WEBHOOK_SECRET-gated route (its authority, since it has no user session).
    const webhookRoute = readFileSync(
      join(srcDir, 'app', 'api', 'webhooks', 'pancake', 'route.ts'),
      'utf8',
    );
    expect(webhookRoute).toMatch(/PANCAKE_WEBHOOK_SECRET/);
  });
});

describe("server-side modules are marked 'server-only'", () => {
  const serverModules = [
    join(srcDir, 'lib', 'supabase', 'server.ts'),
    join(srcDir, 'lib', 'supabase', 'admin.ts'),
    join(srcDir, 'lib', 'auth', 'session.ts'),
    join(srcDir, 'lib', 'auth', 'mfa.ts'),
    join(srcDir, 'lib', 'authz', 'guard.ts'),
  ];

  it.each(serverModules)('%s imports server-only', (modulePath) => {
    expect(readFileSync(modulePath, 'utf8')).toMatch(/^import 'server-only';/m);
  });
});

describe('browser client uses only the public key', () => {
  it('never references the service-role key', () => {
    const browserClient = readFileSync(
      join(srcDir, 'lib', 'supabase', 'client.ts'),
      'utf8',
    );

    expect(browserClient).not.toMatch(/SERVICE_ROLE/);
    expect(browserClient).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
