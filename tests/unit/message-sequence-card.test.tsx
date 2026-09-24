import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageSequenceCard } from '@/components/settings/message-sequence-card';
import { saveMessagingSequenceAction } from '@/lib/messaging/actions';

vi.mock('@/lib/messaging/actions', () => ({
  saveMessagingSequenceAction: vi.fn(),
}));

const initial = {
  mode: 'screenshot_first' as const,
  attempts: 3,
  updatedAt: null,
  available: true,
};

describe('Settings → Live Selling / Messaging', () => {
  beforeEach(() => {
    vi.mocked(saveMessagingSequenceAction).mockReset();
  });

  it('shows Screenshot First selected with 3 text attempts and the Owner description', () => {
    render(<MessageSequenceCard initial={initial} />);
    expect(screen.getByText('Live Selling / Messaging')).toBeTruthy();
    expect(screen.getByTestId<HTMLInputElement>('sequence-option-screenshot_first').checked).toBe(true);
    expect(screen.getByTestId<HTMLSelectElement>('text-send-attempts').value).toBe('3');
    expect(
      screen.getByText(
        'Send the screenshot first, then attempt to send the invoice/computation text. If the text cannot be sent after the allowed attempts, wait for a genuine customer reply before sending the text.',
      ),
    ).toBeTruthy();
    // Only 1..3 can be chosen — never unlimited.
    const options = [...screen.getByTestId<HTMLSelectElement>('text-send-attempts').options].map((o) => o.value);
    expect(options).toEqual(['1', '2', '3']);
  });

  it('saves the enum value and attempt count, and only when something changed', async () => {
    vi.mocked(saveMessagingSequenceAction).mockResolvedValue({
      ok: true,
      settings: { mode: 'screenshot_first', attempts: 2, updatedAt: null, available: true },
    });
    render(<MessageSequenceCard initial={initial} />);
    const save = screen.getByTestId<HTMLButtonElement>('message-sequence-save');
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('text-send-attempts'), { target: { value: '2' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(saveMessagingSequenceAction).toHaveBeenCalledWith({ mode: 'screenshot_first', attempts: 2 }),
    );
    await screen.findByText('Saved ✓ — applies to new captures.');
  });

  it('cannot be saved before the database update exists', () => {
    render(<MessageSequenceCard initial={{ ...initial, available: false }} />);
    fireEvent.click(screen.getByTestId('sequence-option-classic'));
    expect(screen.getByTestId<HTMLButtonElement>('message-sequence-save').disabled).toBe(true);
    expect(screen.getByText(/needs its database update/)).toBeTruthy();
  });
});
