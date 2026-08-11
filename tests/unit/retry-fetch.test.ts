import { describe, it, expect, vi } from 'vitest';

import { createRetryingFetch } from '@/lib/supabase/retry-fetch';

/**
 * The resilient Supabase fetch: transient blips on IDEMPOTENT reads self-heal, while
 * writes are never re-sent (a lost-response POST could double a payment or an order).
 * `baseDelayMs: 0` keeps the tests instant.
 */

const ok = () => new Response('ok', { status: 200 });
const busy = () => new Response('busy', { status: 503 });

describe('createRetryingFetch', () => {
  it('retries an idempotent GET that throws, then returns the eventual success', async () => {
    const base = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(ok());
    const f = createRetryingFetch(base, { baseDelayMs: 0 });

    const res = await f('https://db/rest/v1/staff_profiles', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('re-throws the real error after exhausting retries on a persistent GET failure', async () => {
    const err = new TypeError('connection reset');
    const base = vi.fn().mockRejectedValue(err);
    const f = createRetryingFetch(base, {
      baseDelayMs: 0,
      maxRetries: 2,
    });

    await expect(f('https://db', { method: 'GET' })).rejects.toBe(err);
    expect(base).toHaveBeenCalledTimes(3); // original + 2 retries
  });

  it('NEVER retries a POST that throws — a write must not be re-sent', async () => {
    const err = new TypeError('connection reset');
    const base = vi.fn().mockRejectedValue(err);
    const f = createRetryingFetch(base, { baseDelayMs: 0 });

    await expect(
      f('https://db/rest/v1/rpc/record_payment', { method: 'POST' }),
    ).rejects.toBe(err);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent GET on a transient 503, then returns 200', async () => {
    const base = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    const f = createRetryingFetch(base, { baseDelayMs: 0 });

    const res = await f('https://db', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a POST on a 503 — returns it unchanged', async () => {
    const base = vi.fn().mockResolvedValue(busy());
    const f = createRetryingFetch(base, { baseDelayMs: 0 });

    const res = await f('https://db', { method: 'POST' });

    expect(res.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('treats a request with no method as an idempotent GET', async () => {
    const base = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok());
    const f = createRetryingFetch(base, { baseDelayMs: 0 });

    const res = await f('https://db');

    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('does not retry a request whose signal is already aborted', async () => {
    const base = vi.fn().mockResolvedValue(ok());
    const f = createRetryingFetch(base, { baseDelayMs: 0 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      f('https://db', { method: 'GET', signal: controller.signal }),
    ).rejects.toThrow();
    expect(base).not.toHaveBeenCalled();
  });
});
