import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DailyCashView } from '@/components/cash/daily-cash-view';
import type { DailyCashSummary, DetailPage, ExpenseRow, WalkInRow } from '@/lib/cash/types';
import type { WalkInItem } from '@/lib/orders/service';

/**
 * Daily Cash Summary — the Details section must behave as a SELF-CONTAINED mini
 * workspace: switching tabs, and Add / View / Edit / Delete, only touch the Details
 * area (and the totals it feeds). It must NEVER navigate to another page or do a
 * full-page reload (router.refresh) — a reload would wipe the Actual Cash Count the
 * user is entering. These tests lock that contract.
 */

const m = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  loadCashDetailAction: vi.fn(),
  loadCashSummaryAction: vi.fn(),
  loadCashExportAction: vi.fn(),
  addExpenseAction: vi.fn(),
  addRemittanceAction: vi.fn(),
  addCashMovementAction: vi.fn(),
  updateExpenseAction: vi.fn(),
  updateRemittanceAction: vi.fn(),
  updateCashMovementAction: vi.fn(),
  deleteCashRecordAction: vi.fn(),
  saveActualCashCountAction: vi.fn(),
  captureWalkInOrderAction: vi.fn(),
  saveWalkInOrderAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh }),
}));

vi.mock('@/lib/orders/actions', () => ({
  captureWalkInOrderAction: m.captureWalkInOrderAction,
  saveWalkInOrderAction: m.saveWalkInOrderAction,
}));

vi.mock('@/lib/cash/actions', () => ({
  loadCashDetailAction: m.loadCashDetailAction,
  loadCashSummaryAction: m.loadCashSummaryAction,
  loadCashExportAction: m.loadCashExportAction,
  addExpenseAction: m.addExpenseAction,
  addRemittanceAction: m.addRemittanceAction,
  addCashMovementAction: m.addCashMovementAction,
  updateExpenseAction: m.updateExpenseAction,
  updateRemittanceAction: m.updateRemittanceAction,
  updateCashMovementAction: m.updateCashMovementAction,
  deleteCashRecordAction: m.deleteCashRecordAction,
  saveActualCashCountAction: m.saveActualCashCountAction,
}));

const summary: DailyCashSummary = {
  date: '2026-08-10',
  cashSales: '5000',
  previousCash: '1000',
  otherCashIn: '0',
  expenses: '0',
  remittance: '0',
  otherCashOut: '0',
  expected: '6000',
  actualCount: null,
  closeStatus: 'open',
};

const walkIns: DetailPage<WalkInRow> = { rows: [], total: 0 };

const expenseRow: ExpenseRow = {
  id: 'exp-1',
  payee: 'Jollibee lunch',
  amount: '250',
  category: 'Meals',
  remarks: 'team',
  createdByName: 'King Gonzales',
  createdAt: '2026-08-10T05:00:00.000Z',
};

function expensesPage(): DetailPage<ExpenseRow> {
  return { rows: [expenseRow], total: 1 };
}

const walkInItems: WalkInItem[] = [
  { id: 'inv-1', itemCode: 'K18-001', facebookName: 'Gold Ring', grams: '3.5' },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.loadCashDetailAction.mockResolvedValue({ rows: [], total: 0 });
  m.loadCashSummaryAction.mockResolvedValue(summary);
  m.addExpenseAction.mockResolvedValue({ ok: true });
  m.deleteCashRecordAction.mockResolvedValue({ ok: true });
  m.saveActualCashCountAction.mockResolvedValue({ ok: true });
  m.captureWalkInOrderAction.mockResolvedValue({ ok: true, orderNumber: 'ORD-1', itemCount: 1 });
  m.saveWalkInOrderAction.mockResolvedValue({ ok: true, orderNumber: 'ORD-1', balance: '4940.00' });
});

function fillWalkIn(paymentValue?: string) {
  fireEvent.click(screen.getByTestId('cash-add')); // Sales Walk-ins is the default tab
  fireEvent.change(screen.getByLabelText('Customer Name'), { target: { value: 'Juan Dela Cruz' } });
  fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'K18-001 — Gold Ring' } });
  fireEvent.change(screen.getByLabelText('Price 1'), { target: { value: '9940' } });
  if (paymentValue !== undefined) {
    fireEvent.change(screen.getByTestId('walkin-payment'), { target: { value: paymentValue } });
  }
  fireEvent.click(screen.getByTestId('walkin-save'));
}

function renderView() {
  return render(
    <DailyCashView
      date="2026-08-10"
      summary={summary}
      initialWalkIns={walkIns}
      walkInItems={walkInItems}
      adminId="admin-1"
      canAddWalkIn
    />,
  );
}

describe('Daily Cash — Details is a self-contained workspace', () => {
  it('switching a tab loads only that tab and never navigates', async () => {
    m.loadCashDetailAction.mockResolvedValue(expensesPage());
    renderView();

    fireEvent.click(screen.getByTestId('cash-tab-expenses'));

    await waitFor(() =>
      expect(m.loadCashDetailAction).toHaveBeenCalledWith('expenses', '2026-08-10', 1, 8),
    );
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('Add opens a popup, not a new page', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await waitFor(() => expect(m.loadCashDetailAction).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('cash-add'));

    expect(screen.getByRole('dialog')).toHaveTextContent('Add Expense');
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('View opens a popup showing the row — it does not navigate to Orders', async () => {
    m.loadCashDetailAction.mockResolvedValue(expensesPage());
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('👁 View'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Expense — Jollibee lunch')).toBeInTheDocument();
    expect(within(dialog).getByText('Meals')).toBeInTheDocument();
    // Fully self-contained: no link out to the Orders section.
    expect(within(dialog).queryByText(/Open in Orders/)).not.toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('"+ Add New Sale" opens an in-section walk-in popup — it does not jump to Orders', () => {
    renderView();
    // Sales Walk-ins is the default tab; its Add button opens the walk-in modal.
    fireEvent.click(screen.getByTestId('cash-add'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Add New Sale (Walk-In)');
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('a blank payment completes the walk-in in full (capture, not save)', async () => {
    renderView();
    fillWalkIn(); // no payment entered → pay in full
    await waitFor(() => expect(m.captureWalkInOrderAction).toHaveBeenCalled());
    expect(m.saveWalkInOrderAction).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('a down-payment saves the walk-in with a balance (save, not complete)', async () => {
    renderView();
    fillWalkIn('1000'); // ₱1,000 of ₱9,940 → partial
    await waitFor(() => expect(m.saveWalkInOrderAction).toHaveBeenCalled());
    const arg = m.saveWalkInOrderAction.mock.calls[0]![0] as {
      payments: Array<{ amount: string }>;
    };
    expect(arg.payments[0]!.amount).toBe('1000');
    expect(m.captureWalkInOrderAction).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('changing the date stays in this section — re-reads the day in place, never navigates', async () => {
    renderView();

    fireEvent.change(screen.getByTestId('cash-date'), { target: { value: '2026-08-09' } });

    await waitFor(() => expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-09'));
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('Delete asks first — it never deletes on the first click', async () => {
    m.loadCashDetailAction.mockResolvedValue(expensesPage());
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('Delete'));
    // A confirmation popup — nothing deleted yet.
    expect(m.deleteCashRecordAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Delete expense?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(m.deleteCashRecordAction).toHaveBeenCalledWith('daily_cash_expenses', 'exp-1'),
    );
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('saving a record recalculates the totals in place — refetch summary, no full reload', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await waitFor(() => expect(m.loadCashDetailAction).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('cash-add'));
    fireEvent.click(screen.getByTestId('cash-add-save'));

    await waitFor(() => expect(m.addExpenseAction).toHaveBeenCalled());
    // Totals recalculated via a targeted summary re-read, NOT a router.refresh().
    await waitFor(() => expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-10'));
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });
});
