import type { MetadataRoute } from 'next';

/**
 * Web app manifest (Owner 2026-09-05) — makes MineFlow installable to a phone home screen
 * and gives the eventual Android/iOS shell its identity, WITHOUT any offline behaviour.
 *
 * Deliberately NO service worker and NO caching: MineFlow is an online operational system.
 * Caching Orders/Payments/Inventory mutations for offline replay needs a conflict-resolution
 * design of its own and is explicitly out of scope for this phase — so installing the app
 * only changes chrome/launch behaviour, never data behaviour.
 *
 * `display: 'standalone'` drops the browser UI, which is why the safe-area work in
 * layout.tsx (viewport-fit=cover) + the header/nav/modal insets had to land with it: in
 * standalone there IS no browser chrome to keep content clear of the notch.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'A.V. Jewelry — MineFlow',
    short_name: 'MineFlow',
    description: 'Internal staff operations system. Not for public or customer use.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches the app surfaces so the splash/chrome never flashes a foreign colour.
    background_color: '#0c0f0d',
    theme_color: '#0c0f0d',
    icons: [
      {
        // The same vector the browser tab uses — scales to every launcher size.
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/av-jewelry-logo.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
