import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorRecoveryPanel } from '@/components/live/error-recovery-panel';
import type { LiveErrorReport } from '@/lib/live/error-recovery-types';

const listMock = vi.fn<() => Promise<LiveErrorReport>>();
const resendMock = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));

vi.mock('@/lib/live/live-ops-actions', () => ({
  listLiveErrorsAction: () => listMock(),
}));
vi.mock('@/lib/orders/actions', () => ({
  resendInvoiceAction: (id: string) => resendMock(id),
}));

describe('ErrorRecoveryPanel', () => {
  it('shows the empty state when there are no failures', async () => {
    listMock.mockResolvedValueOnce({ ok: true, messages: [], prints: [] });
    render(<ErrorRecoveryPanel />);
    expect(await screen.findByTestId('error-recovery-empty')).toBeInTheDocument();
  });

  it('lists a failed send and retries it via the order resend action', async () => {
    listMock.mockResolvedValue({
      ok: true,
      messages: [
        {
          id: 'm1',
          kind: 'message',
          title: 'Allyn Mae · ORD-2026-000005',
          detail: null,
          occurredAt: '2026-08-05T10:00:00Z',
          orderId: 'o1',
          isTest: false,
        },
      ],
      prints: [],
    });
    render(<ErrorRecoveryPanel />);

    fireEvent.click(await screen.findByTestId('error-recovery-retry-m1'));
    await waitFor(() => expect(resendMock).toHaveBeenCalledWith('o1'));
  });

  it('shows a failed print with its reason and no retry button', async () => {
    listMock.mockResolvedValueOnce({
      ok: true,
      messages: [],
      prints: [
        {
          id: 'p1',
          kind: 'print',
          title: 'BN-A-1001 — Ring · Allyn Mae',
          detail: 'Printer offline',
          occurredAt: '2026-08-05T10:00:00Z',
          orderId: null,
          isTest: true,
        },
      ],
    });
    render(<ErrorRecoveryPanel />);

    expect(await screen.findByTestId('error-recovery-prints')).toHaveTextContent(
      'Printer offline',
    );
    expect(screen.queryByTestId('error-recovery-retry-p1')).not.toBeInTheDocument();
  });
});
