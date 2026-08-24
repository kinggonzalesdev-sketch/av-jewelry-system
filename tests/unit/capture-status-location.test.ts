import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Owner 2026-08-22 — the AUTO TEXT / AUTO SS delivery status must live in ONE dedicated area UNDER
 * Grams/Price (in the strip's left column), and must NEVER occupy or replace the Send action. These
 * source assertions lock that separation (the control renders the action area only).
 */
const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

describe('Incoming Captures — messaging status lives under Grams/Price, not in the action area', () => {
  const control = src('components/capture/capture-send-control.tsx');
  const strip = src('components/capture/incoming-captures-strip.tsx');

  it('the ACTION control does NOT render the AUTO SS / AUTO TEXT status chips', () => {
    // Only the doc comment may mention them; there must be no rendered status literal in the control.
    const code = control
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.includes('/**'))
      .join('\n');
    expect(code).not.toContain('AUTO SS Sent to Messenger');
    expect(code).not.toContain('AUTO TEXT Sent to Messenger');
    expect(code).not.toContain('incoming-status-'); // the old action-area status chip testid is gone
  });

  it('the strip renders BOTH statuses in ONE dedicated area (incoming-msgstatus) keyed off message_status', () => {
    expect(strip).toContain('incoming-msgstatus-');
    expect(strip).toContain('AUTO SS Sent to Messenger ✓');
    expect(strip).toContain('AUTO TEXT Sent to Messenger ✓');
    // Driven by the authoritative delivery state, not the technical route_reason.
    expect(strip).toContain("r.messageStatus === 'sent'");
    expect(strip).toContain("r.messageStatus === 'link_sent'");
  });

  it('the control still owns the Send action (actual photo), separate from the status', () => {
    expect(control).toContain('incoming-send-');
    // Manual Send is gated by a LINKED chat (a recipient), independent of the photo-eligibility /
    // reply wait (Owner 2026-08-24, Issue 3).
    expect(control).toContain('chatLinked && !photoSent');
  });
});
