import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import type { OrderDetail, OrderDetailResult } from '@/lib/orders/detail-types';

/**
 * The reusable Order Details modal: a centered, in-page popup that never
 * navigates. These tests pin the behaviour the spec requires — closed renders
 * nothing, open loads and shows the order, and X / Escape / backdrop all close it
 * — plus the honest loading and error states.
 */

const loadOrderDetailAction = vi.fn<(id: string) => Promise<OrderDetailResult>>();

vi.mock('@/lib/orders/actions', () => ({
  loadOrderDetailAction: (id: string) => loadOrderDetailAction(id),
  verifyForInvoiceAction: vi.fn(() => Promise.resolve({ ok: true })),
  saveOrderInvoiceMessageAction: vi.fn(() => Promise.resolve({ ok: true })),
  confirmRequiredPaymentAction: vi.fn(() => Promise.resolve({ ok: true })),
  readyForPreparationAction: vi.fn(() => Promise.resolve({ ok: true })),
  loadOrderRemindersAction: vi.fn(() =>
    Promise.resolve({ reminders: [], customerResponse: null }),
  ),
  sendOrderReminderAction: vi.fn(() => Promise.resolve({ ok: true })),
  setCustomerResponseAction: vi.fn(() => Promise.resolve({ ok: true })),
  loadOrderInvoiceMessageAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      message: {
        body: 'Thank you for choosing A.V. Jewelry!',
        status: 'ready_to_copy_or_send',
        sentAt: null,
        sentByName: null,
        preparedByName: 'Owner',
      },
    }),
  ),
}));

// The modal now hosts OrderFulfillmentActions, which calls useRouter for its
// post-action refresh. A minimal stub is enough for these read/close tests.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function detail(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    officialOrderId: 'o1',
    orderNumber: 'ORD-2026-000101',
    invoiceNumber: 'INV-2026-000101',
    status: 'for_preparation',
    createdAt: '2026-07-16T00:00:00.000Z',
    fulfillmentDestination: null,
    destinationSetAt: null,
    destinationSetByName: null,
    // Not completable by default — the fixture order is not fully paid.
    completionBlock: 'This order is not fully paid yet.',
    adminName: 'UAT Owner',
    completedAt: null,
    completedByName: null,
    customer: {
      id: 'cust-1',
      displayName: 'Maria Santos',
      contactNumber: '0917',
      address: 'Cebu',
      facebookConversationUrl: null,
    },
    items: [
      {
        claimReference: 'CLM-1',
        itemName: 'Gold Ring',
        itemCode: 'PL-1',
        gramsPerPiece: '5',
        quantity: 2,
        unitPrice: '8000.00',
      },
    ],
    amounts: {
      unavailable: null,
      totalAmountPayable: '16000.00',
      verifiedNetPayments: '6000.00',
      outstandingBalance: '10000.00',
      overpaymentCredit: '0.00',
      requiredDownPayment: '3200.00',
      paidInFull: false,
    },
    paymentStatus: 'partial',
    paymentHistory: [],
    fulfillment: null,
    fulfillmentRow: null,
    approvals: [],
    layaway: null,
    attachments: [],
    activity: [],
    permissions: {
      isOwner: false,
      canRecordPayment: false,
      canPrepareFulfillment: false,
      canReleaseFulfillment: false,
      canPrepareInvoice: false,
      canRequestApproval: false,
    },
    payable: null,
    ...over,
  };
}

beforeEach(() => {
  loadOrderDetailAction.mockReset();
  document.body.style.overflow = '';
});

describe('OrderDetailsModal', () => {
  it('renders nothing and loads nothing while closed', () => {
    render(<OrderDetailsModal orderId={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('order-modal')).not.toBeInTheDocument();
    expect(loadOrderDetailAction).not.toHaveBeenCalled();
  });

  it('shows the simplified For Invoice view (6 fields + FB chat + editable message + Send Invoice)', async () => {
    loadOrderDetailAction.mockResolvedValue({
      ok: true,
      detail: detail({
        status: 'invoiced',
        customer: {
          id: 'cust-1',
          displayName: 'Maria Santos',
          contactNumber: '0917',
          address: 'Cebu',
          facebookConversationUrl: 'https://m.me/example',
        },
        permissions: {
          isOwner: true,
          canRecordPayment: false,
          canPrepareFulfillment: false,
          canReleaseFulfillment: false,
          canPrepareInvoice: true,
          canRequestApproval: false,
        },
      }),
    });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);

    // Only the six approved facts show — no financial/fulfillment summary, no tabs.
    const fields = await screen.findByTestId('for-invoice-fields');
    expect(fields).toHaveTextContent('Order Number');
    expect(fields).toHaveTextContent('Customer Name');
    expect(fields).toHaveTextContent('Total Price');
    expect(fields).toHaveTextContent('Total Grams');
    expect(fields).toHaveTextContent('Date Created');
    // Total grams = 5g × 2 = 10g.
    expect(fields).toHaveTextContent('10g');
    expect(screen.queryByText(/Financial summary/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-modal-tab-items')).not.toBeInTheDocument();
    // The old manual Facebook link input + Save link are gone.
    expect(screen.queryByPlaceholderText(/m\.me/i)).not.toBeInTheDocument();

    expect(screen.getByTestId('order-open-fb-chat')).toBeInTheDocument();
    expect(screen.getByTestId('order-send-invoice')).toBeInTheDocument();

    // View / Edit Message loads the prepared message into an EDITABLE textarea.
    fireEvent.click(screen.getByTestId('order-view-message'));
    const editor = await screen.findByTestId<HTMLTextAreaElement>('order-message-edit');
    expect(editor).toHaveValue('Thank you for choosing A.V. Jewelry!');
    expect(editor).not.toBeDisabled();
    expect(screen.getByTestId('order-message-save')).toBeInTheDocument();
  });

  it('Send Invoice asks for confirmation, then advances For Invoice → For Reminder', async () => {
    const { verifyForInvoiceAction } = await import('@/lib/orders/actions');
    loadOrderDetailAction.mockResolvedValue({
      ok: true,
      detail: detail({
        status: 'invoiced',
        permissions: {
          isOwner: true,
          canRecordPayment: false,
          canPrepareFulfillment: false,
          canReleaseFulfillment: false,
          canPrepareInvoice: true,
          canRequestApproval: false,
        },
      }),
    });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('order-send-invoice'));
    // A confirmation step appears; the transition only runs after confirming.
    expect(screen.getByTestId('order-send-confirm')).toHaveTextContent(
      /Confirm that the invoice details were sent/i,
    );
    expect(verifyForInvoiceAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('order-send-invoice-confirm'));
    expect(verifyForInvoiceAction).toHaveBeenCalledWith('o1');
  });

  it('Open FB Chat reports when no chat link is on file (and never changes status)', async () => {
    const { verifyForInvoiceAction } = await import('@/lib/orders/actions');
    (verifyForInvoiceAction as ReturnType<typeof vi.fn>).mockClear();
    loadOrderDetailAction.mockResolvedValue({
      ok: true,
      detail: detail({ status: 'invoiced' }), // facebookConversationUrl: null
    });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('order-open-fb-chat'));
    expect(screen.getByTestId('order-fb-notice')).toHaveTextContent(
      'Facebook chat link is not available.',
    );
    expect(verifyForInvoiceAction).not.toHaveBeenCalled();
  });

  it('shows the simplified For Reminder view (fields + 3 reminders + Confirm for Preparation)', async () => {
    const { sendOrderReminderAction, setCustomerResponseAction } = await import(
      '@/lib/orders/actions'
    );
    loadOrderDetailAction.mockResolvedValue({
      ok: true,
      detail: detail({
        status: 'awaiting_required_payment',
        permissions: {
          isOwner: true,
          canRecordPayment: true,
          canPrepareFulfillment: false,
          canReleaseFulfillment: false,
          canPrepareInvoice: false,
          canRequestApproval: false,
        },
      }),
    });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);

    // Stripped-down fields; the response dropdown is gone (moved to For Prepare).
    const fields = await screen.findByTestId('for-reminder-fields');
    expect(fields).toHaveTextContent('Remaining Required Payment');
    expect(fields).toHaveTextContent('₱0'); // required 3,200 − verified 6,000 → 0
    expect(screen.queryByTestId('order-customer-response')).not.toBeInTheDocument();

    // Reminder 1 enabled; 2 and 3 locked until the prior is sent.
    expect(await screen.findByTestId('order-send-reminder-1')).not.toBeDisabled();
    expect(screen.getByTestId('order-send-reminder-2')).toBeDisabled();
    expect(screen.getByTestId('order-send-reminder-3')).toBeDisabled();

    // Sending a reminder never moves the order; it records after confirmation.
    fireEvent.click(screen.getByTestId('order-send-reminder-1'));
    fireEvent.click(screen.getByTestId('order-reminder-confirm'));
    expect(sendOrderReminderAction).toHaveBeenCalled();
    expect(setCustomerResponseAction).not.toHaveBeenCalled();

    // Confirm for Preparation requires its confirmation before moving to For Prepare.
    fireEvent.click(screen.getByTestId('order-confirm-preparation'));
    expect(screen.getByTestId('order-prep-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('order-prep-confirm-apply'));
    expect(setCustomerResponseAction).toHaveBeenCalledWith('o1', 'confirmed');
  });

  it('shows Ready for Preparation for a For Confirm order (fulfillment permission)', async () => {
    loadOrderDetailAction.mockResolvedValue({
      ok: true,
      detail: detail({
        status: 'required_payment_verified',
        permissions: {
          isOwner: true,
          canRecordPayment: false,
          canPrepareFulfillment: true,
          canReleaseFulfillment: false,
          canPrepareInvoice: false,
          canRequestApproval: false,
        },
      }),
    });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);
    expect(await screen.findByTestId('order-workflow-advance')).toHaveTextContent(
      /Ready for Preparation/i,
    );
  });

  it('hides the For-Invoice view for a non-invoiced order', async () => {
    loadOrderDetailAction.mockResolvedValue({ ok: true, detail: detail() });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);
    await screen.findByText('Gold Ring');
    expect(screen.queryByTestId('order-send-invoice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-open-fb-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('for-invoice-fields')).not.toBeInTheDocument();
  });

  it('shows a loading state, then the order detail once loaded', async () => {
    loadOrderDetailAction.mockResolvedValue({ ok: true, detail: detail() });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);

    expect(screen.getByText(/Loading order details/i)).toBeInTheDocument();

    expect(await screen.findByText('Gold Ring')).toBeInTheDocument();
    // Order + invoice numbers, remaining balance, and the paid figure all show.
    expect(screen.getAllByText('ORD-2026-000101').length).toBeGreaterThan(0);
    expect(screen.getByText(/Remaining balance/i)).toBeInTheDocument();
  });

  it('locks background scroll while open and restores it on close', async () => {
    loadOrderDetailAction.mockResolvedValue({ ok: true, detail: detail() });
    const { rerender } = render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);
    await screen.findByTestId('order-modal');
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<OrderDetailsModal orderId={null} onClose={vi.fn()} />);
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes on the X button, the backdrop, and Escape', async () => {
    loadOrderDetailAction.mockResolvedValue({ ok: true, detail: detail() });
    const onClose = vi.fn();
    render(<OrderDetailsModal orderId="o1" onClose={onClose} />);
    await screen.findByTestId('order-modal');

    fireEvent.click(screen.getByTestId('order-modal-close'));
    fireEvent.click(screen.getByTestId('order-modal-backdrop'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('surfaces a read error explicitly instead of an empty order', async () => {
    loadOrderDetailAction.mockResolvedValue({ ok: false, reason: 'denied' });
    render(<OrderDetailsModal orderId="o1" onClose={vi.fn()} />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });
});
