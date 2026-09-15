import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every Layaway/Payments balance still comes from the approved SQL.
 *
 * The workspace no longer calls order_balance() once per row; it reads the SAME
 * figures through the batch wrapper order_balances() (which calls order_balance()
 * per id inside the database). This locks both ends of that path so the intent of
 * the old "rpc('order_balance'" grep survives the batching.
 */

const projectRoot = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(projectRoot, ...p), 'utf8');
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const workspace = codeOnly(read('src', 'lib', 'payments', 'workspace.ts'));
const balances = codeOnly(read('src', 'lib', 'payments', 'balances.ts'));

describe('workspace balances come from the approved SQL', () => {
  it('reads arrangement balances through the batch balance reader', () => {
    expect(workspace).toContain(
      "import { getOrderBalancePayloads, getOrderBalances } from '@/lib/payments/balances'",
    );
    expect(workspace).toContain('getOrderBalancePayloads(');
  });

  it('the batch reader is one order_balances() round-trip', () => {
    const body = balances.slice(
      balances.indexOf('export async function getOrderBalancePayloads'),
      balances.indexOf('export async function listDuplicateReferences'),
    );
    expect(body).toContain("rpc('order_balances'");
  });

  it('never computes a balance itself or calls order_balance() per row', () => {
    expect(workspace).not.toContain("rpc('order_balance'");
    expect(workspace).not.toContain("rpc('order_balances'");
  });
});
