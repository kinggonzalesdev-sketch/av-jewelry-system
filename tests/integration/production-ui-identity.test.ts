import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRIMARY_NAV } from '@/components/shell/navigation';

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
  'components/shell/app-sidebar.tsx',
  'components/shell/navigation.ts',
  'components/shell/theme-toggle.tsx',
  'components/shell/printer-status.tsx',
  'components/shell/unavailable.tsx',
];

/** The production route file backing a nav href (page or, for /, root page). */
function routeFileFor(href: string): string {
  return join(srcRoot, 'app', '(app)', ...href.replace(/^\//, '').split('/'), 'page.tsx');
}

describe('the shell shows REAL authenticated identity, never hardcoded', () => {
  it('the sidebar user card renders identity from props, not a literal name', () => {
    const sidebar = code('components/shell/app-sidebar.tsx');

    // The prototype hardcoded "A.V. Owner / Owner" in its user card. The
    // production sidebar must not — the name comes from the prop.
    expect(sidebar).not.toMatch(/A\.V\.\s*Owner/);
    expect(sidebar).toMatch(/\{fullName\}/);
    expect(sidebar).toMatch(/data-testid="authenticated-full-name"/);
    expect(sidebar).toMatch(/data-testid="authenticated-role"/);
  });

  it('keeps the approved footer branding, exact wording', () => {
    const sidebar = read('components/shell/app-sidebar.tsx');
    expect(sidebar).toMatch(/Powered by King GenZ Digital/);
  });

  it('the identity comes from the caller’s own profile via a self-read', () => {
    const guard = code('lib/authz/guard.ts');
    // Request-cached (perf) form of the same self-read guard.
    expect(guard).toMatch(/export const getCurrentStaffProfile = cache\(async/);
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

  it('Logout runs the real signOut server action, not a dead button', () => {
    const sidebar = read('components/shell/app-sidebar.tsx');
    expect(sidebar).toMatch(/import \{ signOut \}/);
    expect(sidebar).toMatch(/signOut\(\)/);
  });

  it('every primary nav item resolves to a real route — no dead links, no 404', () => {
    // Owner-approved decision: keep the approved prototype nav order verbatim.
    // Items whose finished screen is not built (Customers/Reports/Settings) must
    // still be REAL routes rendering an honest "unavailable" state — never a 404.
    for (const item of PRIMARY_NAV) {
      expect(
        existsSync(routeFileFor(item.href)),
        `${item.label} (${item.href}) must have a production page`,
      ).toBe(true);
    }
  });

  it('unbuilt nav items render an HONEST unavailable state, not fake content', () => {
    for (const item of PRIMARY_NAV.filter((i) => !i.available)) {
      const rel = join('app', '(app)', item.href.replace(/^\//, ''), 'page.tsx');
      const source = read(rel);
      // Honest placeholder — the shared UnavailablePage, never sample fixtures.
      expect(source).toMatch(/UnavailablePage/);
      expect(source).not.toMatch(/sample-data|dashboard-data|layaway-data/);
      expect(source).not.toMatch(/@\/components\/preview/);
    }
  });

  it('does not promote Staff or Capabilities to standalone primary nav items', () => {
    const navHrefs = PRIMARY_NAV.map((i) => i.href);
    // They stay functional routes, reachable outside the primary nav.
    expect(navHrefs).not.toContain('/admin/staff');
    expect(navHrefs).not.toContain('/admin/capabilities');
    expect(existsSync(routeFileFor('/admin/staff'))).toBe(true);
    expect(existsSync(routeFileFor('/admin/capabilities'))).toBe(true);
  });

  it('Settings is a real page: Portal & Access (Owner) + Integrations', () => {
    const settings = read('app/(app)/settings/page.tsx');
    expect(settings).not.toMatch(/A\.V\.\s*Owner/);
    // Owner request 2026-07-22: the read-only Profile card was removed and the
    // Owner-only Team Members portal was added. The self-service Change-my-password
    // card was later removed too — the Owner sets passwords from that panel.
    expect(settings).toMatch(/TeamMembersPanel/);
    expect(settings).not.toMatch(/ChangePasswordForm/);
    // The team roster is gated on the Owner (the service-role admin path).
    expect(settings).toMatch(/isOwner/);
    // Owner request 2026-08-09: the Super Admin sees the full settings — Integration
    // + System Diagnostics restored — while Live Operations now shows Test Print +
    // Sticker Settings inline (and is visible to any granted settings-viewer).
    expect(settings).toMatch(/PrinterTestCard/);
    expect(settings).toMatch(/StickerSettingsCard/);
    expect(settings).toMatch(/href="\/settings\/messages"/);
    expect(settings).toMatch(/href="\/admin\/integrations"/);
    expect(settings).not.toMatch(/href="\/admin\/staff"/);
    expect(settings).not.toMatch(/href="\/admin\/capabilities"/);
    expect(settings).not.toMatch(/href="\/security"/);
    expect(settings).not.toMatch(/PrinterStatusRow/);
    expect(settings).not.toMatch(/ThemeToggle/);
    expect(settings).not.toMatch(/UnavailablePage/);
  });

  it('never imports the service-role admin client into a Client Component', () => {
    // The admin path (team-accounts) is server-only; the panel imports it TYPE-only.
    const panel = read('components/settings/team-members-panel.tsx');
    expect(panel).toMatch(/'use client'/);
    expect(panel).not.toMatch(/@\/lib\/supabase\/admin/);
    // The account operations re-check Owner before the service-role client.
    const accounts = read('lib/authz/team-accounts.ts');
    expect(accounts).toMatch(/requireOwner\(\)/);
    expect(accounts).toMatch(/createAdminClient/);
  });

  it('surfaces the New Order capture form inside Orders — not a nav item', () => {
    const orders = read('app/(app)/orders/page.tsx');
    const workflow = read('components/orders/new-order-workflow.tsx');
    // Capture is an action IN Orders: the New Order form, gated on the capture
    // permission, wired to the real capture flow — it never re-implements it. The
    // old "New Entry → /live" link + Invoice/Confirm/Layaway shortcuts were
    // removed by Owner request (2026-07-18) as duplicates of the sidebar nav.
    expect(orders).toMatch(/NewOrderWorkflow/);
    expect(orders).toMatch(/claim_capture/);
    expect(workflow).toMatch(/captureManualOrderAction/);
    // And it is NOT a sidebar item.
    expect(PRIMARY_NAV.some((i) => /new (entry|order)/i.test(i.label))).toBe(false);
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
