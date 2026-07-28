import { LoadingState } from '@/components/states/loading-state';

/**
 * Route-group loading fallback for every authenticated page that does not define
 * its own loading.tsx. Presentational only — no data, no auth — so navigation
 * streams this instantly instead of freezing until the server responds. Pages
 * with a more specific skeleton (e.g. dashboard, orders) still use theirs.
 */
export default function AppLoading() {
  return <LoadingState label="Loading…" />;
}
