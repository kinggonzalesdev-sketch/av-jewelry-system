import type { Metadata } from 'next';

import { OfflineRetryButton } from '@/components/pwa/offline-retry-button';

/**
 * The PWA offline fallback (Owner 2026-09-05). Precached by the service worker and served ONLY
 * when a page navigation fails because the device is offline. Deliberately contains no business
 * data of any kind — MineFlow is an online system and never shows stale records offline.
 * Public (session proxy excludes it) and static, so the worker can fetch it at install time.
 */
export const dynamic = 'force-static';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10 text-center text-foreground">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold text-lg font-bold text-black">
        AV
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">You&apos;re offline</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        MineFlow requires an internet connection to access live business records.
      </p>
      <div className="mt-6">
        <OfflineRetryButton />
      </div>
    </main>
  );
}
