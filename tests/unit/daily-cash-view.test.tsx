import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DailyCashView } from '@/components/cash/daily-cash-view';
import type {
  DailyCashSummary,
  DetailPage,
  ExpenseRow,
  WalkInRow,
} from '@/lib/cash/types';
import type { WalkInItem } from '@/lib/orders/service';

/**
 * Daily Cash Summary — the lower area is ONE self-contained, tabbed Details section
 * (Sales Walk-ins · Cash Payments · Trade Deductions · Expenses · Remittance · Other
 * Cash In · Other Cash Out). Clicking a tab swaps ONLY the Details table; Add / View /
 * Edit / Delete open modals in place. Nothing here navigates or does a full-page reload
 * (router.push / router.refresh) — a reload would wipe the Actual Cash Count the operator
 * is entering. These tests lock that contract.
 */

const m = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  loadCashDetailAction: vi.fn(),
  loadCashSummaryAction: vi.fn(),
  loadCashExportAction: vi.fn(),
  addExpenseAction: vi.fn(),
  updateExpenseAction: vi.fn(),
  addRemittanceAction: vi.fn(),
  updateRemittanceAction: vi.fn(),
  addCashMovementAction: vi.fn(),
  updateCashMovementAction: vi.fn(),
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
// refreshes the tab + totals — so stub it to avoid pulling in its printer/photo/action deps.
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
  addExpenseAction: m.addExpenseAction,
  updateExpenseAction: m.updateExpenseAction,
  addRemittanceAction: m.addRemittanceAction,
  updateRemittanceAction: m.updateRemittanceAction,
  addCashMovementAction: m.addCashMovementAction,
  updateCashMovementAction: m.updateCashMovementAction,
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
  scrapCashOut: '0',
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

const walkInRow: WalkInRow = {
  id: 'ord-1',
  orderNumber: 'WI-0001',
  name: 'Maria Santos',
  purchased: '9940',
  nonCash: '0',
  cash: '9940',
  tradeDeductions: '0',
};

const walkInItems: WalkInItem[] = [
  { id: 'inv-1', itemCode: 'K18-001', facebookName: 'Gold Ring', grams: '3.5' },
];

/** Make the Expenses tab (and only it) return the one expense row. */
function expensesReturn(row: ExpenseRow = expenseRow) {
  m.loadCashDetailAction.mockImplementation((tab: string) =>
    Promise.resolve(
      tab === 'expenses' ? { rows: [row], total: 1 } : { rows: [], total: 0 },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.loadCashDetailAction.mockResolvedValue({ rows: [], total: 0 });
  m.loadCashSummaryAction.mockResolvedValue(summary);
  m.addExpenseAction.mockResolvedValue({ ok: true });
  m.updateExpenseAction.mockResolvedValue({ ok: true });
  m.addRemittanceAction.mockResolvedValue({ ok: true });
  m.updateRemittanceAction.mockResolvedValue({ ok: true });
  m.addCashMovementAction.mockResolvedValue({ ok: true });
  m.updateCashMovementAction.mockResolvedValue({ ok: true });
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

const ALL_TABS = [
  'sales_walkins',
  'cash_payments',
  'trade_deductions',
  'expenses',
  'remittance',
  'other_cash_in',
  'other_cash_out',
];

describe('Daily Cash — one self-contained tabbed Details section', () => {
  it('renders all 7 tabs; Sales Walk-ins is the default and paints from props (no fetch)', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    for (const t of ALL_TABS) {
      expect(screen.getByTestId(`cash-tab-${t}`)).toBeInTheDocument();
    }
    // Default tab is served by the SSR-provided initialWalkIns — no detail fetch on mount.
    expect(m.loadCashDetailAction).not.toHaveBeenCalled();
    // The old two-box layout + "More" button are gone.
    expect(screen.queryByText('Trades & Expenses')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cash-more')).not.toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('clicking a tab loads ONLY that tab in place — no navigation, no full reload', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await waitFor(() =>
      expect(m.loadCashDetailAction).toHaveBeenCalledWith('expenses', '2026-08-10', 1, 8),
    );
    // The contextual Add button now belongs to Expenses.
    expect(screen.getByTestId('cash-add-expense')).toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('switching tabs never resets the Actual Cash Count being entered (§7)', () => {
    renderView();
    const count = screen.getByLabelText('Actual Cash Count');
    fireEvent.change(count, { target: { value: '5000' } });
    expect(count).toHaveValue('5,000'); // formatted display, live

    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    fireEvent.click(screen.getByTestId('cash-tab-remittance'));
    fireEvent.click(screen.getByTestId('cash-tab-sales_walkins'));

    // Still there — a tab switch never touches the parent's Actual Cash Count state.
    expect(screen.getByLabelText('Actual Cash Count')).toHaveValue('5,000');
  });

  it('the Add button is contextual per tab; the derived tabs have none', async () => {
    renderView();
    // Sales Walk-ins (default)
    expect(screen.getByTestId('cash-add-walkin')).toBeInTheDocument();

    const cases: Array<[string, string]> = [
      ['expenses', 'cash-add-expense'],
      ['remittance', 'cash-add-remittance'],
      ['other_cash_in', 'cash-add-cashin'],
      ['other_cash_out', 'cash-add-cashout'],
    ];
    for (const [tab, addId] of cases) {
      fireEvent.click(screen.getByTestId(`cash-tab-${tab}`));
      await waitFor(() => expect(screen.getByTestId(addId)).toBeInTheDocument());
    }

    // Derived, read-only tabs: no Add control at all.
    fireEvent.click(screen.getByTestId('cash-tab-cash_payments'));
    expect(screen.queryByTestId('cash-add-expense')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cash-add-walkin')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cash-tab-trade_deductions'));
    expect(screen.queryByTestId('cash-add-expense')).not.toBeInTheDocument();
  });

  it('"+ Add Expense" opens a modal and Save recalculates totals in place — no full reload', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    fireEvent.click(await screen.findByTestId('cash-add-expense'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Add Expense');
    fireEvent.change(within(dialog).getByLabelText('Amount (₱)'), {
      target: { value: '250' },
    });
    fireEvent.click(screen.getByTestId('cash-entry-save'));

    await waitFor(() => expect(m.addExpenseAction).toHaveBeenCalled());
    // Totals recalculated via a targeted summary re-read, NOT a router.refresh().
    await waitFor(() =>
      expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-10'),
    );
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('"+ Add Cash In" saves a movement with direction "in" (Cash Out → "out")', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-other_cash_in'));
    fireEvent.click(await screen.findByTestId('cash-add-cashin'));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Amount (₱)'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByTestId('cash-entry-save'));
    await waitFor(() =>
      expect(m.addCashMovementAction).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'in', amount: '300' }),
      ),
    );
  });

  it('View opens a popup showing the row — it does not navigate', async () => {
    expensesReturn();
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('👁 View'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Expense — Jollibee lunch')).toBeInTheDocument();
    expect(within(dialog).getByText('Meals')).toBeInTheDocument();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('Edit opens the same row in a prefilled modal — no navigation', async () => {
    expensesReturn();
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('Edit'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Edit Expense');
    expect(within(dialog).getByLabelText('Name / Payee')).toHaveValue('Jollibee lunch');
    expect(m.push).not.toHaveBeenCalled();
  });

  it('Delete asks first, then deletes the right record — never on the first click', async () => {
    expensesReturn();
    renderView();
    fireEvent.click(screen.getByTestId('cash-tab-expenses'));
    await screen.findByText('Jollibee lunch');

    fireEvent.click(screen.getByText('Delete'));
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
    // In-place recalc, never a full reload.
    await waitFor(() => expect(m.loadCashSummaryAction).toHaveBeenCalled());
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it('"+ Add New Sale" opens the shared Walk-In modal in-section (lazy item load)', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-add-walkin'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('New Walk-In Sale');
    expect(m.loadWalkInItemsAction).toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('saving a walk-in recalculates the totals in place — refetch summary, no full reload', async () => {
    renderView();
    fireEvent.click(screen.getByTestId('cash-add-walkin'));
    await screen.findByText('stub-save');
    fireEvent.click(screen.getByText('stub-save'));
    await waitFor(() =>
      expect(m.loadCashSummaryAction).toHaveBeenCalledWith('2026-08-10'),
    );
    expect(m.refresh).not.toHaveBeenCalled();
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
