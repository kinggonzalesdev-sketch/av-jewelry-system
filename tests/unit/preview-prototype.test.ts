import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PREVIEW_NAV } from '@/components/preview/shell';
import {
  SAMPLE_ORDERS,
  computeInvoiceEligibility,
} from '@/components/preview/sample-data';

/**
 * Guards for the UI review prototype.
 *
 * The prototype is allowed to be fake — that is its job. These tests make sure it
 * stays fake in the SAFE ways: isolated from production, honest about what does
 * not work, and unreachable in production.
 */

const projectRoot = join(__dirname, '..', '..');

function collect(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collect(full, pattern);
    return pattern.test(full) ? [full] : [];
  });
}

describe('prototype navigation', () => {
  it('uses the Owner-approved sidebar order', () => {
    expect(PREVIEW_NAV.map((n) => n.label)).toEqual([
      'Orders',
      'Invoice',
      'Live',
      'Customers',
      'Items / Inventory',
      'Payments',
      'Fulfillment',
      'Reports',
      'Settings',
    ]);
  });

  it('has no separate multi-platform Connections tab', () => {
    expect(PREVIEW_NAV.map((n) => n.label)).not.toContain('Connections');
  });

  it('lands on Orders, not Live', () => {
    const index = readFileSync(
      join(projectRoot, 'src', 'app', '(preview)', 'preview', 'page.tsx'),
      'utf8',
    );

    expect(index).toContain("redirect('/preview/orders')");
    expect(index).not.toContain("redirect('/preview/live')");
  });
});

describe('prototype is isolated from production', () => {
  it('is not imported by any production source file', () => {
    const production = collect(join(projectRoot, 'src'), /\.(ts|tsx)$/).filter(
      (f) => !f.includes(join('components', 'preview')) && !f.includes('(preview)'),
    );

    const offenders = production.filter((f) =>
      /from\s+['"][^'"]*components\/preview/.test(readFileSync(f, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('never touches the database or a Supabase client', () => {
    const previewFiles = [
      ...collect(join(projectRoot, 'src', 'components', 'preview'), /\.(ts|tsx)$/),
      ...collect(join(projectRoot, 'src', 'app', '(preview)'), /\.(ts|tsx)$/),
    ];

    const offenders = previewFiles.filter((f) =>
      /supabase|createClient|from\('.*'\)\.select/i.test(readFileSync(f, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('calls no external API', () => {
    const previewFiles = [
      ...collect(join(projectRoot, 'src', 'components', 'preview'), /\.(ts|tsx)$/),
      ...collect(join(projectRoot, 'src', 'app', '(preview)'), /\.(ts|tsx)$/),
    ];

    const offenders = previewFiles.filter((f) =>
      /\bfetch\(|axios|XMLHttpRequest/.test(readFileSync(f, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('contains no credential or token', () => {
    const previewFiles = [
      ...collect(join(projectRoot, 'src', 'components', 'preview'), /\.(ts|tsx)$/),
      ...collect(join(projectRoot, 'src', 'app', '(preview)'), /\.(ts|tsx)$/),
    ];

    const offenders = previewFiles.filter((f) =>
      /eyJ[A-Za-z0-9_-]{10,}\.|access_token|api[_-]?key\s*[:=]\s*['"]/i.test(
        readFileSync(f, 'utf8'),
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('is unreachable in production', () => {
    const layout = readFileSync(
      join(projectRoot, 'src', 'app', '(preview)', 'preview', 'layout.tsx'),
      'utf8',
    );

    expect(layout).toMatch(/NODE_ENV === 'production'/);
    expect(layout).toMatch(/notFound\(\)/);
  });

  it('is excluded from the session proxy', () => {
    // The prototype needs no session, so the proxy must not run on it — otherwise
    // reviewing static screens would require a Supabase connection.
    const proxy = readFileSync(join(projectRoot, 'src', 'proxy.ts'), 'utf8');

    expect(proxy).toContain('preview');
  });
});

describe('prototype does not overclaim', () => {
  const files = [
    ...collect(join(projectRoot, 'src', 'components', 'preview'), /\.(ts|tsx)$/),
    ...collect(join(projectRoot, 'src', 'app', '(preview)'), /\.(ts|tsx)$/),
  ];

  const rawSource = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  /**
   * Comments and explanatory prose legitimately NAME the things we exclude — a
   * note reading "Paid in Full remains To be confirmed" is exactly what we want
   * on screen. So these guards scan CODE with comments stripped, and assert the
   * absence of real controls/values rather than the absence of words.
   */
  const codeOnly = files
    .map((f) =>
      readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    )
    .join('\n');

  it('never uses "Paid in Full" as a status value', () => {
    // Bible §22.19: Paid in Full remains To be confirmed. It may be DISCUSSED in a
    // rule note, but it must never appear as a payment state in the data model.
    const paymentStates = readFileSync(
      join(projectRoot, 'src', 'components', 'preview', 'sample-data.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/paymentState:\s*[^;]+;/)?.[0];

    expect(paymentStates).toBeDefined();
    expect(paymentStates).not.toMatch(/Paid in Full/);
  });

  it('offers no direct Cancel control for an Official Order', () => {
    expect(codeOnly).toContain('Request Cancellation');
    expect(codeOnly).not.toMatch(/>\s*Cancel Order\s*</);
  });

  it('renders no connect control for TikTok, Shopee, or Lazada', () => {
    // Naming them as FUTURE channels in prose is correct and expected. What must
    // not exist is a control: a connect button or a feature toggle.
    expect(codeOnly).not.toMatch(/Connect (TikTok|Shopee|Lazada)/i);
    expect(codeOnly).not.toMatch(/label="Use (TikTok|Meta) Main App"/i);
    expect(codeOnly).not.toMatch(/label="(Shopee|Lazada)/i);
  });

  it('states plainly that the removed toggles are removed', () => {
    // The prose SHOULD mention them — as things deliberately absent.
    expect(rawSource).toMatch(/Toggles removed on purpose/);
  });

  it('labels sample data', () => {
    expect(rawSource).toContain('Sample data');
    expect(rawSource).toMatch(/UI PROTOTYPE/);
  });

  it('does not claim a working Pancake integration', () => {
    expect(rawSource).toMatch(/unverified until it is actually tested/i);
  });
});

describe('invoice grouping rules (prototype logic)', () => {
  const { eligible, excluded, groups } = computeInvoiceEligibility(SAMPLE_ORDERS);

  it('excludes claims already in another active Invoice Draft', () => {
    const reasons = excluded.map((e) => e.reason);
    expect(reasons.some((r) => /already in another active Invoice Draft/i.test(r))).toBe(
      true,
    );
  });

  it('shows a reason for every exclusion — nothing is silently dropped', () => {
    expect(excluded.every((e) => e.reason.trim().length > 0)).toBe(true);
    expect(eligible.length + excluded.length).toBe(SAMPLE_ORDERS.length);
  });

  it('groups only records sharing customer, arrangement, and fulfillment', () => {
    for (const g of groups) {
      expect(g.orders.every((o) => o.customer === g.customer)).toBe(true);
      expect(g.orders.every((o) => o.paymentArrangement === g.arrangement)).toBe(true);
      expect(g.orders.every((o) => o.fulfillmentMethod === g.fulfillment)).toBe(true);
    }
  });

  it('never places one claim in two groups', () => {
    const ids = groups.flatMap((g) => g.orders.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
