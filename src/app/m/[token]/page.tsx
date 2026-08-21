import 'server-only';

import type { Metadata } from 'next';

import { resolveSharedScreenshotUrl } from '@/lib/capture/share-link-resolve';

/**
 * PUBLIC secure screenshot page — /m/{opaque_token} (Owner 2026-08-21, Route B). A first-time
 * miner opens this from the Pancake Private Reply TEXT. The raw token is hashed and looked up
 * server-side (service role) via resolve_capture_share_link; a valid, unexpired, un-revoked link
 * yields ONLY that capture's screenshot behind a short-lived signed Storage URL. No customer /
 * order / PSID / comment id is ever in the URL or the page; the private bucket stays private, and
 * no permanent storage URL is exposed. noindex/nofollow. Simple: A.V. Jewelry + the screenshot, or
 * an "unavailable" state.
 */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SharedScreenshotPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const imageUrl = await resolveSharedScreenshotUrl(token);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0B0B0B',
        color: '#F5EFE0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div
          style={{
            color: '#C9A227',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 20,
          }}
        >
          A.V. JEWELRY
        </div>
        {imageUrl ? (
          <>
            <p style={{ color: '#8C7C55', marginBottom: 16 }}>
              Here&apos;s the screenshot of your mined item ✨
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Your mined item"
              style={{
                maxWidth: '100%',
                borderRadius: 12,
                boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
              }}
            />
          </>
        ) : (
          <p style={{ color: '#8C7C55', fontSize: 16, lineHeight: 1.6 }}>
            This screenshot link is no longer available — it may have expired or been revoked.
            Please message the A.V. Jewelry page and we&apos;ll gladly resend it. 💛
          </p>
        )}
      </div>
    </main>
  );
}
