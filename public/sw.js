/* MineFlow service worker (Owner 2026-09-05).
 *
 * Deliberately minimal and dependency-free. It does exactly three things:
 *   1. precaches the data-free /offline page + launcher icons at install;
 *   2. serves hashed build assets and brand images cache-first;
 *   3. for a page navigation, tries the network and shows /offline only if that fails.
 *
 * It NEVER caches page HTML, /api/*, server actions, Supabase (REST/Auth/Storage/Realtime),
 * /m/ share pages, signed storage URLs or any non-GET request — those are bypassed entirely, so
 * customer, order, payment, inventory, payroll and Messenger data can never sit in a SW cache.
 *
 * STATIC_ALLOW and PRECACHE below are a verbatim copy of src/lib/pwa/cache-policy.ts; the unit
 * test pwa-sw-sync asserts they match, so the policy has one source of truth.
 *
 * Versioning: the page registers this file as /sw.js?v=<build commit>. A new deploy → new URL →
 * the browser installs it as a NEW worker, caches are keyed by that version, and the old
 * version's caches are deleted on activate. The worker never calls skipWaiting on its own; the
 * app asks (SKIP_WAITING) only after the operator clicks "Update now" with nothing unsaved.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `mineflow-static-${VERSION}`;

const STATIC_ALLOW = [
  /^\/_next\/static\//,
  /^\/icon\.svg$/,
  /^\/pwa-icon\//,
  /^\/manifest\.webmanifest$/,
  /^\/av-jewelry-(?:logo|hero|signinbg)\.png$/,
];

const PRECACHE = [
  '/offline',
  '/icon.svg',
  '/pwa-icon/192',
  '/pwa-icon/512',
  '/pwa-icon/maskable-512',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Precache best-effort: one missing icon must not block the offline page.
      Promise.all(PRECACHE.map((path) => cache.add(path).catch(() => undefined))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('mineflow-static-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PUT/PATCH/DELETE (server actions, uploads): untouched
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // Supabase / Pancake / fonts: untouched

  // Page HTML: network, never cached; the data-free /offline page only when the network fails.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches
          .match('/offline')
          .then((r) => r || new Response('Offline', { status: 503 })),
      ),
    );
    return;
  }

  if (!STATIC_ALLOW.some((re) => re.test(url.pathname))) return; // everything else: untouched

  // Static, public, data-free: cache-first, fill on miss.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
