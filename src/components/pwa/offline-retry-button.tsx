'use client';

import { Button } from '@/components/ui/button';

/** Retry = reload; the service worker will reach the network again once it is back. */
export function OfflineRetryButton() {
  return (
    <Button
      type="button"
      onClick={() => window.location.reload()}
      data-testid="offline-retry"
    >
      Retry
    </Button>
  );
}
