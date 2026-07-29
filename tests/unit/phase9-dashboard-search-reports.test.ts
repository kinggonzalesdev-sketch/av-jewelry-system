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

  it('makes on-screen report/total VIEWING broad, not export-gated', () => {
    // Owner-approved visibility: any active staff may view on-screen totals;
    // only export/download is gated. So the summary reader no longer requires
    // export_data_reports, and the broad business-totals reader exists.
    expect(service).not.toContain("requirePermission('export_data_reports')");
    expect(service).toContain("rpc('dashboard_metrics')");
    expect(service).toContain("rpc('report_sales_summary'");
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

  // The Order Status card (which stated the non-additive rule + the bucket sum)
  // was removed from the dashboard by Owner request. The non-additive counting
  // rule is still proven against a real database in the pgTAP suite, and the
  // Work Queues note below still warns that claims are not orders.

  // The Operational summary block was removed from the Dashboard by Owner request,
  // and with it the queue-count copy these two tests locked ("Claims are not
  // Official Orders", "Never sum them with order figures"). The RULES those lines
  // described are unaffected — claims still never become orders without Approve &
  // Send Invoice, and the queue counts are simply no longer displayed here.
  it('no longer renders the Operational summary queue counts (removed by Owner request)', () => {
    expect(view).not.toMatch(/Operational summary/i);
    expect(view).not.toMatch(/Claims are not Official Orders/i);
  });

  // The Search, Reminders and Audit PANELS were removed from Dashboard Profile by
  // Owner request, so their on-screen honesty copy no longer lives in this view.
  // The rules they stated are still enforced where those features actually run —
  // the audit trail is still append-only, and search still returns references only.
  it('no longer carries the removed Search / Reminders / Audit copy', () => {
    expect(view).not.toMatch(/Finding a record is not authority over it/i);
    expect(view).not.toMatch(/Sent is an attestation/i);
    expect(view).not.toMatch(/Append-only/i);
    // The Sales-summary report went with them.
    expect(view).not.toMatch(/unverified evidence is not revenue/i);
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

  // NOTE: this migration originally gated report_sales_summary on
  // export_data_reports. That gate is SUPERSEDED by
  // 20260716250000_dashboard_metrics (viewing is broad; only export is gated) —
  // asserted in tests/unit/dashboard-metrics.test.ts.

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
