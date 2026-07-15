import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GROSS_PROFIT_NOTE,
  RANGE_LABEL,
  grossProfitFor,
  kpis,
  rangeBounds,
  salesSeries,
} from '@/components/preview/dashboard-data';
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
      'Dashboard Report',
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

  it('restores Dashboard Report as its own tab, separate from Orders and Reports', () => {
    const labels = PREVIEW_NAV.map((n) => n.label);

    expect(labels).toContain('Dashboard Report');
    expect(labels).toContain('Orders');
    expect(labels).toContain('Reports');
    // Orders is the daily operational workspace, not a Dashboard replacement.
    expect(labels.indexOf('Dashboard Report')).toBeLessThan(labels.indexOf('Orders'));
  });

  it('has no separate multi-platform Connections tab', () => {
    expect(PREVIEW_NAV.map((n) => n.label)).not.toContain('Connections');
  });

  it('lands on Dashboard Report, not Orders or Live', () => {
    const index = readFileSync(
      join(projectRoot, 'src', 'app', '(preview)', 'preview', 'page.tsx'),
      'utf8',
    );

    expect(index).toContain("redirect('/preview/dashboard-report')");
    expect(index).not.toContain("redirect('/preview/live')");
  });
});

describe('Dashboard Report', () => {
  const previewDir = join(projectRoot, 'src', 'components', 'preview');
  const appDir = join(projectRoot, 'src', 'app', '(preview)');

  const files = [
    ...collect(previewDir, /\.(ts|tsx)$/),
    ...collect(appDir, /\.(ts|tsx)$/),
  ];

  const allSource = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  /**
   * Comments legitimately NAME the excluded feature — "there is deliberately no
   * Disassembly Report" is documentation worth keeping. So the guard scans CODE
   * with comments stripped: what must not exist is a tab, card, or chart, not the
   * word in a note.
   */
  const codeOnly = files
    .map((f) =>
      readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    )
    .join('\n');

  it('renders NO disassembly tab, card, or chart anywhere', () => {
    // Explicitly excluded by the Owner. Guarded across the whole prototype so it
    // cannot reappear in any rendered form.
    expect(codeOnly).not.toMatch(/disassembl/i);
  });

  it('has exactly two internal tabs: Dashboard and Gross Profit', () => {
    const view = readFileSync(join(previewDir, 'dashboard-view.tsx'), 'utf8');
    const tabs = [...view.matchAll(/\['(dashboard|gross_profit)', '([^']+)'\]/g)].map(
      (m) => m[2],
    );

    expect(tabs).toEqual(['Dashboard', 'Gross Profit']);
  });

  it('offers all six date filters', () => {
    expect(Object.values(RANGE_LABEL)).toEqual([
      'Today',
      '7 Days',
      '14 Days',
      '30 Days',
      'This Month',
      'Custom Date Range',
    ]);
  });

  it('changes the sales series when the range changes', () => {
    // The cards and charts must visibly respond to the filter, not sit static.
    expect(salesSeries('today').length).toBe(1);
    expect(salesSeries('7d').length).toBe(7);
    expect(salesSeries('30d').length).toBe(30);
  });

  it('scales KPI totals with the selected range', () => {
    expect(kpis('30d').totalSales).toBeGreaterThan(kpis('7d').totalSales);
  });

  it('reports the selected start and end date', () => {
    const b = rangeBounds('7d');
    expect(b.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.end).toBe('2026-07-15');
  });

  it('honours a custom range', () => {
    const b = rangeBounds('custom', '2026-07-01', '2026-07-10');
    expect(b).toEqual({ start: '2026-07-01', end: '2026-07-10' });
    expect(salesSeries('custom', '2026-07-01', '2026-07-10').length).toBe(10);
  });

  it('keeps the Gross Profit preview note visible', () => {
    expect(GROSS_PROFIT_NOTE).toBe(
      'Preview calculation using sample data. Final COGS rules remain subject to business validation.',
    );
    expect(allSource).toContain(GROSS_PROFIT_NOTE);
  });

  it('computes a coherent preview gross profit', () => {
    const gp = grossProfitFor('2026-07', 'System');

    expect(gp.totalSales).toBe(gp.itemsSold * gp.avgSellingPrice);
    expect(gp.grossProfit).toBe(gp.totalSales - gp.cogs);
    expect(gp.grossProfitRate).toBeGreaterThan(0);
    expect(gp.grossProfitRate).toBeLessThan(100);
  });

  it('changes figures when the costing mode changes', () => {
    // System vs Manual must visibly differ, or the control is decorative.
    expect(grossProfitFor('2026-07', 'System').cogs).not.toBe(
      grossProfitFor('2026-07', 'Manual').cogs,
    );
  });

  it('does not duplicate the Reports module inside Dashboard Report', () => {
    // Reports stays a separate future area.
    const reports = readFileSync(join(appDir, 'preview', 'reports', 'page.tsx'), 'utf8');
    expect(reports).toContain('ComingSoonPage');
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
