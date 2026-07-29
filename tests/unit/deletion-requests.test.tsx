import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeletionRequestsPanel } from '@/components/settings/deletion-requests-panel';
import type { DeletionRequestRow } from '@/lib/authz/deletion-requests';

vi.mock('@/lib/authz/deletion-actions', () => ({
  decideDeletionRequestAction: vi.fn(),
  requestDeletionAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function row(over: Partial<DeletionRequestRow> = {}): DeletionRequestRow {
  return {
    id: crypto.randomUUID(),
    entityType: 'layaway_ledger',
    entityLabel: 'Layaway LAY-2026-000101',
    entityId: crypto.randomUUID(),
    reason: 'Duplicate row',
    status: 'pending',
    requestedByName: 'Lalyn De Dios',
    requestedAt: '2026-07-29T02:00:00.000Z',
    decidedByName: null,
    decidedAt: null,
    decisionNote: null,
    ...over,
  };
}

const mixed: DeletionRequestRow[] = [
  row(),
  row({ status: 'approved', decidedByName: 'King Gonzales', decidedAt: '2026-07-29T03:00:00.000Z' }),
  row({ status: 'rejected', decidedByName: 'King Gonzales', decidedAt: '2026-07-29T03:00:00.000Z' }),
  row({
    status: 'directly_deleted',
    requestedByName: 'King Gonzales',
    decidedByName: 'King Gonzales',
    decidedAt: '2026-07-29T03:00:00.000Z',
  }),
];

describe('Deletion Requests — the register (§2)', () => {
  it('shows the four tabs with their counts', () => {
    render(<DeletionRequestsPanel requests={mixed} isSuperAdmin />);
    for (const t of ['pending', 'approved', 'rejected', 'directly_deleted']) {
      expect(screen.getByTestId(`deletion-tab-${t}`)).toBeInTheDocument();
    }
    // One row in each bucket.
    expect(screen.getByTestId('deletion-tab-pending')).toHaveTextContent('1');
  });

  it('opens on Pending and shows only pending rows', () => {
    render(<DeletionRequestsPanel requests={mixed} isSuperAdmin />);
    const table = screen.getByTestId('deletion-requests');
    expect(within(table).getAllByText('Pending')).toHaveLength(1);
    expect(within(table).queryByText('Approved')).not.toBeInTheDocument();
  });

  it('switches buckets without losing the others', () => {
    render(<DeletionRequestsPanel requests={mixed} isSuperAdmin />);
    fireEvent.click(screen.getByTestId('deletion-tab-approved'));
    const table = screen.getByTestId('deletion-requests');
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    expect(within(table).queryByText('Pending')).not.toBeInTheDocument();
  });

  it('shows an honest empty state rather than a blank table', () => {
    render(<DeletionRequestsPanel requests={[]} isSuperAdmin />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('deletion-requests')).not.toBeInTheDocument();
  });
});

describe('Deletion Requests — who may decide', () => {
  it('offers Approve / Reject to a Super Admin on a pending row', () => {
    const r = row();
    render(<DeletionRequestsPanel requests={[r]} isSuperAdmin />);
    expect(screen.getByTestId(`deletion-approve-${r.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`deletion-reject-${r.id}`)).toBeInTheDocument();
  });

  it('offers NOTHING to an Admin — they may read the register, not decide it', () => {
    const r = row();
    render(<DeletionRequestsPanel requests={[r]} isSuperAdmin={false} />);
    expect(screen.queryByTestId(`deletion-approve-${r.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`deletion-reject-${r.id}`)).not.toBeInTheDocument();
    // …but the row itself is still visible, so they can follow their own request.
    expect(screen.getByTestId('deletion-requests')).toHaveTextContent(
      'Layaway LAY-2026-000101',
    );
  });

  it('never offers a decision on an already-decided row', () => {
    const r = row({ status: 'approved', decidedByName: 'King', decidedAt: '2026-07-29' });
    render(<DeletionRequestsPanel requests={[r]} isSuperAdmin />);
    fireEvent.click(screen.getByTestId('deletion-tab-approved'));
    expect(screen.queryByTestId(`deletion-approve-${r.id}`)).not.toBeInTheDocument();
  });

  it('confirms before approving, and names the record and the requester', () => {
    const r = row();
    render(<DeletionRequestsPanel requests={[r]} isSuperAdmin />);
    fireEvent.click(screen.getByTestId(`deletion-approve-${r.id}`));
    expect(screen.getByTestId('deletion-decide-confirm')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Layaway LAY-2026-000101');
    expect(screen.getByRole('dialog')).toHaveTextContent('Lalyn De Dios');
    expect(screen.getByRole('dialog')).toHaveTextContent('Duplicate row');
  });
});
