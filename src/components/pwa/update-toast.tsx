'use client';

import { useState } from 'react';

import { usePwa } from '@/components/pwa/pwa-provider';
import { useUnsavedChangesRegistry } from '@/components/pwa/unsaved-changes';
import { Button } from '@/components/ui/button';

/**
 * "Update available" (Owner 2026-09-05). Shown only when a newer service worker is waiting.
 * It never reloads on its own: "Update now" asks the worker to take over, and if anything is
 * registered as unsaved (a critical dialog, an unsaved capture edit…) it first says so and
 * requires an explicit second confirmation — so a payment entry is never lost to a deploy.
 * Sits above the mobile bottom nav (safe-area aware); bottom-right on desktop.
 */
export function UpdateToast() {
  const { updateReady, applyUpdate } = usePwa();
  const { hasUnsavedChanges } = useUnsavedChangesRegistry();
  const [dismissed, setDismissed] = useState(false);
  const [confirmDirty, setConfirmDirty] = useState(false);

  if (!updateReady || dismissed) return null;

  const onUpdate = () => {
    if (hasUnsavedChanges() && !confirmDirty) {
      setConfirmDirty(true);
      return;
    }
    applyUpdate();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-toast"
      className="fixed inset-x-3 z-[60] rounded-xl border border-border bg-card p-3 shadow-xl lg:inset-x-auto lg:right-4 lg:w-80"
      style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
    >
      <p className="text-sm font-semibold text-foreground">Update available</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {confirmDirty
          ? 'You have an entry in progress. Finish or cancel it first — updating now will discard it.'
          : 'A newer version of A.V. Jewelry is ready.'}
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setDismissed(true)}
          data-testid="pwa-update-later"
        >
          Later
        </Button>
        <Button
          type="button"
          size="sm"
          variant={confirmDirty ? 'destructive' : 'default'}
          onClick={onUpdate}
          data-testid="pwa-update-now"
        >
          {confirmDirty ? 'Update anyway' : 'Update now'}
        </Button>
      </div>
    </div>
  );
}
