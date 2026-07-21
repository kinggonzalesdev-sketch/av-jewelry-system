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
  configured: boolean;
} {
  // Optional integration config; read directly (not part of the required env
  // schema) so the app runs fine without it.
  const url = process.env.PANCAKE_API_URL;
  const key = process.env.PANCAKE_API_KEY;
  return { url, key, configured: Boolean(url && key) };
}

export function getPancakeStatus(): PancakeStatus {
  const { configured } = readConfig();
  if (!configured) {
    return {
      state: 'not_configured',
      detail:
        'Pancake API access is not configured. Provide the Pancake page access token and API URL (as server env: PANCAKE_API_URL, PANCAKE_API_KEY) to enable sync.',
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

  const { url, key } = readConfig();
  if (!url || !key) {
    return {
      ok: false,
      message: 'Not configured — set PANCAKE_API_URL and PANCAKE_API_KEY first.',
    };
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/me`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok
      ? { ok: true, message: 'Connected to Pancake successfully.' }
      : {
          ok: false,
          message: `Pancake responded ${res.status}. Check the credentials and plan.`,
        };
  } catch {
    return {
      ok: false,
      message: 'Could not reach Pancake. Check the API URL and network access.',
    };
  }
}
