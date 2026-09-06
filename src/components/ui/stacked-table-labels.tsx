'use client';

import { useEffect } from 'react';

import { labelStackedTables } from '@/components/ui/stacked-table';

/**
 * Mounts once (root layout) and keeps every `.data-table--stack` labelled: runs on mount and
 * after any DOM subtree change (pagination, filters, modals — portals included, since the
 * observer watches <body>). Observes childList/subtree only, so its own data-label writes never
 * re-trigger it. Renders nothing.
 */
export function StackedTableLabels() {
  useEffect(() => {
    let raf = 0;
    const run = () => {
      raf = 0;
      labelStackedTables(document);
    };
    run();
    const observer = new MutationObserver(() => {
      if (raf) return;
      raf = window.requestAnimationFrame(run);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
