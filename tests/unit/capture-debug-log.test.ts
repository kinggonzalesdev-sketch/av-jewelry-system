import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureDebugEnabled, captureDebugLog } from '@/lib/capture/debug-log';

/** Owner 2026-08-26 (P0-B): hot-path traces are OFF in production by default, re-enabled per env. */
afterEach(() => {
  delete process.env.CAPTURE_DEBUG_LOGS;
  vi.restoreAllMocks();
});

describe('captureDebug gate', () => {
  it('OFF when CAPTURE_DEBUG_LOGS is unset', () => {
    delete process.env.CAPTURE_DEBUG_LOGS;
    expect(captureDebugEnabled()).toBe(false);
  });

  it('ON for 1 / true / on / yes (case-insensitive)', () => {
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE', 'On']) {
      process.env.CAPTURE_DEBUG_LOGS = v;
      expect(captureDebugEnabled()).toBe(true);
    }
  });

  it('OFF for other values (0/false/empty)', () => {
    for (const v of ['0', 'false', '', 'no']) {
      process.env.CAPTURE_DEBUG_LOGS = v;
      expect(captureDebugEnabled()).toBe(false);
    }
  });

  it('captureDebugLog emits NOTHING when the flag is OFF (the production hot-path default)', () => {
    delete process.env.CAPTURE_DEBUG_LOGS;
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    captureDebugLog('[capture-router]', { skipped_no_work: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('captureDebugLog emits when the flag is ON', () => {
    process.env.CAPTURE_DEBUG_LOGS = '1';
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    captureDebugLog('[capture-router]', { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
