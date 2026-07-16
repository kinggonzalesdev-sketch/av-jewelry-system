import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');

describe('dashboard_metrics migration (business totals, broad view)', () => {
  const sql = read(
    'supabase',
    'migrations',
    '20260716250000_dashboard_metrics.sql',
  ).replace(/^\s*--.*$/gm, '');

  it('is viewable by any active staff — granted to authenticated, security invoker', () => {
    expect(sql).toContain(
      'grant execute on function public.dashboard_metrics() to authenticated',
    );
    expect(sql).toContain('security invoker');
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("set search_path = ''");
  });

  it('sums the tested per-order readers — one source of truth, no reinvented math', () => {
    expect(sql).toContain('app_private.total_amount_payable(id)');
    expect(sql).toContain('app_private.verified_net_payments(id)');
    expect(sql).toContain('app_private.outstanding_balance(id)');
  });

  it('includes every approved business total', () => {
    for (const key of [
      'total_sales',
      'verified_collections',
      'outstanding_balance',
      'total_official_orders',
      'full_payment_sales',
      'total_layaway_sales',
      'layaway_collections',
      'pending_payments',
      'cancelled_amount',
      'forfeited_amount',
      'sales_today',
      'sales_week',
      'sales_month',
      'average_order_value',
      'collection_trend',
    ]) {
      expect(sql, `metric ${key} must be present`).toContain(`'${key}'`);
    }
  });

  it('counts verified money only for collections', () => {
    expect(sql).toContain("p.status = 'verified'");
    expect(sql).toContain('p.voided_at is null');
    expect(sql).toContain('p.correction_pending = false');
  });

  it('un-gates report_sales_summary VIEWING (active staff), no export gate to view', () => {
    expect(sql).toContain('app_private.is_active_staff()');
    // The export permission is no longer required merely to view the summary.
    expect(sql).not.toContain("has_permission('export_data_reports')");
  });
});

describe('getDashboardMetrics reader', () => {
  const service = read('src', 'lib', 'dashboard', 'service.ts');

  it('reads the approved aggregate and fails honestly (null → explicit error UI)', () => {
    expect(service).toContain("rpc('dashboard_metrics')");
    expect(service).toContain('if (response.error || !response.data) return null');
  });

  it('keeps money as strings — never a float', () => {
    // Peso fields are mapped through moneyString, not Number().
    expect(service).toContain('totalSales: moneyString');
    expect(service).toContain('verifiedCollections: moneyString');
  });
});
