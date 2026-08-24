import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The ACTION control (Owner 2026-08-24, Issue 3 — MANUAL SEND is INDEPENDENT of AUTO SCREENSHOT).
 * Send is ALWAYS visible; it is ENABLED whenever the chat is LINKED (a recipient exists) + a
 * screenshot exists + the photo hasn't already gone out + it isn't a test — it does NOT wait for a
 * customer reply / photo-eligibility. Status chips live under Grams/Price, never here.
 */
const ID = 'cap-1';
const base = {
  captureRecordId: ID,
  photoEligible: false,
  chatLinked: true,
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

describe('CaptureSendControl — manual Send is independent of the reply wait', () => {
  it('Linked + unsent + screenshot → ENABLED even while Photo waiting; clicking sends', () => {
    const onSend = vi.fn();
    render(<CaptureSendControl {...base} photoEligible={false} onSend={onSend} onSave={vi.fn()} />);
    expect(send()).toBeInTheDocument();
    expect(send()).not.toBeDisabled();
    fireEvent.click(send());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Linked + Photo ready → ENABLED', () => {
    render(<CaptureSendControl {...base} photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).not.toBeDisabled();
  });

  it('AUTO TEXT sent + waiting for reply (link_sent) → Send STILL ENABLED (the Issue-3 case)', () => {
    render(
      <CaptureSendControl {...base} messageStatus="link_sent" photoEligible={false} onSend={vi.fn()} onSave={vi.fn()} />,
    );
    expect(send()).not.toBeDisabled();
  });

  it('NOT linked → Send VISIBLE but DISABLED (no recipient)', () => {
    render(<CaptureSendControl {...base} chatLinked={false} photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it('AUTO SS already sent → Send VISIBLE but DISABLED (one photo per capture)', () => {
    const onSend = vi.fn();
    render(<CaptureSendControl {...base} messageStatus="sent" photoEligible onSend={onSend} onSave={vi.fn()} />);
    expect(send()).toBeInTheDocument();
    expect(send()).toBeDisabled();
    fireEvent.click(send());
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Screenshot missing → Send VISIBLE but DISABLED', () => {
    render(<CaptureSendControl {...base} hasScreenshot={false} onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeDisabled();
  });

  it('Test capture → Send visible but DISABLED', () => {
    render(<CaptureSendControl {...base} isTest photoEligible onSend={vi.fn()} onSave={vi.fn()} />);
    expect(send()).toBeDisabled();
  });

  it('💾 Save appears ONLY when dirty; clicking calls onSave, never onSend; Send stays visible', () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(<CaptureSendControl {...base} onSend={onSend} onSave={onSave} />);
    expect(screen.queryByTestId(`incoming-save-${ID}`)).toBeNull();
    rerender(<CaptureSendControl {...base} dirty onSend={onSend} onSave={onSave} />);
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
