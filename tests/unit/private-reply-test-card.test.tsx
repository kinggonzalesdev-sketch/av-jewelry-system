import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsView } from '@/components/integrations/integrations-view';

/**
 * Controlled Test B harness — SEARCH + pre-Run verification safety (Owner request
 * 2026-08-17). The consented comment must be located by its unique text and EXPLICITLY
 * selected; the Run button stays disabled until every hard identity check passes. These
 * guard against ever privately replying to the wrong (or a non-eligible) comment.
 */

vi.mock('@/lib/integrations/actions', () => ({
  runPrivateReplyTestAction: vi.fn(),
  sendControlledPhotoAction: vi.fn(),
  saveSelectedPageAction: () => ({ error: null, success: null }),
  saveSelectedSenderAction: () => ({ error: null, success: null }),
  sendPancakeTestAction: () => ({ error: null, success: null }),
  syncPancakeConversationsAction: () => ({ error: null, success: null }),
}));

const identity = {
  pageId: '…161430',
  postType: 'video',
  messageType: 'COMMENT',
  postId: '…6705',
  commentId: '…3043',
  psid: '…0834',
  pageCustomerId: '…6fe4',
  commentConversationId: '…abc123',
};
const checks = (over: Record<string, boolean> = {}) => ({
  pageIdOk: true,
  postTypeOk: true,
  messageTypeOk: true,
  postIdOk: true,
  commentIdOk: true,
  psidOk: true,
  conversationOk: true,
  canReplyPrivately: true,
  notAlreadyReplied: true,
  pageCustomerPresent: true,
  ...over,
});
const candidate = (over: Record<string, unknown> = {}) => ({
  webhookEventId: 'e1',
  fbName: 'April V',
  commentPreview: 'TESTB-AV-817',
  at: '2026-08-17T12:00:00.000Z',
  canReplyPrivately: true,
  identity,
  checks: checks(),
  allValid: true,
  ...over,
});

function mockFetch(candidates: unknown[]) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ ok: true, candidates }),
  } as unknown as Response);
}

const sender = { userId: 'u1', userName: 'Samuel' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Controlled Test B — search + pre-Run verification', () => {
  it('does NOT auto-select from a multi-row list; Run stays disabled', async () => {
    mockFetch([
      candidate({ webhookEventId: 'e1' }),
      candidate({ webhookEventId: 'e2', fbName: 'A Customer' }),
    ]);
    render(<IntegrationsView canManagePages selectedSender={sender} />);

    fireEvent.click(screen.getByTestId('pr-test-load'));
    await screen.findByTestId('pr-test-candidate');

    expect(screen.getByTestId('pr-test-run')).toBeDisabled();
    expect(screen.queryByTestId('pr-test-verify')).not.toBeInTheDocument();
  });

  it('enables Run only after an all-valid comment is explicitly selected', async () => {
    mockFetch([candidate({ webhookEventId: 'e1' })]); // single match → pre-selected
    render(<IntegrationsView canManagePages selectedSender={sender} />);

    fireEvent.click(screen.getByTestId('pr-test-load'));
    expect(await screen.findByTestId('pr-test-verify')).toHaveTextContent(
      /stable identity confirmed/i,
    );
    expect(screen.getByTestId('pr-test-run')).toBeEnabled();
  });

  it('keeps Run DISABLED for an eligible-but-invalid comment (a failing hard check)', async () => {
    // Eligible (crp+complete+not-replied) yet a hard check fails (message.type ≠ COMMENT).
    mockFetch([candidate({ checks: checks({ messageTypeOk: false }), allValid: false })]);
    render(<IntegrationsView canManagePages selectedSender={sender} />);

    fireEvent.click(screen.getByTestId('pr-test-load'));
    expect(await screen.findByTestId('pr-test-verify')).toHaveTextContent(/NOT READY/i);
    expect(screen.getByTestId('pr-test-run')).toBeDisabled();
  });

  it('search hits the ?q= endpoint to narrow by exact text', async () => {
    const fn = mockFetch([candidate()]);
    render(<IntegrationsView canManagePages selectedSender={sender} />);

    fireEvent.change(screen.getByTestId('pr-test-search'), {
      target: { value: 'TESTB-AV-817' },
    });
    fireEvent.click(screen.getByTestId('pr-test-search-btn'));

    await screen.findByTestId('pr-test-candidate');
    const arg = fn.mock.calls[0]?.[0];
    const url = typeof arg === 'string' ? arg : '';
    expect(url).toContain('private-reply-candidates?q=');
    expect(url).toContain('TESTB-AV-817');
  });
});
