import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Phase 10 guards — Conditional Capability Gating (Bible §27, §14, §13, §26).
 *
 * ⚠️  Phase 10's exit gate requires real-hardware tests BEFORE readiness is
 *     claimed. No hardware or vendor account was available, so NO integration
 *     is implemented. These tests lock the one thing that could be built
 *     honestly: the gate that keeps unvalidated integrations unreachable.
 *
 * The gate itself is proven against a real database in the pgTAP suite.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no integration is secretly implemented', () => {
  const sources = [
    read('src', 'lib', 'capabilities', 'service.ts'),
    read('src', 'lib', 'labels', 'transport.ts'),
    read('src', 'lib', 'invoicing', 'messages.ts'),
  ].map(codeOnly);

  it('contains no Bluetooth, serial, or USB device call', () => {
    for (const source of sources) {
      expect(source).not.toMatch(
        /navigator\.bluetooth|requestDevice|navigator\.serial|usb/i,
      );
    }
  });

  it('contains no Pancake, Meta, or Facebook API call', () => {
    // Naming a capability `pancake_adapter` is a FLAG, not an integration — the
    // whole point is that the flag exists and the adapter does not. So match
    // API surfaces rather than the vendor word.
    for (const source of sources) {
      expect(source).not.toMatch(
        /graph\.facebook|api\.meta|messenger\.com|pancake\.\w+\(/i,
      );
      expect(source).not.toMatch(/https?:\/\//);
    }
  });

  it('makes no outbound network request from any integration path', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/\bfetch\(|axios|XMLHttpRequest/);
    }
  });
});

describe('capability service', () => {
  const service = read('src', 'lib', 'capabilities', 'service.ts');

  it('fails closed — an unreadable flag is OFF', () => {
    // Falling back costs a little time; wrongly assuming a printer works costs
    // a customer their label.
    const fn = service.slice(
      service.indexOf('export async function isCapabilityEnabled'),
      service.indexOf('export async function recordValidation'),
    );

    expect(fn).toContain('if (error || !data) return false;');
  });

  it('restricts validation and toggling to the Owner', () => {
    expect(service).toContain('requireOwner');
    expect(service).not.toContain("requirePermission('");
  });

  it('states that recording evidence does not enable anything', () => {
    expect(service).toContain('capability_enabled_by_this_action: false');
  });

  it('states the manual fallback always remains', () => {
    expect(service).toContain('manual_fallback_remains_available: true');
  });

  it('surfaces the database refusal rather than a generic message', () => {
    expect(service).toContain("error.message.replace(/^ERROR:\\s*/i, '').trim()");
  });

  it('audits denial, not only success', () => {
    expect(service).toContain("outcome: 'denied'");
  });
});

describe('the screen tells the truth about readiness', () => {
  const view = read('src', 'components', 'capabilities', 'capabilities-view.tsx').replace(
    /\s+/g,
    ' ',
  );

  it('says plainly that nothing is validated', () => {
    expect(view).toMatch(/No integration here has been validated/i);
    expect(view).toMatch(/no driver or adapter is implemented/i);
  });

  it('names the manual fallback for every capability', () => {
    expect(view).toMatch(/Manual fallback:/);
  });

  it('says V1 launches on the fallbacks', () => {
    expect(view).toMatch(/V1 launches on those fallbacks/i);
  });

  it('says recording evidence is not enabling', () => {
    expect(view).toMatch(/Recording evidence is not enabling/i);
  });

  it('says the refusal is enforced by the database, not hidden in the UI', () => {
    expect(view).toMatch(/refused by the database, not merely hidden here/i);
  });

  it('says disabling is never gated', () => {
    expect(view).toMatch(/Disabling is never gated/i);
  });

  it('never claims a capability is ready or supported', () => {
    expect(view).not.toMatch(/ready to use|fully supported|integration works/i);
  });
});

describe('Phase 10 migration', () => {
  const migration = read(
    'supabase',
    'migrations',
    '20260716100000_phase10_capability_gating.sql',
  );
  const sql = migration.replace(/^\s*--.*$/gm, '');

  it('ships every capability disabled by default', () => {
    expect(sql).toContain('is_enabled boolean not null default false');
    // Every seeded row passes an explicit false.
    expect(sql).not.toMatch(/values\s*\([^)]*,\s*true\s*,/);
  });

  it('makes enabling impossible without a validation record', () => {
    expect(sql).toContain('capability_enabled_requires_validation_ck');
    expect(sql).toContain('enforce_capability_validation');
    expect(sql).toContain("v.outcome = 'passed'");
  });

  it('never gates disabling', () => {
    // The guard fires ONLY on the off->on transition, so turning a capability
    // off can never be refused. Asserted on the code, not the comment.
    expect(sql).toContain('if new.is_enabled and not old.is_enabled then');
    expect(migration).toMatch(/Turning a capability OFF is always allowed/i);
  });

  it('registers all five conditional capabilities', () => {
    for (const key of [
      'printer_xp236b_bluetooth',
      'pancake_adapter',
      'meta_direct_send',
      'android_floating_capture',
      'ios_share_intake',
    ]) {
      expect(sql).toContain(key);
    }
  });

  it('gives every capability a manual fallback', () => {
    expect(sql).toContain('manual_fallback');
    expect(sql).toContain('Browser preview, then print manually');
    expect(sql).toContain('Copy Invoice Message, send manually, Mark as Sent');
  });

  it('records why each capability is blocked', () => {
    expect(sql).toContain('blocked_reason text not null');
  });

  it('keeps functions security invoker with a pinned search_path', () => {
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("set search_path = ''");
  });

  it('never weakens an earlier phase guard', () => {
    expect(sql).not.toMatch(/drop\s+trigger/i);
    expect(sql).not.toMatch(/drop\s+function/i);
    expect(sql).not.toMatch(/disable row level security/i);
  });
});
