import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureReviewPanel } from '@/components/capture/capture-review-panel';
import type { CaptureReviewRow } from '@/lib/capture/review-types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const approveMock = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));
const rejectMock = vi.fn((_id: string, _r?: string | null) => Promise.resolve({ ok: true as const }));
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

  it('rejects a pending capture', async () => {
    render(<CaptureReviewPanel rows={[row()]} />);
    fireEvent.click(screen.getByTestId('capture-review-reject-r1'));
    await waitFor(() => expect(rejectMock).toHaveBeenCalledWith('r1', null));
  });
});
