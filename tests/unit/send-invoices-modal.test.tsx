import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SendInvoicesModal } from '@/components/orders/send-invoices-modal';
import type { InvoiceSendList, InvoiceSendRow } from '@/lib/orders/bulk-invoice';
import type { BulkRowOutcome, InvoiceFilter } from '@/lib/orders/bulk-invoice-rules';

/**
 * Orders → For Invoice → Send Invoices window (Owner 2026-09-25): selection, the confirm step,
 * the controlled queue, per-row results, duplicate protection, reload, reminders.
 */
const S = vi.hoisted(() => {
  const state: {
    rows: InvoiceSendRow[];
    loads: Array<{ filter?: InvoiceFilter; search?: string; page?: number }>;
    sends: string[];
    reminders: string[];
    failIds: Set<string>;
    audit: unknown[];
  } = { rows: [], loads: [], sends: [], reminders: [], failIds: new Set(), audit: [] };
  return state;
});

vi.mock('@/lib/orders/actions', () => ({
  loadInvoiceSendListAction: (o: { filter?: InvoiceFilter; search?: string; page?: number }) => {
    S.loads.push(o);
    const filter = o.filter ?? 'not_sent';
    const rows = S.rows.filter((r) =>
      filter === 'all'
        ? true
        : filter === 'sent'
          ? r.sendState === 'sent'
          : filter === 'no_link'
            ? r.sendState !== 'sent' && !r.chat
            : r.sendState !== 'sent' && Boolean(r.chat),
    );
    const list: InvoiceSendList = {
      rows,
      counts: { not_sent: 0, sent: 0, no_link: 0, all: S.rows.length },
      total: rows.length,
      page: 1,
      pageSize: 25,
    };
    return Promise.resolve({ ok: true, list });
  },
  sendInvoiceInBulkAction: (id: string): Promise<BulkRowOutcome> => {
    S.sends.push(id);
    if (S.failIds.has(id)) return Promise.resolve({ orderId: id, outcome: 'failed', reason: 'Pancake rejected' });
    // The server now records it as sent: a reload shows Sent.
    S.rows = S.rows.map((r) =>
      r.orderId === id ? { ...r, sendState: 'sent', invoice: { eligible: false, reason: 'Already sent' } } : r,
    );
    return Promise.resolve({ orderId: id, outcome: 'sent', reason: null });
  },
  sendReminderInBulkAction: (id: string): Promise<BulkRowOutcome> => {
    S.reminders.push(id);
    return Promise.resolve({ orderId: id, outcome: 'sent', reason: null });
  },
  recordBulkInvoiceSendAction: (summary: unknown) => {
    S.audit.push(summary);
    return Promise.resolve();
  },
}));

function row(id: string, over: Partial<InvoiceSendRow> = {}): InvoiceSendRow {
  return {
    orderId: id,
    customerName: `Customer ${id}`,
    itemCount: 1,
    itemCodes: ['GLD 1.5g'],
    chat: 'order',
    sendState: 'not_sent',
    sentAt: null,
    sentManually: false,
    reminderCount: 0,
    lastReminderAt: null,
    invoice: { eligible: true, reason: null },
    reminder: { eligible: false, reason: 'Send the invoice first', nextNumber: null },
    ...over,
  };
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}
async function open() {
  await act(async () => {
    render(<SendInvoicesModal open onClose={vi.fn()} onChanged={vi.fn()} />);
    await settle();
  });
}
async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
    await settle();
  });
}

beforeEach(() => {
  S.rows = [];
  S.loads = [];
  S.sends = [];
  S.reminders = [];
  S.failIds = new Set();
  S.audit = [];
});

describe('Send Invoices window', () => {
  it('opens on the Not Sent filter (default)', async () => {
    S.rows = [row('a')];
    await open();
    expect(S.loads[0]?.filter).toBe('not_sent');
    expect(screen.getByTestId('send-invoices-filter-not_sent')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('✓ Available for Invoice')).toBeInTheDocument();
  });

  it('Test 1: 5 ready → Select all eligible → confirm → exactly 5 sends', async () => {
    S.rows = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id));
    await open();
    await click('send-invoices-select-all');
    expect(screen.getByTestId('send-invoices-send-selected')).toHaveTextContent('Send Selected (5)');
    await click('send-invoices-send-selected');
    expect(screen.getByTestId('send-invoices-confirm-panel')).toHaveTextContent(
      'Send invoices to 5 customers?',
    );
    expect(S.sends).toHaveLength(0); // nothing before the confirmation
    await click('send-invoices-confirm');
    expect(S.sends.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(screen.getByTestId('send-invoices-progress')).toHaveTextContent(
      'Sent successfully: 5 · Failed: 0 · Skipped: 0',
    );
    expect(S.audit).toEqual([{ sent: 5, failed: 0, skipped: 0, kind: 'invoice' }]);
  });

  it('Test 2: 3 eligible + 2 without a chat → only the 3 are selectable', async () => {
    S.rows = [
      row('a'),
      row('b'),
      row('c'),
      row('x', { chat: null, invoice: { eligible: false, reason: 'No Facebook link' } }),
      row('y', { chat: null, invoice: { eligible: false, reason: 'No Facebook link' } }),
    ];
    await act(async () => {
      render(<SendInvoicesModal open onClose={vi.fn()} onChanged={vi.fn()} />);
      await settle();
    });
    await click('send-invoices-filter-all');
    expect(screen.getByTestId('send-invoices-pick-x')).toBeDisabled();
    await click('send-invoices-select-all');
    await click('send-invoices-send-selected');
    await click('send-invoices-confirm');
    expect(S.sends.sort()).toEqual(['a', 'b', 'c']);
  });

  it('Test 4: one failure among 10 → the other 9 still go; the row says why', async () => {
    S.rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`));
    S.failIds = new Set(['r3']);
    await open();
    await click('send-invoices-select-all');
    await click('send-invoices-send-selected');
    await click('send-invoices-confirm');
    expect(S.sends).toHaveLength(10);
    expect(screen.getByTestId('send-invoices-progress')).toHaveTextContent(
      'Sent successfully: 9 · Failed: 1 · Skipped: 0',
    );
    expect(screen.getByTestId('send-invoices-result-r3')).toHaveTextContent('Failed · Pancake rejected');
  });

  it('Test 5: a double click on Send never starts a second batch', async () => {
    S.rows = ['a', 'b'].map((id) => row(id));
    await open();
    await click('send-invoices-select-all');
    await click('send-invoices-send-selected');
    await act(async () => {
      const confirm = screen.getByTestId('send-invoices-confirm');
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      await settle();
    });
    expect(S.sends.sort()).toEqual(['a', 'b']);
  });

  it('Test 6: after the batch the list reloads from the server and shows Sent', async () => {
    S.rows = [row('a')];
    await open();
    await click('send-invoices-select-all');
    await click('send-invoices-send-selected');
    await click('send-invoices-confirm');
    const loadsBefore = S.loads.length;
    await click('send-invoices-filter-sent');
    expect(S.loads.length).toBeGreaterThan(loadsBefore);
    expect(screen.getByText(/^Invoice sent/)).toBeInTheDocument();
  });

  it('Test 7/8: Sent filter → Send Reminder once; a paid-in-full row cannot be reminded', async () => {
    S.rows = [
      row('a', {
        sendState: 'sent',
        invoice: { eligible: false, reason: 'Already sent' },
        reminder: { eligible: true, reason: null, nextNumber: 1 },
      }),
      row('p', {
        sendState: 'sent',
        invoice: { eligible: false, reason: 'Already sent' },
        reminder: { eligible: false, reason: 'Paid in full', nextNumber: null },
      }),
    ];
    await open();
    await click('send-invoices-filter-sent');
    expect(screen.queryByTestId('send-invoices-remind-p')).not.toBeInTheDocument();
    expect(screen.getByTestId('send-invoices-pick-p')).toBeDisabled();
    await click('send-invoices-remind-a');
    await click('send-invoices-confirm');
    expect(S.reminders).toEqual(['a']);
    expect(S.sends).toEqual([]);
  });
});
