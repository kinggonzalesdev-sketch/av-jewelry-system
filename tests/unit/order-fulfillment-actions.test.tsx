import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderFulfillmentActions } from '@/components/orders/order-fulfillment-actions';
import type { FulfillmentRow } from '@/lib/fulfillment/service';

/**
 * Fulfillment actions hosted inside the Order modal (relocated from the standalone
 * page). These pin that the right guarded controls appear per status + permission,
 * and that a not-yet-queued order shows an honest note instead of dead controls.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/fulfillment/actions', () => ({
  completeFulfillmentAction: vi.fn(),
  decideApprovalAction: vi.fn(),
  dispatchAction: vi.fn(),
  executeApprovalAction: vi.fn(),
  markDeliveredAction: vi.fn(),
  releaseFulfillmentAction: vi.fn(),
  requestApprovalAction: vi.fn(),
}));
vi.mock('@/components/fulfillment/prepare-fulfillment-form', () => ({
  PrepareFulfillmentForm: () => <div data-testid="prepare-form" />,
}));
vi.mock('@/components/fulfillment/collection-controls', () => ({
  CollectionRemittanceControls: () => <div data-testid="collection-controls" />,
}));

function row(over: Partial<FulfillmentRow> = {}): FulfillmentRow {
  return {
    officialOrderId: 'o1',
    orderNumber: 'ORD-1',
    customerDisplayName: 'Maria',
    status: 'for_shipping',
    method: 'shipping',
    courier: null,
    trackingNumber: null,
    isCod: false,
    codApproved: false,
    dispatched: false,
    collectionChannel: null,
    collected: false,
    collectedAmount: null,
    remitted: false,
    verifiedNetPayments: '6000.00',
    totalAmountPayable: '6000.00',
    meetsDepositFloor: true,
    balanceUnavailable: null,
    ...over,
  };
}

describe('OrderFulfillmentActions', () => {
  it('shows an honest note when the order is not in the fulfillment queue', () => {
    render(
      <OrderFulfillmentActions
        row={null}
        approvals={[]}
        canPrepare
        canRelease
        canRequest={false}
        isOwner={false}
        onMutated={vi.fn()}
      />,
    );
    expect(screen.getByText(/not in the fulfillment queue/i)).toBeInTheDocument();
  });

  it('offers Normal Release for a releasable shipping order with the permission', () => {
    render(
      <OrderFulfillmentActions
        row={row({ status: 'for_shipping' })}
        approvals={[]}
        canPrepare
        canRelease
        canRequest={false}
        isOwner={false}
        onMutated={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /normal release/i })).toBeInTheDocument();
    expect(screen.getByTestId('prepare-form')).toBeInTheDocument();
  });

  it('offers Mark Picked Up once approved for a pickup order', () => {
    render(
      <OrderFulfillmentActions
        row={row({ status: 'approved_for_release', method: 'pickup' })}
        approvals={[]}
        canPrepare={false}
        canRelease
        canRequest={false}
        isOwner={false}
        onMutated={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /mark picked up/i })).toBeInTheDocument();
  });

  it('offers Mark Delivered (optional) + Complete for a dispatched shipping order', () => {
    render(
      <OrderFulfillmentActions
        row={row({ status: 'dispatched', method: 'shipping' })}
        approvals={[]}
        canPrepare={false}
        canRelease
        canRequest={false}
        isOwner={false}
        onMutated={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /mark delivered/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
  });

  it('offers Complete (no Mark Delivered) once a shipping order is delivered', () => {
    render(
      <OrderFulfillmentActions
        row={row({ status: 'delivered', method: 'shipping' })}
        approvals={[]}
        canPrepare={false}
        canRelease
        canRequest={false}
        isOwner={false}
        onMutated={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /mark delivered/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
  });
});
