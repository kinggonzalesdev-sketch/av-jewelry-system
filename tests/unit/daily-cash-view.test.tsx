import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DailyCashView } from '@/components/cash/daily-cash-view';
import type {
  DailyCashSummary,
  DetailPage,
  TradeExpenseRow,
  WalkInRow,
} from '@/lib/cash/types';
import type { WalkInItem } from '@/lib/orders/service';

/**
 * Daily Cash Summary — the lower area is two SELF-CONTAINED boxes (Sales Walk-ins ·
 * Trades & Expenses), no tab strip. Add / View / Edit / Delete only touch their own box
 * (and the totals it feeds); nothing here navigates or does a full-page reload
 * (router.refresh) — a reload would wipe the Actual Cash Count the user is entering.
 * These tests lock that contract.
 */

const m = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  loadCashDetailAction: vi.fn(),
  loadCashSummaryAction: vi.fn(),
  loadCashExportAction: vi.fn(),
  loadTradesExpensesAction: vi.fn(),
  addExpenseAction: vi.fn(),
  addTradeAction: vi.fn(),
  updateExpenseAction: vi.fn(),
  updateTradeAction: vi.fn(),
  deleteCashRecordAction: vi.fn(),
  saveActualCashCountAction: vi.fn(),
  loadWalkInItemsAction: vi.fn(),
  captureWalkInOrderAction: vi.fn(),
  saveWalkInOrderAction: vi.fn(),
  adminEditOrderAction: vi.fn(),
  deleteOrderAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh }),
}));

vi.mock('@/lib/orders/actions', () => ({
  captureWalkInOrderAction: m.captureWalkInOrderAction,
  saveWalkInOrderAction: m.saveWalkInOrderAction,
  adminEditOrderAction: m.adminEditOrderAction,
  deleteOrderAction: m.deleteOrderAction,
}));

// The shared rich Walk-In modal has its OWN test (new-order-workflow.test.tsx). Here we
// only assert the Daily Cash INTEGRATION — the button opens it in-section, and a save
// refreshes the box + totals — so stub it to avoid pulling in its printer/photo/action deps.
vi.mock('@/components/orders/new-order-workflow', () => ({
  NewOrderModal: (props: { onSaved?: () => void; onClose?: () => void }) => (
    <div role="dialog">
      <span>New Walk-In Sale</span>
      <button type="button" onClick={() => props.onSaved?.()}>
        stub-save
      </button>
      <button type="button" onClick={() => props.onClose?.()}>
        stub-close
      </button>
    </div>
  ),
}));

vi.mock('@/lib/cash/actions', () => ({
  loadCashDetailAction: m.loadCashDetailAction,
  loadCashSummaryAction: m.loadCashSummaryAction,
  loadCashExportAction: m.loadCashExportAction,
  loadTradesExpensesAction: m.loadTradesExpensesAction,
  addExpenseAction: m.addExpenseAction,
  addTradeAction: m.addTradeAction,
  updateExpenseAction: m.updateExpenseAction,
  updateTradeAction: m.updateTradeAction,
  deleteCashRecordAction: m.deleteCashRecordAction,
  saveActualCashCountAction: m.saveActualCashCountAction,
  loadWalkInItemsAction: m.loadWalkInItemsAction,
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

const expenseRow: TradeExpenseRow = {
  id: 'exp-1',
  type: 'expense',
  name: 'Jollibee lunch',
  amount: '250',
  category: 'Meals',
  relatedSale: null,
  remarks: 'team',
  createdByName: 'King Gonzales',
  createdAt: '2026-08-10T05:00:00.000Z',
};

function withExpense(): DetailPage<TradeExpenseRow> {
  return { rows: [expenseRow], total: 1 };
}

const walkInItems: WalkInItem[] = [
  { id: 'inv-1', itemCode: 'K18-001', facebookName: 'Gold Ring', grams: '3.5' },
];

beforeEach(() => {
  vi.clearAllMocks();
  m.loadCashDetailAction.mockResolvedValue({ rows: [], total: 0 });
  m.loadCashSummaryAction.mockResolvedValue(summary);
  m.loadTradesExpensesAction.mockResolvedValue({ rows: [], total: 0 });
  m.addExpenseAction.mockResolvedValue({ ok: true });
  m.addTradeAction.mockResolvedValue({ ok: true });
  m.deleteCashRecordAction.mockResolvedValue({ ok: true });
  m.saveActualCashCountAction.mockResolvedValue({ ok: true });
  m.loadWalkInItemsAction.mockResolvedValue(walkInItems);
  m.captureWalkInOrderAction.mockResolvedValue({
    ok: true,
    orderNumber: 'ORD-1',
    itemCount: 1,
  });
  m.saveWalkInOrderAction.mockResolvedValue({
    ok: true,
    orderNumber: 'ORD-1',
    balance: '4940.00',
  });
  m.adminEditOrderAction.mockResolvedValue({ ok: true });
  m.deleteOrderAction.mockResolvedValue({
    ok: true,
    returnedItems: 1,
    paymentsRemoved: 1,
  });
});

const walkInRow: WalkInRow = {
  id: 'ord-1',
  orderNumber: 'WI-0001',
  name: 'Maria Santos',
  purchased: '9940',
  nonCash: '0',
  cash: '9940',
  tradeDeductions: '0',
};

function renderView(
  opts: { isOwner?: boolean; walkInRows?: DetailPage<WalkInRow> } = {},
) {
  return render(
    <DailyCashView
      date="2026-08-10"
      summary={summary}
      initialWalkIns={opts.walkInRows ?? walkIns}
      admins={{ selfId: 'admin-1', selfName: 'King Gonzales', canChange: false, options: [] }}
      canAddWalkIn
      isOwner={opts.isOwner ?? false}
    />,
  );
}

describe('Daily Cash — two self-contained boxes', () => {
  it('renders the two boxes and loads Trades & Expenses on mount — no tab strip', async () => {
    renderView();
    expect(screen.getByText('Sales Walk-ins')).toBeInTheDocument();
    expect(screen.getByText('Trades & Expenses')).toBeInTheDocument();
    await waitFor(() =>
      expect(m.loadTradesExpensesAction).toHaveBeenCalledWith('2026-08-10', 1, 8),
    );
    // The old tab strip is gone.
    expect(screen.queryByTestId('cash-tab-expenses')).not.toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('"+ Add New Sale" opens the shared Walk-In modal in-section — it does not jump to Orders', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-add-walkin'));
    // The walk-in item picker is LAZY-loaded (loadWalkInItemsAction) before the modal opens,
    // so opening Daily Cash never pays the ~1,900-row inventory read up front.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('New Walk-In Sale');
    expect(m.loadWalkInItemsAction).toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('saving a walk-in recalculates the totals in place — refetch summary, no full reload', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-add-walkin'));
    // The item picker lazy-loads first; wait for the modal, then simulate a successful save.
    // The shared modal signals success via onSaved → afterSave (refreshKey bump + a targeted
    // summary re-read), NEVER a router.refresh that would wipe the Actual Cash Count the
    // operator may be entering. (Save/routing logic itself is covered by
    // new-order-workflow.test.tsx; here the modal is stubbed to its onSaved contract.)
    await screen.findByText('stub-save');
    fireEvent.click(screen.getByText('stub-save'));
    await waitFor(() =>
      expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-10'),
    );
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('"+ Add New Entry" opens a modal (Expense by default), not a new page', async () => {
    renderView();
    await waitFor(() => expect(m.loadTradesExpensesAction).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('cash-add-entry'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Add Expense');
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('picking Type = Trade routes to the display-only trade action, not the expense one', async () => {
    renderView();
    await waitFor(() => expect(m.loadTradesExpensesAction).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('cash-add-entry'));
    fireEvent.change(screen.getByTestId('cash-entry-type'), {
      target: { value: 'trade' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Old ring trade-in' },
    });
    fireEvent.change(screen.getByLabelText('Amount (₱)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByTestId('cash-entry-save'));
    await waitFor(() => expect(m.addTradeAction).toHaveBeenCalled());
    expect(m.addExpenseAction).not.toHaveBeenCalled();
  });

  it('View opens a popup showing the row — it does not navigate to Orders', async () => {
    m.loadTradesExpensesAction.mockResolvedValue(withExpense());
    renderView();
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('👁 View'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Expense — Jollibee lunch')).toBeInTheDocument();
    expect(within(dialog).getByText('Meals')).toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('changing the date stays in this section — re-reads the day in place, never navigates', async () => {
    renderView();
    fireEvent.change(screen.getByTestId('cash-date'), {
      target: { value: '2026-08-09' },
    });
    await waitFor(() =>
      expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-09'),
    );
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('Delete asks first — it never deletes on the first click', async () => {
    m.loadTradesExpensesAction.mockResolvedValue(withExpense());
    renderView();
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('Delete'));
    // A confirmation popup — nothing deleted yet.
    expect(m.deleteCashRecordAction).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Delete expense?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(m.deleteCashRecordAction).toHaveBeenCalledWith(
        'daily_cash_expenses',
        'exp-1',
      ),
    );
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('saving an entry recalculates the totals in place — refetch summary, no full reload', async () => {
    renderView();
    await waitFor(() => expect(m.loadTradesExpensesAction).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('cash-add-entry'));
    fireEvent.click(screen.getByTestId('cash-entry-save'));

    await waitFor(() => expect(m.addExpenseAction).toHaveBeenCalled());
    // Totals recalculated via a targeted summary re-read, NOT a router.refresh().
    await waitFor(() =>
      expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-10'),
    );
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('the Owner gets Edit + Delete on a walk-in; Delete confirms then refreshes in place', async () => {
    renderView({ isOwner: true, walkInRows: { rows: [walkInRow], total: 1 } });
    await screen.findByText('Maria Santos');
    expect(screen.getByTestId('order-edit')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('delete-cancelled-order'));
    expect(m.deleteOrderAction).not.toHaveBeenCalled(); // asks to type DELETE first
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByTestId('delete-cancelled-order-confirm'));

    await waitFor(() =>
      expect(m.deleteOrderAction).toHaveBeenCalledWith('ord-1', 'DELETE'),
    );
    // In-place refresh, NOT a full router.refresh (which would wipe the Actual Cash Count).
    await waitFor(() => expect(m.loadCashSummaryAction).toHaveBeenCalled());
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('a non-owner does not see walk-in Edit / Delete (View still shows)', async () => {
    renderView({ isOwner: false, walkInRows: { rows: [walkInRow], total: 1 } });
    await screen.findByText('Maria Santos');
    expect(screen.queryByTestId('order-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-cancelled-order')).not.toBeInTheDocument();
    expect(screen.getByText('👁 View')).toBeInTheDocument();
  });
});
