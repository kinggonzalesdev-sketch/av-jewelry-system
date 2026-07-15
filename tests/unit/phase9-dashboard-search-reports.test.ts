import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Phase 9 guards — Dashboard, Search, Reports, Notifications & Audit
 * (Bible §7, §23, §25, §26, §31).
 *
 * The non-additive counting rule is proven against a real database in the pgTAP
 * suite (the buckets are asserted to sum to the total). These cover the
 * TypeScript surface and the wording the screen must not contradict.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('dashboard service', () => {
  const service = read('src', 'lib', 'dashboard', 'service.ts');

  it('reads counts from the approved SQL, computing none itself', () => {
    // A count computed here could disagree with the database about whether an
    // Active Layaway is also an order awaiting payment.
    expect(service).toContain("rpc('dashboard_counts')");
    expect(codeOnly(service)).not.toMatch(/ordersActiveLayaway\s*\+/);
  });

  it('creates no business record — this phase reads', () => {
    const code = codeOnly(service);

    expect(code).not.toMatch(/from\('claims'\)[\s\S]{0,60}\.insert/);
    expect(code).not.toMatch(/from\('official_orders'\)[\s\S]{0,60}\.(insert|update)/);
    expect(code).not.toMatch(/from\('payments'\)[\s\S]{0,60}\.(insert|update)/);
  });

  it('gates reports behind the export permission, not plain visibility', () => {
    expect(service).toContain("requirePermission('export_data_reports')");
  });

  it('states that a report grants no authority and is scope-limited', () => {
    expect(service).toContain('grants_action_authority: false');
    expect(service).toContain('limited_to_visible_records: true');
  });

  it('refuses a one-character search rather than sweeping the table', () => {
    expect(service).toContain('trimmed.length < 2');
  });

  it('never merges or reassigns from search', () => {
    const searchFn = service.slice(
      service.indexOf('export async function search'),
      service.indexOf('export type SalesSummary'),
    );

    expect(searchFn).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it('states a notification changes no business record', () => {
    expect(service).toContain('business_record_changed: false');
    expect(service).toContain('customer_notified: false');
    expect(service).toContain('delivered: false');
    expect(service).toContain('read: false');
  });

  it('never surfaces audit context, which can carry operational detail', () => {
    const auditFn = service.slice(
      service.indexOf('export async function listAuditEvents'),
    );

    expect(auditFn).not.toMatch(/context/);
    expect(auditFn).toContain('actor_label');
  });

  it('audits denial, not only success', () => {
    expect(service).toContain("outcome: 'denied'");
  });
});

describe('the screen never contradicts the counting rules', () => {
  const view = read('src', 'components', 'dashboard', 'dashboard-view.tsx').replace(
    /\s+/g,
    ' ',
  );

  it('says the order tiles are non-additive and why', () => {
    expect(view).toMatch(/non-additive by construction/i);
    expect(view).toMatch(/an Active Layaway .{0,40}is.{0,20}an Official Order/i);
  });

  it('shows the bucket sum against the total so a double-count is visible', () => {
    expect(view).toMatch(/of \{counts\.totalOfficialOrders\} Official Orders/);
  });

  it('says claims are not orders', () => {
    expect(view).toMatch(/Claims are not Official Orders/i);
    expect(view).toMatch(/Never add these to the order tiles/i);
  });

  it('separates queue counts and warns against summing them', () => {
    expect(view).toMatch(/Never sum them with order figures/i);
  });

  it('says seeing a count grants no authority', () => {
    expect(view).toMatch(/grants no authority/i);
  });

  it('says search returns references only', () => {
    expect(view).toMatch(/Finding a record is not authority over it/i);
    expect(view).toMatch(/nothing here merges or reassigns/i);
  });

  it('says a report is limited to visible records and counts verified money only', () => {
    expect(view).toMatch(/limited to records you can already see/i);
    expect(view).toMatch(/unverified evidence is not revenue/i);
  });

  it('says Sent is an attestation and Delivered/Read are unobserved', () => {
    expect(view).toMatch(
      /Sent is an attestation, and Delivered and Read are not observed/i,
    );
    expect(view).toMatch(/acknowledging it changes no business record/i);
  });

  it('says audit is append-only and hides context', () => {
    expect(view).toMatch(/Append-only/i);
    expect(view).toMatch(/must never expose secrets/i);
  });
});

describe('Phase 9 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260715200000_phase9_dashboard_search_reports_audit.sql',
  );
  const sql = migration.replace(/^\s*--.*$/gm, '');

  it('builds disjoint order buckets keyed on the active-layaway flag', () => {
    expect(sql).toContain('is_active_layaway');
    // Every non-layaway bucket must explicitly exclude the layaway ones.
    expect(sql).toContain('not is_active_layaway');
    expect(sql).toContain('total_official_orders');
  });

  it('gates the report behind the export permission inside the database', () => {
    expect(sql).toContain("app_private.has_permission('export_data_reports')");
  });

  it('counts only verified, non-void, non-reversed money in the report', () => {
    expect(sql).toContain("p.status = 'verified'");
    expect(sql).toContain('p.voided_at is null');
    expect(sql).toContain('p.reversed_at is null');
    expect(sql).toContain('p.correction_pending = false');
  });

  it('freezes a notification so only acknowledgement may change', () => {
    expect(sql).toContain('enforce_notification_is_a_note');
    expect(sql).toMatch(/only acknowledgement may change/i);
  });

  it('defines no delivered_at or read_at — neither is observable', () => {
    expect(sql).not.toMatch(/delivered_at|read_at/);
  });

  it('keeps every function security invoker so RLS scopes the results', () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("set search_path = ''");
  });

  it('does not redefine the Phase 2 notification policies', () => {
    // Re-creating them would be a second definition, and a second definition is
    // a second thing to drift.
    expect(sql).not.toMatch(/create policy notifications_(read|insert|update)/);
  });

  it('never weakens an earlier phase guard', () => {
    expect(sql).not.toMatch(/drop\s+trigger/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/disable row level security/i);
  });

  it('records the unresolved KPI and audit taxonomy as provisional', () => {
    expect(sql).toContain('provisional_fields');
    expect(migration).toContain('§25.16');
    expect(migration).toContain('§31.30');
  });
});
