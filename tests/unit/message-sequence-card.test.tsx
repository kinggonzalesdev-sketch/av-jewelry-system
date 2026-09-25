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
  screenshotAttempts: 3,
  updatedAt: null,
  available: true,
  computationFirstAvailable: true,
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
      settings: { ...initial, attempts: 2 },
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

  it('Computation First: its own description, Screenshot Send Attempts (default 3, only 1..3)', () => {
    render(<MessageSequenceCard initial={initial} />);
    fireEvent.click(screen.getByTestId('sequence-option-computation_first'));
    expect(
      screen.getByText(
        'Send the invoice/computation first, then immediately attempt the screenshot. If the screenshot cannot be sent after the allowed attempts, wait for a genuine customer reply before sending the screenshot.',
      ),
    ).toBeTruthy();
    const select = screen.getByTestId<HTMLSelectElement>('screenshot-send-attempts');
    expect(select.value).toBe('3');
    expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '3']);
    expect(screen.getByText('Screenshot Send Attempts')).toBeTruthy();
    // The Screenshot First setting is not shown for this sequence.
    expect(screen.queryByTestId('text-send-attempts')).toBeNull();
  });

  it('saves Computation First with the stable enum value and ITS attempt setting', async () => {
    vi.mocked(saveMessagingSequenceAction).mockResolvedValue({
      ok: true,
      settings: { ...initial, mode: 'computation_first', screenshotAttempts: 2 },
    });
    render(<MessageSequenceCard initial={initial} />);
    fireEvent.click(screen.getByTestId('sequence-option-computation_first'));
    fireEvent.change(screen.getByTestId('screenshot-send-attempts'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('message-sequence-save'));
    await waitFor(() =>
      expect(saveMessagingSequenceAction).toHaveBeenCalledWith({ mode: 'computation_first', attempts: 2 }),
    );
    await screen.findByText('Saved ✓ — applies to new captures.');
  });

  it('Computation First cannot be saved before its own database update exists', () => {
    render(<MessageSequenceCard initial={{ ...initial, computationFirstAvailable: false }} />);
    fireEvent.click(screen.getByTestId('sequence-option-computation_first'));
    expect(screen.getByTestId<HTMLButtonElement>('message-sequence-save').disabled).toBe(true);
    expect(screen.getByTestId('computation-first-unavailable')).toBeTruthy();
    // Screenshot First can still be saved as before.
    fireEvent.click(screen.getByTestId('sequence-option-screenshot_first'));
    fireEvent.change(screen.getByTestId('text-send-attempts'), { target: { value: '1' } });
    expect(screen.getByTestId<HTMLButtonElement>('message-sequence-save').disabled).toBe(false);
  });

  it('cannot be saved before the database update exists', () => {
    render(<MessageSequenceCard initial={{ ...initial, available: false }} />);
    fireEvent.click(screen.getByTestId('sequence-option-classic'));
    expect(screen.getByTestId<HTMLButtonElement>('message-sequence-save').disabled).toBe(true);
    expect(screen.getByText(/needs its database update/)).toBeTruthy();
  });
});
