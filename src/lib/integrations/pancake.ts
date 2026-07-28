import 'server-only';

import { AuthorizationError, requireOwner } from '@/lib/authz/guard';

/**
 * Pancake / Facebook integration — HONEST scaffolding (Bible §14.28; SOT §5).
 *
 * No live connection exists yet: it is gated on real Pancake API access
 * (credentials + plan) that the business must provide. This module NEVER fakes a
 * connected state. It reads server-only env (`PANCAKE_API_URL`, `PANCAKE_API_KEY`)
 * — secrets never reach the browser — and reports the truth:
 *   - not configured  → the credentials are not set.
 *   - configured, unverified → set, but no successful connection recorded.
 *   - connected → only after a REAL successful call to Pancake.
 *
 * When access is provided, this is where sync (buyers, conversations, orders,
 * mining) will be wired; until then the UI tells the truth.
 */

export type PancakeState = 'not_configured' | 'configured_unverified' | 'connected';

export type PancakeStatus = {
  state: PancakeState;
  detail: string;
};

function readConfig(): {
  url: string | undefined;
  key: string | undefined;
  verifyPath: string;
  configured: boolean;
} {
  // Optional integration config; read directly (not part of the required env
  // schema) so the app runs fine without it.
  const url = process.env.PANCAKE_API_URL;
  const key = process.env.PANCAKE_API_KEY;
  // Pancake (pages.fm / Pancake POS) authenticates with an `access_token` QUERY
  // parameter, not a Bearer header. The verify endpoint lists the pages the token
  // can see; `/pages` is the pages.fm public API default and is overridable for
  // Pancake POS or a different base via PANCAKE_VERIFY_PATH.
  const verifyPath = process.env.PANCAKE_VERIFY_PATH || '/pages';
  return { url, key, verifyPath, configured: Boolean(url && key) };
}

export function getPancakeStatus(): PancakeStatus {
  const { configured } = readConfig();
  if (!configured) {
    return {
      state: 'not_configured',
      detail:
        'Pancake API access is not configured. In your Pancake (pages.fm) account, generate a page Access Token, then set PANCAKE_API_URL (e.g. https://pages.fm/api/public_api/v1) and PANCAKE_API_KEY as server environment variables, and redeploy.',
    };
  }
  return {
    state: 'configured_unverified',
    detail:
      'Credentials are set, but no successful connection has been verified in this build. Use “Test connection”.',
  };
}

export type PancakeTestResult = { ok: boolean; message: string };

/**
 * Attempts a REAL connection to Pancake. Owner-only. With no credentials it
 * honestly reports "not configured" — it never pretends. When credentials exist
 * it makes an actual request and reports the actual result.
 */
export async function testPancakeConnection(): Promise<PancakeTestResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, message: cause.message };
    }
    throw cause;
  }

  const { url, key, verifyPath } = readConfig();
  if (!url || !key) {
    return {
      ok: false,
      message: 'Not configured — set PANCAKE_API_URL and PANCAKE_API_KEY first.',
    };
  }

  try {
    // pages.fm / Pancake POS: `access_token` as a query parameter. The token stays
    // server-side; only the response reaches this function.
    const base = url.replace(/\/$/, '');
    const path = verifyPath.startsWith('/') ? verifyPath : `/${verifyPath}`;
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(key)}`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      return {
        ok: false,
        message: `Pancake responded ${res.status}. Check the access token, base URL, and plan.`,
      };
    }
    // A 200 that is actually an auth failure still counts as not connected —
    // pages.fm returns { success: false } with HTTP 200 for a bad token.
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (body && body.success === false) {
      return {
        ok: false,
        message: 'Pancake rejected the access token. Check that it is a valid page token.',
      };
    }
    return { ok: true, message: 'Connected to Pancake successfully.' };
  } catch {
    return {
      ok: false,
      message: 'Could not reach Pancake. Check the API URL and network access.',
    };
  }
}

/** Count the records in a Pancake JSON response WITHOUT assuming a field name:
 *  a top-level array, or the first array-valued property of an object. */
function countRecords(body: unknown): number {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    for (const value of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return 0;
}

/**
 * Pull data from Pancake — Owner-only. This makes a REAL request and reports how
 * many records actually came back, so the connection is proven end-to-end and the
 * result appears live. It NEVER fabricates data: with no credentials it says so,
 * and it only reports what the API returned. Mapping those records into buyers /
 * conversations / orders (auto-capture) is the deliberate next step, wired once
 * the exact Pancake API fields are confirmed for the business's plan.
 */
export async function syncPancakeData(): Promise<PancakeTestResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, message: cause.message };
    throw cause;
  }

  const { url, key, verifyPath } = readConfig();
  if (!url || !key) {
    return {
      ok: false,
      message:
        'Not configured — set PANCAKE_API_URL and PANCAKE_API_KEY (and redeploy) before syncing.',
    };
  }

  try {
    const base = url.replace(/\/$/, '');
    const path = verifyPath.startsWith('/') ? verifyPath : `/${verifyPath}`;
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(key)}`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      return {
        ok: false,
        message: `Pancake responded ${res.status}. Check the access token, base URL, and plan.`,
      };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (
      body &&
      typeof body === 'object' &&
      (body as { success?: boolean }).success === false
    ) {
      return { ok: false, message: 'Pancake rejected the access token.' };
    }

    const count = countRecords(body);
    return {
      ok: true,
      message: `Synced from Pancake — ${count} record(s) returned. Auto-capturing these into buyers / conversations / orders is the next step, wired once the exact Pancake fields are confirmed for your plan.`,
    };
  } catch {
    return {
      ok: false,
      message: 'Could not reach Pancake. Check the API URL and network access.',
    };
  }
}
