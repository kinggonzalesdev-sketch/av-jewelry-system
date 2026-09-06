import type { MetadataRoute } from 'next';

/**
 * Web app manifest (Owner 2026-09-05) — makes MineFlow installable to a phone/tablet home
 * screen and gives a future Android/iOS shell its identity, WITHOUT any offline data behaviour.
 *
 * `start_url` is the authenticated dashboard on purpose: an installed app that is not signed in
 * is sent through the normal session proxy → /sign-in, exactly like the browser. The manifest
 * never bypasses authentication.
 *
 * Icons are rasterised on demand from the ONE official logo (public/av-jewelry-logo.png) by
 * /pwa-icon/[variant] — 192 / 512 (any) and a padded 512 (maskable) — so nothing is invented.
 *
 * The service worker (public/sw.js) caches only public static assets; see
 * src/lib/pwa/cache-policy.ts for the exact allowlist. MineFlow stays an online system.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MineFlow',
    short_name: 'MineFlow',
    description:
      'Live-selling, inventory, orders, payments, and business management system.',
    lang: 'en-PH',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    // Matches the app surfaces so the splash/chrome never flashes a foreign colour.
    background_color: '#0c0f0d',
    theme_color: '#0c0f0d',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/pwa-icon/maskable-512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
