/**
 * Service-worker cache policy — the ONE statement of what the worker may store (Owner 2026-09-05).
 *
 * MineFlow is a live operational system holding customer, order, payment, inventory, payroll and
 * Messenger data. The worker therefore caches ONLY public, data-free static assets, and every
 * other request goes straight to the network untouched. There is no offline data and no
 * transactional replay — by design, not omission.
 *
 * `public/sw.js` cannot import this module (a service worker is a plain script), so it carries a
 * verbatim copy of `SW_STATIC_ALLOW` and `SW_PRECACHE`; tests/unit/pwa-sw-sync.test.ts fails the
 * build if the two ever drift.
 */

/** Same-origin paths the worker may serve cache-first. Hashed build assets + brand images only. */
export const SW_STATIC_ALLOW: readonly RegExp[] = [
  /^\/_next\/static\//,
  /^\/icon\.svg$/,
  /^\/pwa-icon\//,
  /^\/manifest\.webmanifest$/,
  /^\/av-jewelry-(?:logo|hero|signinbg)\.png$/,
];

/** Fetched into the cache at install so the offline fallback can render with no network. */
export const SW_PRECACHE: readonly string[] = [
  '/offline',
  '/icon.svg',
  '/pwa-icon/192',
  '/pwa-icon/512',
  '/pwa-icon/maskable-512',
  '/manifest.webmanifest',
];

export type CacheDecision =
  /** Serve from cache, fill on miss. Static, public, data-free only. */
  | 'cache-first'
  /** HTML navigation: always the network; if it fails, the data-free /offline page. Never stored. */
  | 'network-or-offline'
  /** The worker does not intervene at all — the browser talks to the network directly. */
  | 'bypass';

/**
 * Decide how the worker treats one request. Pure, so it is unit-tested against every class of
 * private endpoint (Supabase REST/Auth/Storage/Realtime, /api/*, server-action POSTs, /m/ share
 * pages, authenticated HTML) to prove none of them can ever be cached.
 */
export function decideCache(input: {
  method: string;
  url: string;
  /** Request.mode — 'navigate' for a page load. */
  mode?: string | undefined;
  /** The worker's own origin (self.location.origin). */
  pageOrigin: string;
}): CacheDecision {
  if (input.method.toUpperCase() !== 'GET') return 'bypass';
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return 'bypass';
  }
  // Supabase (REST / Auth / Storage / Realtime), Pancake, fonts — never touched.
  if (url.origin !== input.pageOrigin) return 'bypass';
  // Page HTML — authenticated or not — is never cached.
  if (input.mode === 'navigate') return 'network-or-offline';
  if (SW_STATIC_ALLOW.some((re) => re.test(url.pathname))) return 'cache-first';
  // /api/*, /m/*, signed storage URLs, RSC payloads, everything else.
  return 'bypass';
}
