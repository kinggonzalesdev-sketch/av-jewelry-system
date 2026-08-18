import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Actions are mocked — these render tests only assert what each destination shows, never a submit.
vi.mock('@/lib/orders/actions', () => ({
  setFulfillmentDetailsAction: vi.fn(),
  markOrderDispatchedAction: vi.fn(),
  transferOrderToCompletedAction: vi.fn(),
}));

import { OrderFulfillmentDetails } from '@/components/orders/order-fulfillment-details';

type Props = React.ComponentProps<typeof OrderFulfillmentDetails>;

function props(over: Partial<Props> = {}): Props {
  return {
    orderId: 'o1',
    destination: 'pickup',
    status: 'for_preparation',
    courier: null,
    pickupContact: null,
    dispatchedAt: null,
    completionBlock: null,
    balanceUnavailable: false,
    canPrepare: true,
    canRelease: true,
    onChanged: vi.fn(),
    ...over,
  };
}

describe('OrderFulfillmentDetails — destination-aware Phase A controls', () => {
  it('pickup: Pickup Contact + Mark Picked Up, and NO courier / dispatch', () => {
    render(<OrderFulfillmentDetails {...props({ destination: 'pickup' })} />);
    expect(screen.getByTestId('fulfillment-pickup-contact-input')).toBeInTheDocument();
    expect(screen.getByTestId('fulfillment-handover')).toHaveTextContent('Mark Picked Up');
    expect(screen.queryByTestId('fulfillment-courier-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fulfillment-mark-dispatched')).not.toBeInTheDocument();
  });

  it('delivery: Courier + Mark Delivered', () => {
    render(<OrderFulfillmentDetails {...props({ destination: 'delivery' })} />);
    expect(screen.getByTestId('fulfillment-courier-input')).toBeInTheDocument();
    expect(screen.getByTestId('fulfillment-handover')).toHaveTextContent('Mark Delivered');
    expect(screen.queryByTestId('fulfillment-pickup-contact-input')).not.toBeInTheDocument();
  });

  it('shipping: Courier + Mark Dispatched, and NO handover completion button', () => {
    render(
      <OrderFulfillmentDetails
        {...props({ destination: 'shipping', status: 'approved_for_release' })}
      />,
    );
    expect(screen.getByTestId('fulfillment-courier-input')).toBeInTheDocument();
    expect(screen.getByTestId('fulfillment-mark-dispatched')).toBeInTheDocument();
    expect(screen.queryByTestId('fulfillment-handover')).not.toBeInTheDocument();
  });

  it('shipping already dispatched: shows the dispatched timestamp, hides the button', () => {
    render(
      <OrderFulfillmentDetails
        {...props({
          destination: 'shipping',
          status: 'approved_for_release',
          dispatchedAt: '2026-08-18T00:00:00Z',
        })}
      />,
    );
    expect(screen.getByTestId('fulfillment-dispatched-at')).toBeInTheDocument();
    expect(screen.queryByTestId('fulfillment-mark-dispatched')).not.toBeInTheDocument();
  });

  it('layaway and keep render nothing (no irrelevant controls)', () => {
    const { container: lay } = render(
      <OrderFulfillmentDetails {...props({ destination: 'layaway' })} />,
    );
    expect(lay).toBeEmptyDOMElement();
    const { container: keep } = render(
      <OrderFulfillmentDetails {...props({ destination: 'keep' })} />,
    );
    expect(keep).toBeEmptyDOMElement();
  });

  it('a terminal (completed) order renders nothing', () => {
    const { container } = render(
      <OrderFulfillmentDetails {...props({ destination: 'pickup', status: 'completed' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('blocked completion shows the reason instead of the handover button', () => {
    render(
      <OrderFulfillmentDetails
        {...props({ destination: 'pickup', completionBlock: 'This order is not fully paid yet.' })}
      />,
    );
    expect(screen.getByTestId('fulfillment-handover-blocked')).toHaveTextContent(
      /not fully paid/i,
    );
    expect(screen.queryByTestId('fulfillment-handover')).not.toBeInTheDocument();
  });

  it('without fulfillment_release the handover button is hidden entirely', () => {
    render(<OrderFulfillmentDetails {...props({ destination: 'pickup', canRelease: false })} />);
    expect(screen.queryByTestId('fulfillment-handover')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fulfillment-handover-blocked')).not.toBeInTheDocument();
  });

  it('without fulfillment_preparation the detail fields are read-only (no input)', () => {
    render(
      <OrderFulfillmentDetails
        {...props({ destination: 'delivery', canPrepare: false, courier: 'LBC' })}
      />,
    );
    expect(screen.queryByTestId('fulfillment-courier-input')).not.toBeInTheDocument();
    expect(screen.getByText('LBC')).toBeInTheDocument();
  });
});
