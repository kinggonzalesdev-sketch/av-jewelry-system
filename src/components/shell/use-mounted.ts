'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * `true` once mounted in the browser, `false` during SSR and the hydration pass.
 *
 * Uses `useSyncExternalStore` (not a state-updating effect) so client-only values
 * — matchMedia, navigator, localStorage — can be read without a hydration
 * mismatch and without the cascading-render pattern the lint rules forbid.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client
    () => false, // server / hydration
  );
}
