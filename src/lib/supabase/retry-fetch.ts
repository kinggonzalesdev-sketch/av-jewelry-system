/**
 * Resilient `fetch` for the Supabase server clients.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every server render reaches Supabase over HTTPS (auth `getUser`, RLS reads, RPCs).
 * The application code checks the `{ data, error }` result of each call, so a normal
 * API error (a 4xx with a body) is handled gracefully. But a *network-level* failure
 * — a dropped connection, a DNS blip, a cold-start timeout, a momentary 502/503 from
 * the gateway — makes the underlying `fetch` REJECT (throw), which is NOT the same as
 * an `{ error }` result. That thrown rejection propagates out of the read, past the
 * defensive `{ error }` handling, and trips the app-wide error boundary — the
 * "Something went wrong" screen a user can hit for a split second right after signing
 * in, even though nothing is actually broken.
 *
 * This wrapper makes those transient blips self-heal: it retries the request a small,
 * bounded number of times with a short backoff, so a one-off hiccup never surfaces to
 * the user.
 *
 * SAFETY: ONLY IDEMPOTENT READS ARE RETRIED
 * -----------------------------------------
 * A retry is only safe when re-sending the request cannot change state twice. So this
 * retries GET and HEAD only. A POST/PATCH/PUT/DELETE may have ALREADY been applied on
 * the server even though its response was lost in transit — re-sending it could double
 * a payment, an order, or any other write. Writes are therefore NEVER retried, and
 * because Supabase RPCs are issued as POST, they are not retried here either (by
 * design — correctness beats a retry). The auth/session and RLS table reads that gate
 * the whole app (and cause the login-time error) are GET/HEAD, so they are covered.
 *
 * HONESTY: a genuine, persistent outage still surfaces. Retries are capped and add a
 * short bounded delay only on failure; once they are exhausted the original failure is
 * returned/re-thrown unchanged. A failure stays a failure — it is never faked into a
 * success (Bible §32).
 */

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/** Transient upstream statuses worth one more try for an idempotent read. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export type RetryingFetchOptions = {
  /** Extra attempts after the first (default 2 → up to 3 tries total). */
  maxRetries?: number;
  /** Linear backoff base; attempt N waits N × this many ms (default 150). */
  baseDelayMs?: number;
};

function methodOf(input: FetchInput, init: FetchInit): string {
  if (init?.method) return init.method.toUpperCase();
  // A `Request` object carries its own method when no init override is given.
  if (typeof input === 'object' && input !== null && 'method' in input) {
    return (input.method || 'GET').toUpperCase();
  }
  return 'GET';
}

/** GET/HEAD are safe to repeat; every other method may be a state change. */
function isIdempotent(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a base `fetch` so transient failures on idempotent requests are retried.
 * Defaults to the global `fetch`; the base is injectable for tests.
 */
export function createRetryingFetch(
  baseFetch: typeof fetch = fetch,
  options: RetryingFetchOptions = {},
): typeof fetch {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 150;

  return async function retryingFetch(
    input: FetchInput,
    init?: FetchInit,
  ): Promise<Response> {
    const canRetry = isIdempotent(methodOf(input, init));
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Don't start (or retry) a request the caller has already aborted — surface the
      // last real failure if there was one, otherwise a plain abort error.
      if (init?.signal?.aborted) {
        throw lastError instanceof Error
          ? lastError
          : new Error('The request was aborted before it completed.');
      }
      if (attempt > 0) await sleep(baseDelayMs * attempt);

      try {
        const response = await baseFetch(input, init);
        // A transient upstream status: try again while attempts remain, but only for
        // idempotent reads. Otherwise hand the response back unchanged.
        if (canRetry && attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        // A thrown fetch is a network-level failure. Retry idempotent reads; never a
        // write. On the final attempt (or for a write) re-throw the real error.
        if (canRetry && attempt < maxRetries) continue;
        throw error;
      }
    }

    // Unreachable: the loop above always returns or throws. Present only so the
    // function's return type holds if the loop bounds are ever changed.
    throw new Error('retryingFetch: request loop exited without a result');
  };
}
