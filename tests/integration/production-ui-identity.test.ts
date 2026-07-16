import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Production UI integration — Batch 1 groundwork: real identity, no prototype
 * contamination, /preview unreachable in production.
 *
 * The prototype under /preview is the approved VISUAL reference, and it is full
 * of hardcoded sample identity ("A.V. Owner", "Owner") and sample business
 * records. Applying its look to production must not drag any of that across.
 * These assertions guard the boundary the reskin has to hold.
 */

const projectRoot = join(__dirname, '..', '..');
const srcRoot = join(projectRoot, 'src');

function read(relative: string): string {
  return readFileSync(join(srcRoot, relative), 'utf8');
}

/**
 * Source with comments stripped. Negative assertions ("must NOT contain the
 * hardcoded name") read CODE — a comment saying "never A.V. Owner" is the rule
 * being honoured, not broken.
 */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Files that make up the production application shell (NOT the prototype). */
const PRODUCTION_SHELL = [
  'app/(app)/layout.tsx',
  'components/shell/app-shell.tsx',
  'components/shell/app-header.tsx',
];

describe('the shell shows REAL authenticated identity, never hardcoded', () => {
  it('the header renders identity from props, not a literal name', () => {
    const header = code('components/shell/app-header.tsx');

    // No hardcoded prototype identity anywhere in the production header.
    expect(header).not.toMatch(/A\.V\.\s*Owner/);
    // The name is rendered from the prop.
    expect(header).toMatch(/\{fullName\}/);
    expect(header).toMatch(/data-testid="authenticated-full-name"/);
  });

  it('the identity comes from the caller’s own profile via a self-read', () => {
    const guard = code('lib/authz/guard.ts');
    expect(guard).toMatch(/export async function getCurrentStaffProfile/);
    // Reads staff_profiles for the caller’s own auth_user_id — the self-read
    // policy, not a hardcoded value.
    expect(guard).toMatch(/from\('staff_profiles'\)/);
    expect(guard).toMatch(/\.eq\('auth_user_id', staff\.authUserId\)/);
    // Never falls back to a fabricated real-looking name.
    expect(guard).not.toMatch(/A\.V\.\s*Owner/);
  });

  it('the layout wires the real profile into the shell', () => {
    const layout = read('app/(app)/layout.tsx');
    expect(layout).toMatch(/getCurrentStaffProfile/);
    expect(layout).toMatch(/fullName=\{profile\.fullName\}/);
  });
});

describe('no prototype contamination in the production shell', () => {
  it.each(PRODUCTION_SHELL)('%s imports nothing from components/preview', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/@\/components\/preview/);
    expect(source).not.toMatch(/sample-data|dashboard-data|layaway-data/);
  });

  it('no production route imports a prototype fixture', () => {
    const appFiles = globSync('app/(app)/**/*.tsx', { cwd: srcRoot });
    expect(appFiles.length).toBeGreaterThan(5);

    for (const file of appFiles) {
      const source = read(file);
      expect(
        source.includes('@/components/preview'),
        `${file} must not import the prototype`,
      ).toBe(false);
    }
  });
});

describe('/preview stays unreachable in production', () => {
  it('the preview layout still 404s when NODE_ENV is production', () => {
    const previewLayout = read('app/(preview)/preview/layout.tsx');
    expect(previewLayout).toMatch(/process\.env\.NODE_ENV === 'production'/);
    expect(previewLayout).toMatch(/notFound\(\)/);
  });

  it('no production route links into /preview', () => {
    for (const file of PRODUCTION_SHELL) {
      expect(read(file)).not.toMatch(/href=["'`]\/preview/);
    }
  });
});
