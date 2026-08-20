import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CaptureSendControl } from '@/components/capture/capture-send-control';

/**
 * The per-row screenshot-delivery control renders exactly one thing, driven by the already-computed
 * `photoEligible` (Owner request 2026-08-20): Photo ready → 📨 Send · Photo waiting + FB chat → 💬
 * Open FB Chat · Photo waiting + no chat → neutral disabled "Photo waiting". A "Photo waiting"
 * capture must NEVER expose the Send button (that would be a doomed reply_inbox PHOTO).
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

  it('Photo waiting + FB chat URL → 💬 Open FB Chat (new tab), and NO Send button', () => {
    render(
      <CaptureSendControl
        captureRecordId={ID}
        photoEligible={false}
        fbUrl="https://m.me/waiting"
        isTest={false}
        sending={false}
        onSend={vi.fn()}
      />,
    );
    const open = screen.getByTestId(`incoming-openfb-${ID}`);
    expect(open).toHaveTextContent('Open FB Chat');
    expect(open).toHaveAttribute('href', 'https://m.me/waiting');
    expect(open).toHaveAttribute('target', '_blank');
    // The doomed Send route is not offered for a waiting customer.
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-waiting-${ID}`)).toBeNull();
  });

  it('Photo waiting + no FB chat URL → neutral disabled "Photo waiting" (no Send, no Open FB Chat)', () => {
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
    const waiting = screen.getByTestId(`incoming-waiting-${ID}`);
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveTextContent('Photo waiting');
    expect(screen.queryByTestId(`incoming-send-${ID}`)).toBeNull();
    expect(screen.queryByTestId(`incoming-openfb-${ID}`)).toBeNull();
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
