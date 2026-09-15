import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureReviewPanel } from '@/components/capture/capture-review-panel';
import type { CaptureReviewRow } from '@/lib/capture/review-types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const approveMock = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));
const rejectMock = vi.fn((_id: string, _r?: string | null) =>
  Promise.resolve({ ok: true as const }),
);
vi.mock('@/lib/capture/review-actions', () => ({
  approveCaptureReviewAction: (id: string) => approveMock(id),
  rejectCaptureReviewAction: (id: string, r?: string | null) => rejectMock(id, r),
}));

// Money is a client component that reads privacy context — stub to a plain span.
vi.mock('@/components/shell/privacy', () => ({
  Money: ({ amount }: { amount: string }) => <span>{amount}</span>,
}));

function row(over: Partial<CaptureReviewRow> = {}): CaptureReviewRow {
  return {
    id: 'r1',
    customerName: 'Allyn Mae',
    itemCode: 'BN-A-1001',
    itemName: 'Ring',
    price: '12000',
    grams: '3.5',
    screenshotPath: null,
    isTest: false,
    createdAt: '2026-08-05T10:00:00Z',
    ...over,
  };
}

describe('CaptureReviewPanel', () => {
  it('renders nothing when the queue is empty', () => {
    const { container } = render(<CaptureReviewPanel rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a pending capture and approves it', async () => {
    render(<CaptureReviewPanel rows={[row()]} />);
    expect(screen.getByTestId('capture-review-panel')).toHaveTextContent('Allyn Mae');
    fireEvent.click(screen.getByTestId('capture-review-approve-r1'));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('r1'));
  });

  it('rejects a pending capture only after the confirmation', async () => {
    render(<CaptureReviewPanel rows={[row()]} />);
    fireEvent.click(screen.getByTestId('capture-review-reject-r1'));
    // Reject DISCARDS the capture, so the first tap only opens the confirmation.
    expect(rejectMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('capture-review-reject-confirm'));
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('r1', null));
  });

  it('sends the optional reject reason', async () => {
    rejectMock.mockClear();
    render(<CaptureReviewPanel rows={[row()]} />);
    fireEvent.click(screen.getByTestId('capture-review-reject-r1'));
    fireEvent.change(await screen.findByLabelText('Reason (optional)'), {
      target: { value: 'Wrong item' },
    });
    fireEvent.click(screen.getByTestId('capture-review-reject-confirm'));
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('r1', 'Wrong item'));
  });

  it('never carries a reason typed for one capture into the next, and names the target', async () => {
    rejectMock.mockClear();
    render(
      <CaptureReviewPanel
        rows={[row(), row({ id: 'r2', customerName: 'Bea Cruz', itemCode: 'BN-A-2002' })]}
      />,
    );
    // Type a reason for r1, then back out.
    fireEvent.click(screen.getByTestId('capture-review-reject-r1'));
    fireEvent.change(await screen.findByLabelText('Reason (optional)'), {
      target: { value: 'Typed for r1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    // Open r2: the dialog names r2 and the reason field is empty.
    fireEvent.click(screen.getByTestId('capture-review-reject-r2'));
    expect(await screen.findByTestId('capture-review-reject-target')).toHaveTextContent(
      'Bea Cruz',
    );
    expect(screen.getByLabelText('Reason (optional)')).toHaveValue('');
    fireEvent.click(screen.getByTestId('capture-review-reject-confirm'));
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('r2', null));
  });
});
