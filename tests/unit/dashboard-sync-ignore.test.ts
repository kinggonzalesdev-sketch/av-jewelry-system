import { describe, expect, it } from 'vitest';

import {
  SYNC_IGNORE_TABLES,
  shouldSyncForTable,
} from '@/components/shell/dashboard-sync';

/**
 * The DashboardSync refresh deny-list (Owner cost audit 2026-09-07). A Realtime write to a
 * high-churn infrastructure table must NOT force a global SSR re-render, but every DATA table
 * must still refresh — the default is "refresh", so a table can only be skipped by being
 * explicitly listed. This pins the list so a future edit can't quietly drop a data surface.
 */

describe('shouldSyncForTable', () => {
  it('refreshes for the core data tables (never silently dropped)', () => {
    for (const table of [
      'official_orders',
      'payments',
      'inventory_items',
      'customers',
      'layaway_ledger',
      'layaway_ledger_payments',
      'capture_records',
      'capture_review_queue',
      'owner_approval_requests',
      'attendance_records',
      'scrap_sales',
      'live_sessions',
      'live_test_state',
    ]) {
      expect(shouldSyncForTable(table)).toBe(true);
    }
  });

  it('skips the deny-listed infrastructure/telemetry tables', () => {
    for (const table of [
      'label_jobs',
      'printers',
      'customer_messages',
      'capture_device_heartbeats',
      'layaway_code_pool',
    ]) {
      expect(shouldSyncForTable(table)).toBe(false);
    }
  });

  it('defaults to refresh when the table is unknown/undefined (never miss a change)', () => {
    expect(shouldSyncForTable(undefined)).toBe(true);
    expect(shouldSyncForTable('some_new_table')).toBe(true);
  });

  it('the deny-list holds exactly the audited infrastructure tables', () => {
    expect([...SYNC_IGNORE_TABLES].sort()).toEqual(
      [
        'capture_device_heartbeats',
        'customer_messages',
        'label_jobs',
        'layaway_code_pool',
        'printers',
      ].sort(),
    );
    // A data table must never appear here.
    expect(SYNC_IGNORE_TABLES.has('official_orders')).toBe(false);
    expect(SYNC_IGNORE_TABLES.has('payments')).toBe(false);
  });
});
