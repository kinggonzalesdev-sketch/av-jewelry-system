import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DailyCashView } from '@/components/cash/daily-cash-view';
import type { DailyCashSummary, DetailPage, ExpenseRow, WalkInRow } from '@/lib/cash/types';

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
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh }),
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

beforeEach(() => {
  vi.clearAllMocks();
  m.loadCashDetailAction.mockResolvedValue({ rows: [], total: 0 });
  m.loadCashSummaryAction.mockResolvedValue(summary);
  m.addExpenseAction.mockResolvedValue({ ok: true });
  m.deleteCashRecordAction.mockResolvedValue({ ok: true });
  m.saveActualCashCountAction.mockResolvedValue({ ok: true });
});

function renderView() {
  return render(<DailyCashView date="2026-08-10" summary={summary} initialWalkIns={walkIns} />);
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
