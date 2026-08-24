import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureLinkPanel, type EffectiveCaptureLink } from '@/components/capture/capture-link-panel';

// The panel imports server actions only for its interactive buttons — stub them for a render test.
vi.mock('@/lib/capture/pending-actions', () => ({
  clearCaptureLinkAction: vi.fn(),
  listCaptureCandidatesAction: vi.fn(() => Promise.resolve([])),
  setCaptureCustomerAction: vi.fn(),
}));

/**
 * Owner 2026-08-24 — "Photo waiting" must never be a dead-end. The bottom wording is state-accurate,
 * and "Waiting for reply to send screenshot" appears ONLY after a confirmed AUTO TEXT success.
 */
const linked = (over: Partial<EffectiveCaptureLink> = {}): EffectiveCaptureLink => ({
  linkStatus: 'linked',
  linkedCustomerName: 'Glaiza Sale Galang',
  conversationAvailable: true,
  photoEligible: false,
  fbUrl: null,
  matchCount: 1,
  ...over,
});

function renderPanel(opts: { photoEligible?: boolean; messageStatus?: string | null }) {
  return render(
    <CaptureLinkPanel
      captureRecordId="c1"
      link={linked({ photoEligible: opts.photoEligible ?? false })}
      onChanged={vi.fn()}
      messageStatus={opts.messageStatus ?? null}
    />,
  );
}

describe('CaptureLinkPanel — finite, state-accurate bottom wording', () => {
  it('photo-eligible → "Photo ready" (never "Photo waiting")', () => {
    renderPanel({ photoEligible: true, messageStatus: 'awaiting_inbox' });
    expect(screen.getByText(/Photo ready/)).toBeInTheDocument();
    expect(screen.queryByText(/Photo waiting/)).toBeNull();
  });

  it('AUTO TEXT sent (link_sent) → "Waiting for reply to send screenshot"', () => {
    renderPanel({ photoEligible: false, messageStatus: 'link_sent' });
    expect(screen.getByText(/Waiting for reply to send screenshot/)).toBeInTheDocument();
  });

  it('photo already sent → "Photo sent ✓"', () => {
    renderPanel({ photoEligible: false, messageStatus: 'sent' });
    expect(screen.getByText(/Photo sent ✓/)).toBeInTheDocument();
  });

  it('finite failure → "AUTO TEXT not sent" (not a spinner, not "waiting for reply")', () => {
    renderPanel({ photoEligible: false, messageStatus: 'failed' });
    expect(screen.getByText(/AUTO TEXT not sent/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for reply/)).toBeNull();
  });

  it('still routing (awaiting/null) → "Preparing AUTO TEXT", NOT "Waiting for reply" and NOT "Photo waiting"', () => {
    for (const messageStatus of ['awaiting_inbox', null]) {
      const { unmount } = renderPanel({ photoEligible: false, messageStatus });
      expect(screen.getByText(/Preparing AUTO TEXT/)).toBeInTheDocument();
      expect(screen.queryByText(/Waiting for reply/)).toBeNull();
      expect(screen.queryByText(/Photo waiting/)).toBeNull();
      unmount();
    }
  });

  it('CRITICAL — "Waiting for reply to send screenshot" never shows before AUTO TEXT success', () => {
    for (const messageStatus of ['awaiting_inbox', 'failed', null]) {
      const { unmount } = renderPanel({ photoEligible: false, messageStatus });
      expect(screen.queryByText(/Waiting for reply to send screenshot/)).toBeNull();
      unmount();
    }
  });

  it('customer replied after AUTO TEXT (link_sent AND now eligible) → "Photo ready" wins', () => {
    renderPanel({ photoEligible: true, messageStatus: 'link_sent' });
    expect(screen.getByText(/Photo ready/)).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for reply/)).toBeNull();
  });
});
