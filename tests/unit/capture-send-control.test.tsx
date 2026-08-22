import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The ACTION control (Owner 2026-08-22 — Send is ALWAYS visible; only its enabled state changes).
 * Send ALWAYS means the actual screenshot PHOTO. Status chips live under Grams/Price, never here.
 */
const ID = 'cap-1';
const base = {
  captureRecordId: ID,
  photoEligible: false,
  hasScreenshot: true,
  isTest: false,
  sending: false,
  saving: false,
  messageStatus: null as string | null,
  dirty: false,
  onSend: vi.fn(),
  onSave: vi.fn(),
};
const send = () => screen.getByTestId(`incoming-send-${ID}`);

describe('CaptureSendControl — Send always visible, enabled by state', () => {
  it('Photo ready + unsent + screenshot → Send visible + ENABLED; clicking sends the photo', () => {
    const onSend = vi.fn();
    render(<CaptureSendControl {...base} photoEligible onSend={onSend} onSave={vi.fn()} />);
    expect(send()).toBeInTheDocument();
    expect(send()).not.toBeDisabled();
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Photo waiting → Send VISIBLE but DISABLED', () => {
    render(<CaptureSendControl {...base} photoEligible={false} messageStatus="awaiting_inbox" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeDisabled();
  });

  it('AUTO TEXT sent + Photo waiting → Send VISIBLE but DISABLED', () => {
    render(<CaptureSendControl {...base} photoEligible={false} messageStatus="link_sent" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it('TEXT sent → LATER Photo ready → Send auto-ENABLES', () => {
    render(<CaptureSendControl {...base} messageStatus="link_sent" photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).not.toBeDisabled();
  });

  it('AUTO SS already sent → Send VISIBLE but DISABLED (no duplicate photo)', () => {
    const onSend = vi.fn();
    render(<CaptureSendControl {...base} messageStatus="sent" photoEligible onSend={onSend} onSave={vi.fn()} />);
    expect(send()).toBeInTheDocument();
    expect(send()).toBeDisabled();
    fireEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Screenshot missing → Send VISIBLE but DISABLED', () => {
    render(<CaptureSendControl {...base} photoEligible hasScreenshot={false} onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeDisabled();
  });

  it('Test capture → Send visible but DISABLED', () => {
    render(<CaptureSendControl {...base} isTest photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeDisabled();
  });

  it('💾 Save appears ONLY when dirty; clicking calls onSave, never onSend; Send stays visible', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(<CaptureSendControl {...base} photoEligible onSend={onSend} onSave={onSave} />);
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
    rerender(<CaptureSendControl {...base} photoEligible dirty onSend={onSend} onSave={onSave} />);
    fireEvent.click(screen.getByTestId(`incoming-save-${ID}`));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(send()).toBeInTheDocument();
  });

  it('never renders an AUTO SS / AUTO TEXT status chip in the action area', () => {
    render(<CaptureSendControl {...base} messageStatus="sent" onSend={vi.fn()} onSave={vi.fn()} />);
    expect(screen.queryByText(/AUTO (SS|TEXT)/i)).toBeNull();
  });
});
