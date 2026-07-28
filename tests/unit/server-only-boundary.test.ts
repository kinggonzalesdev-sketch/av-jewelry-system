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

  it('has exactly ONE sanctioned caller: the Owner-gated, server-only team-accounts', () => {
    // Owner request 2026-07-22: account creation/reset from the UI was enabled
    // (a deliberate override of ADR §11's "boundary only" default). The single
    // permitted caller of the service-role client is lib/authz/team-accounts.ts —
    // and it MUST be server-only and re-check Owner before touching the client.
    const sourceFiles = collectSourceFiles(srcDir).filter(
      (file) => file !== adminModulePath,
    );

    const callers = sourceFiles.filter((file) =>
      /from\s+['"][^'"]*supabase\/admin['"]/.test(readFileSync(file, 'utf8')),
    );

    expect(callers).toHaveLength(1);
    expect(callers[0]).toMatch(/team-accounts\.ts$/);

    const teamAccounts = readFileSync(callers[0] as string, 'utf8');
    expect(teamAccounts).toMatch(/^import 'server-only';/m);
    expect(teamAccounts).toMatch(/requireOwner\(\)/);
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
