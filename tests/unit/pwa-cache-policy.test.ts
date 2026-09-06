import { describe, expect, it } from 'vitest';

import { decideCache, SW_PRECACHE, SW_STATIC_ALLOW } from '@/lib/pwa/cache-policy';

/**
 * SECURITY ACCEPTANCE for the service worker (Owner 2026-09-05): no private endpoint can ever be
 * cached. Every class of sensitive request must resolve to 'bypass' (worker does nothing) or,
 * for page HTML, 'network-or-offline' (never stored). Only public static assets are cache-first.
 */
const ORIGIN = 'https://avjewelry.online';
const d = (url: string, method = 'GET', mode?: string) =>
  decideCache({ method, url, mode, pageOrigin: ORIGIN });

describe('service-worker cache policy — private data is never cacheable', () => {
  it('bypasses every Supabase endpoint (REST, Auth, Storage, Realtime)', () => {
    for (const u of [
      'https://eqfddwxsmzzojuasffjx.supabase.co/rest/v1/customers?select=*',
      'https://eqfddwxsmzzojuasffjx.supabase.co/rest/v1/rpc/orders_page',
      'https://eqfddwxsmzzojuasffjx.supabase.co/auth/v1/token?grant_type=refresh_token',
      'https://eqfddwxsmzzojuasffjx.supabase.co/storage/v1/object/sign/attachments/captures/x.jpg',
      'https://eqfddwxsmzzojuasffjx.supabase.co/realtime/v1/websocket',
    ]) {
      expect(d(u)).toBe('bypass');
    }
  });

  it('bypasses Pancake / Facebook and any other third-party origin', () => {
    expect(d('https://pages.fm/api/public_api/v1/pages')).toBe('bypass');
    expect(d('https://graph.facebook.com/v19.0/me')).toBe('bypass');
  });

  it('bypasses every /api route and the /m share page (same origin, private)', () => {
    for (const p of [
      '/api/mobile/print/capture-claim',
      '/api/integrations/pancake/conversations',
      '/api/export/all',
      '/api/layaway/export',
      '/api/webhooks/pancake',
      '/api/cron/capture-autosend',
      '/m/opaque-token',
    ]) {
      expect(d(`${ORIGIN}${p}`)).toBe('bypass');
    }
  });

  it('bypasses every non-GET (server actions, uploads, mutations)', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(d(`${ORIGIN}/orders`, m)).toBe('bypass');
      expect(d(`${ORIGIN}/_next/static/chunks/app.js`, m)).toBe('bypass');
    }
  });

  it('never caches page HTML — authenticated or public — only network-or-offline', () => {
    for (const p of [
      '/dashboard',
      '/orders',
      '/orders/payments',
      '/customers',
      '/admin/payroll',
      '/cash/daily',
      '/reports',
      '/live',
      '/sign-in',
      '/',
    ]) {
      expect(d(`${ORIGIN}${p}`, 'GET', 'navigate')).toBe('network-or-offline');
    }
  });

  it('bypasses RSC payloads / data fetches for app pages (GET, not a navigation)', () => {
    expect(d(`${ORIGIN}/orders?_rsc=abc`)).toBe('bypass');
    expect(d(`${ORIGIN}/customers`)).toBe('bypass');
  });

  it('serves only hashed build assets and brand images cache-first', () => {
    expect(d(`${ORIGIN}/_next/static/chunks/main-abc123.js`)).toBe('cache-first');
    expect(d(`${ORIGIN}/_next/static/css/app.css`)).toBe('cache-first');
    expect(d(`${ORIGIN}/icon.svg`)).toBe('cache-first');
    expect(d(`${ORIGIN}/pwa-icon/192`)).toBe('cache-first');
    expect(d(`${ORIGIN}/manifest.webmanifest`)).toBe('cache-first');
    expect(d(`${ORIGIN}/av-jewelry-logo.png`)).toBe('cache-first');
    // A look-alike path outside the allowlist is still bypassed.
    expect(d(`${ORIGIN}/uploads/av-jewelry-logo.png`)).toBe('bypass');
    expect(d(`${ORIGIN}/_next/image?url=x`)).toBe('bypass');
  });

  it('precache list contains only public, data-free paths', () => {
    for (const p of SW_PRECACHE) {
      expect(p.startsWith('/api')).toBe(false);
      expect(p.startsWith('/m/')).toBe(false);
      expect(p === '/offline' || SW_STATIC_ALLOW.some((re) => re.test(p))).toBe(true);
    }
  });

  it('bypasses malformed URLs instead of guessing', () => {
    expect(d('not a url')).toBe('bypass');
  });
});
