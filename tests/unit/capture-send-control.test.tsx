import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The per-row ACTION control (Owner 2026-08-22 — action area ONLY; delivery status lives under
 * Grams/Price, never here):
 *   Photo ready (unsent)   → 📨 Send (actual photo); SUPERSEDES any stale awaiting/failed state.
 *   Photo already sent     → NO Send here (prevents duplicate); the AUTO SS status shows under price.
 *   Photo waiting          → 💬 Open FB Chat only (Route B TEXT is automatic/background).
 *   💾 Save                → ONLY when dirty; never sends anything.
 * The control renders NO "AUTO TEXT/SS Sent ✓" chip — that moved to the dedicated status area.
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
  dirty: false,
  onSend: vi.fn(),
  onSave: vi.fn(),
};

describe('CaptureSendControl (action area only)', () => {
  it('Photo ready (unsent) → 📨 Send; no status chip in the action area', () => {
    const onSend = vi.fn();
    render(<CaptureSendControl {...base} photoEligible onSend={onSend} onSave={vi.fn()} />);
    const send = screen.getByTestId(`incoming-send-${ID}`);
    expect(send).toHaveTextContent('Send');
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`incoming-status-${ID}`)).toBeNull();
  });

  it('Photo ready + stale message_status awaiting_inbox/failed → still 📨 Send, no technical text', () => {
    const { rerender } = render(
      <CaptureSendControl {...base} photoEligible messageStatus="awaiting_inbox" onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
    rerender(<CaptureSendControl {...base} photoEligible messageStatus="failed" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
    expect(screen.queryByText(/pending|awaiting comment|sending|AUTO/i)).toBeNull();
  });

  it('Photo already sent → NO Send in the action area (status lives under Grams/Price)', () => {
    render(<CaptureSendControl {...base} messageStatus="sent" photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
    expect(screen.queryByText(/AUTO SS|AUTO TEXT/i)).toBeNull();
  });

  it('TEXT sent, LATER Photo ready → 📨 Send (photo supersedes the TEXT status)', () => {
    render(<CaptureSendControl {...base} messageStatus="link_sent" photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
  });

  it('Photo waiting (incl. link_sent, not eligible) → 💬 Open FB Chat only; no Send, no status chip', () => {
    render(
      <CaptureSendControl {...base} messageStatus="link_sent" fbUrl="https://m.me/x" onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId(`incoming-openfb-${ID}`)).toHaveAttribute('href', 'https://m.me/x');
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
    expect(screen.queryByText(/AUTO|pending|awaiting/i)).toBeNull();
  });

  it('💾 Save appears ONLY when dirty; clicking calls onSave, never onSend', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(<CaptureSendControl {...base} photoEligible onSend={onSend} onSave={onSave} />);
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
    rerender(<CaptureSendControl {...base} photoEligible dirty onSend={onSend} onSave={onSave} />);
    fireEvent.click(screen.getByTestId(`incoming-save-${ID}`));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument(); // Send stays alongside Save
  });

  it('Photo already sent + dirty → Save only (no Send)', () => {
    render(<CaptureSendControl {...base} messageStatus="sent" dirty onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-save-${ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
  });

  it('Test capture → Send disabled, no Save even if dirty', () => {
    render(<CaptureSendControl {...base} isTest photoEligible dirty onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeDisabled();
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
  });
});
