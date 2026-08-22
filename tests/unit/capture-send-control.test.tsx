import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The per-row action control (Owner 2026-08-22 — messaging is fully AUTOMATIC + server-side):
 *   💾 Save         → saves operator edits ONLY; NEVER sends (no Messenger call).
 *   📨 Send Photo   → shown only when Photo-ready + not yet sent; a MANUAL actual-photo backup.
 *   status chip     → finite AUTO SS/TEXT Sent ✓ (message_status sent/link_sent) or the router's
 *                     finite failure reason (message_status failed) — a chip, never a button.
 *   💬 Open FB Chat → human fallback on failure / while waiting.
 * Invariants: NO "Send link" button, NO indefinite "Auto-sending…" spinner, and Save never sends.
 */
const ID = 'cap-1';

const base = {
  captureRecordId: ID,
  photoEligible: false,
  fbUrl: null as string | null,
  isTest: false,
  sending: false,
  saving: false,
  messageStatus: null as string | null,
  routeReason: null as string | null,
  onSend: vi.fn(),
  onSave: vi.fn(),
};

describe('CaptureSendControl', () => {
  it('Photo waiting (unsent) → 💾 Save only, no send/sendlink/spinner', () => {
    render(<CaptureSendControl {...base} onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-save-${ID}`)).toHaveTextContent('Save');
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-sendlink-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-waiting-${ID}`)).toBeNull();
  });

  it('Save click calls onSave, never onSend', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    render(<CaptureSendControl {...base} onSend={onSend} onSave={onSave} />);
    fireEvent.click(screen.getByTestId(`incoming-save-${ID}`));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Photo ready (unsent) → 📨 Send Photo (actual photo) + Save', () => {
    const onSend = vi.fn();
    render(
      <CaptureSendControl {...base} photoEligible fbUrl="https://m.me/ready" onSend={onSend} onSave={vi.fn()} />,
    );
    const send = screen.getByTestId(`incoming-send-${ID}`);
    expect(send).toHaveTextContent('Send Photo');
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`incoming-save-${ID}`)).toBeInTheDocument();
  });

  it('message_status link_sent → "AUTO TEXT Sent to Messenger ✓" status chip (not a button)', () => {
    render(<CaptureSendControl {...base} messageStatus="link_sent" onSend={vi.fn()} onSave={vi.fn()} />);
    const chip = screen.getByTestId(`incoming-status-${ID}`);
    expect(chip).toHaveTextContent('AUTO TEXT Sent to Messenger ✓');
    expect(chip.tagName).not.toBe('BUTTON');
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
  });

  it('message_status sent → "AUTO SS Sent to Messenger ✓" status chip', () => {
    render(<CaptureSendControl {...base} messageStatus="sent" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-status-${ID}`)).toHaveTextContent('AUTO SS Sent to Messenger ✓');
  });

  it('message_status failed → shows the router\'s finite reason + Save + Open FB Chat, no spinner', () => {
    render(
      <CaptureSendControl
        {...base}
        messageStatus="failed"
        routeReason="AUTO TEXT Failed · awaiting comment context"
        fbUrl="https://m.me/x"
        onSend={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId(`incoming-status-${ID}`)).toHaveTextContent('awaiting comment context');
    expect(screen.getByTestId(`incoming-save-${ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`incoming-openfb-${ID}`)).toHaveAttribute('href', 'https://m.me/x');
  });

  it('Test capture → Send stays disabled and no Save (a test never messages a real customer)', () => {
    render(<CaptureSendControl {...base} isTest photoEligible fbUrl="https://m.me/test" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeDisabled();
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
  });
});
