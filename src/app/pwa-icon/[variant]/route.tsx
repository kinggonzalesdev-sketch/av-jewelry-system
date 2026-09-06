import { ImageResponse } from 'next/og';

import { LOGO_PNG_BASE64 } from '@/lib/pwa/logo-data';

/**
 * PWA launcher icons, rasterised from the ONE official A.V. Jewelry logo (Owner 2026-09-05).
 *
 * The repository ships a single 500×500 logo PNG and an SVG tab icon; a proper install needs
 * 192 / 512 / maskable-512 / Apple-180 PNGs. Rather than hand-drawing replacements (forbidden —
 * no rebranding), this route scales the official asset with Next's own `ImageResponse`, so no
 * image dependency is added and nothing is invented.
 *
 *   /pwa-icon/192           192×192, logo edge-to-edge          (purpose: any)
 *   /pwa-icon/512           512×512, logo edge-to-edge          (purpose: any)
 *   /pwa-icon/maskable-512  512×512, logo at 80% on brand bg    (purpose: maskable — Android
 *                           crops up to ~10% per side, so the mark sits in the safe zone)
 *   /pwa-icon/apple-180     180×180, logo at 88% on brand bg    (iOS ignores alpha, so it gets
 *                           an opaque background)
 *
 * Prerendered at build (force-static + generateStaticParams). Public and data-free; the session
 * proxy matcher excludes /pwa-icon so the browser/launcher can fetch them without a session.
 */
export const dynamic = 'force-static';

type Spec = { size: number; logo: number; background: string | null };

const SPECS: Record<string, Spec> = {
  '192': { size: 192, logo: 192, background: null },
  '512': { size: 512, logo: 512, background: null },
  'maskable-512': { size: 512, logo: 410, background: '#0c0f0d' },
  'apple-180': { size: 180, logo: 158, background: '#0c0f0d' },
};

export function generateStaticParams(): { variant: string }[] {
  return Object.keys(SPECS).map((variant) => ({ variant }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ variant: string }> },
): Promise<Response> {
  const { variant } = await context.params;
  const spec = SPECS[variant];
  if (!spec) return new Response('Not found', { status: 404 });

  const logo = `data:image/png;base64,${LOGO_PNG_BASE64}`;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: spec.background ?? 'transparent',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} width={spec.logo} height={spec.logo} alt="" />
    </div>,
    {
      width: spec.size,
      height: spec.size,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    },
  );
}
