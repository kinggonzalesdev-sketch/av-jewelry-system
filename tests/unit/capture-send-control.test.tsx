import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The per-row action control (Owner 2026-08-22 — CURRENT actionable state, no stale router text):
 *   Photo ready (unsent)   → 📨 Send (actual photo) — SUPERSEDES any stale awaiting/failed state.
 *   Photo already sent     → "AUTO SS Sent to Messenger ✓" (no duplicate Send).
 *   TEXT sent (not ready)  → "AUTO TEXT Sent to Messenger ✓".
 *   Photo waiting          → 💬 Open FB Chat only; NEVER internal pending/awaiting/sending text.
 *   💾 Save                → ONLY when dirty (unsaved edits); never sends anything.
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

describe('CaptureSendControl', () => {
  it('Photo ready (unsent) → 📨 Send, and NO Save (no edits), NO technical text', () => {
    const onSend = vi.fn();
    render(<CaptureSendControl {...base} photoEligible onSend={onSend} onSave={vi.fn()} />);
    const send = screen.getByTestId(`incoming-send-${ID}`);
    expect(send).toHaveTextContent('Send');
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
  });

  it('THE BUG: Photo ready + stale message_status=awaiting_inbox → still 📨 Send, no "pending" text', () => {
    render(
      <CaptureSendControl {...base} photoEligible messageStatus="awaiting_inbox" onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
    expect(screen.queryByText(/pending|awaiting comment|sending|backoff/i)).toBeNull();
  });

  it('THE BUG: Photo ready + stale message_status=failed → 📨 Send supersedes the stale failed chip', () => {
    render(
      <CaptureSendControl {...base} photoEligible messageStatus="failed" onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`incoming-status-${ID}`)).toBeNull();
    expect(screen.queryByText(/pending|awaiting comment/i)).toBeNull();
  });

  it('Photo already sent → "AUTO SS Sent to Messenger ✓" status, no Send', () => {
    render(<CaptureSendControl {...base} messageStatus="sent" photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-status-${ID}`)).toHaveTextContent('AUTO SS Sent to Messenger ✓');
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
  });

  it('TEXT sent + not eligible → "AUTO TEXT Sent to Messenger ✓"', () => {
    render(<CaptureSendControl {...base} messageStatus="link_sent" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-status-${ID}`)).toHaveTextContent('AUTO TEXT Sent to Messenger ✓');
  });

  it('TEXT sent + LATER Photo ready → 📨 Send (photo supersedes the TEXT chip; audit kept in DB)', () => {
    render(
      <CaptureSendControl {...base} messageStatus="link_sent" photoEligible onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`incoming-status-${ID}`)).toBeNull();
  });

  it('Photo waiting → 💬 Open FB Chat only; no Send, no Save, no technical text', () => {
    render(
      <CaptureSendControl {...base} messageStatus="awaiting_inbox" fbUrl="https://m.me/x" onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(screen.getByTestId(`incoming-openfb-${ID}`)).toHaveAttribute('href', 'https://m.me/x');
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
    expect(screen.queryByText(/pending|awaiting comment|sending/i)).toBeNull();
  });

  it('💾 Save appears ONLY when dirty, and clicking it calls onSave (never onSend)', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    render(<CaptureSendControl {...base} photoEligible dirty onSend={onSend} onSave={onSave} />);
    const save = screen.getByTestId(`incoming-save-${ID}`);
    expect(save).toHaveTextContent('Save');
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    // Send is still available alongside Save when Photo ready.
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeInTheDocument();
  });

  it('Test capture → Send disabled, and no Save even if dirty (a test never messages)', () => {
    render(<CaptureSendControl {...base} isTest photoEligible dirty onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByTestId(`incoming-send-${ID}`)).toBeDisabled();
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
  });
});
