import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';

describe('web app manifest (Owner spec 2026-09-05)', () => {
  const m = manifest();

  it('carries the approved identity', () => {
    expect(m.name).toBe('MineFlow');
    expect(m.short_name).toBe('MineFlow');
    expect(m.description).toBe(
      'Live-selling, inventory, orders, payments, and business management system.',
    );
    expect(m.lang).toBe('en-PH');
    expect(m.display).toBe('standalone');
    expect(m.orientation).toBe('any');
  });

  it('starts on the authenticated dashboard under the normal session proxy (never bypasses auth)', () => {
    expect(m.start_url).toBe('/dashboard');
    expect(m.scope).toBe('/');
    // Nothing in the manifest points at an API or a share link.
    for (const icon of m.icons ?? []) {
      expect(icon.src.startsWith('/pwa-icon/')).toBe(true);
    }
  });

  it('declares 192, 512 and a maskable 512 PNG rasterised from the official logo', () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`)).toEqual([
      '192x192:any',
      '512x512:any',
      '512x512:maskable',
    ]);
    for (const icon of icons) expect(icon.type).toBe('image/png');
  });

  it('uses the brand surface colours', () => {
    expect(m.theme_color).toBe('#0c0f0d');
    expect(m.background_color).toBe('#0c0f0d');
  });
});
