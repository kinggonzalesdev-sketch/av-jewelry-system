import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The per-row screenshot-delivery control (Owner 2026-08-20, extended for Route B 2026-08-21):
 *   Route B link already sent → 🔗 Link sent (disabled, never resend)
 *   Photo ready               → 📨 Send
 *   Photo waiting             → 🔗 Send link (Route B TEXT Private Reply + secure /m link — the same
 *                               onSend handler, NEVER a doomed reply_inbox PHOTO) + 💬 Open FB Chat
 *                               when a chat URL exists.
 *   Test capture              → 📨 Send disabled.
 * The invariant preserved: a "Photo waiting" capture NEVER exposes the doomed photo Send
 * (`incoming-send`); its Send goes to Route B (`incoming-sendlink`).
 */
const ID = 'cap-1';

describe('CaptureSendControl', () => {
  it('Photo ready → 📨 Send, enabled, and clicking sends', () => {
    const onSend = vi.fn();
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible
        fbUrl="https://m.me/ready"
        isTest={false}
        sending={false}
        onSend={onSend}
      />,
    );
    const send = screen.getByTestId(`incoming-send-${ID}`);
    expect(send).not.toBeDisabled();
    expect(send).toHaveTextContent('Send');
    // Never the doomed-send-avoidance controls when the photo is actually deliverable.
    expect(screen.queryByTestId(`incoming-openfb-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-waiting-${ID}`)).toBeNull();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Photo ready + sending → shows Sending… and is disabled', () => {
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible
        fbUrl={null}
        isTest={false}
        sending
        onSend={vi.fn()}
      />,
    );
    const send = screen.getByTestId(`incoming-send-${ID}`);
    expect(send).toBeDisabled();
    expect(send).toHaveTextContent('Sending…');
  });

  it('Photo waiting + FB chat → 🔗 Send link (Route B) + 💬 Open FB Chat, and NO photo Send', () => {
    const onSend = vi.fn();
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible={false}
        fbUrl="https://m.me/waiting"
        isTest={false}
        sending={false}
        onSend={onSend}
      />,
    );
    const sendLink = screen.getByTestId(`incoming-sendlink-${ID}`);
    expect(sendLink).toHaveTextContent('Send link');
    fireEvent.click(sendLink);
    expect(onSend).toHaveBeenCalledTimes(1);
    const open = screen.getByTestId(`incoming-openfb-${ID}`);
    expect(open).toHaveAttribute('href', 'https://m.me/waiting');
    expect(open).toHaveAttribute('target', '_blank');
    // The doomed reply_inbox PHOTO Send is never offered for a waiting customer.
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
  });

  it('Photo waiting + no FB chat → 🔗 Send link only (Route B), no Open FB Chat, no photo Send', () => {
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible={false}
        fbUrl={null}
        isTest={false}
        sending={false}
        onSend={vi.fn()}
      />,
    );
    expect(screen.getByTestId(`incoming-sendlink-${ID}`)).toHaveTextContent('Send link');
    expect(screen.queryByTestId(`incoming-openfb-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
  });

  it('Route B link already sent → 🔗 Link sent, disabled, no other send controls (never resend)', () => {
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible={false}
        fbUrl="https://m.me/x"
        isTest={false}
        sending={false}
        onSend={vi.fn()}
        linkSent
      />,
    );
    const done = screen.getByTestId(`incoming-linksent-${ID}`);
    expect(done).toBeDisabled();
    expect(done).toHaveTextContent('Link sent');
    expect(screen.queryByTestId(`incoming-sendlink-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
  });

  it('Test capture → Send stays disabled (a test never messages a real customer), even if eligible', () => {
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible
        fbUrl="https://m.me/test"
        isTest
        sending={false}
        onSend={vi.fn()}
      />,
    );
    const send = screen.getByTestId(`incoming-send-${ID}`);
    expect(send).toBeDisabled();
    expect(screen.queryByTestId(`incoming-openfb-${ID}`)).toBeNull();
  });
});
