import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OwnerApprovalsPanel } from '@/components/orders/owner-approvals-panel';
import type { ApprovalRow } from '@/lib/fulfillment/service';

vi.mock('@/lib/fulfillment/actions', () => ({
  decideApprovalAction: vi.fn(),
  executeApprovalAction: vi.fn(),
  acceptCancellationApprovalAction: vi.fn(),
  rejectCancellationApprovalAction: vi.fn(),
}));

function approval(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'a1',
    actionKind: 'official_order_cancellation',
    status: 'pending_owner_approval',
    entityType: 'official_order',
    entityId: 'o1',
    reason: 'Customer changed their mind',
    requestedAt: '2026-07-28T00:00:00.000Z',
    decidedAt: null,
    executedAt: null,
    orderNumber: 'ORD-2026-000137',
    invoiceNumber: 'INV-000137',
    customerName: 'King Gonzales',
    requestedBy: 'Ana Cruz',
    payload: null,
    ...over,
  };
}

describe('Owner Approval Center — relocated onto the Orders page', () => {
  it('lists a pending CANCELLATION with one-step Accept / Reject (no Execute)', () => {
    render(<OwnerApprovalsPanel approvals={[approval()]} isOwner />);
    expect(screen.getByTestId('owner-approvals')).toBeInTheDocument();
    expect(screen.getByText(/official order cancellation/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('keeps Approve then Execute for NON-cancellation approvals', () => {
    const other = approval({ actionKind: 'exceptional_release' });
    render(<OwnerApprovalsPanel approvals={[other]} isOwner />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    render(
      <OwnerApprovalsPanel
        approvals={[approval({ actionKind: 'exceptional_release', status: 'approved' })]}
        isOwner
      />,
    );
    expect(screen.getByRole('button', { name: 'Execute' })).toBeInTheDocument();
  });

  it('never offers the decision controls to a non-Owner', () => {
    render(<OwnerApprovalsPanel approvals={[approval()]} isOwner={false} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText(/non-delegable/i)).toBeInTheDocument();
  });

  it('renders nothing when there is no outstanding approval', () => {
    const { container } = render(<OwnerApprovalsPanel approvals={[]} isOwner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides work that is already executed or rejected', () => {
    render(
      <OwnerApprovalsPanel
        approvals={[
          approval({
            id: 'a2',
            status: 'approved',
            executedAt: '2026-07-28T01:00:00.000Z',
          }),
          approval({
            id: 'a3',
            status: 'rejected',
            decidedAt: '2026-07-28T01:00:00.000Z',
          }),
        ]}
        isOwner
      />,
    );
    expect(screen.queryByTestId('owner-approvals')).not.toBeInTheDocument();
  });
});
