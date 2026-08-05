/**
 * Persistent TEST MODE banner. Rendered in the app layout when a test session is
 * active, so every page on every device makes it obvious that transactions are for
 * testing. Static (no client JS) — it appears/disappears when the layout re-renders
 * after the DashboardSyncProvider catches the live_test_state realtime change.
 */
export function TestModeBanner({ startedByName }: { startedByName: string | null }) {
  return (
    <div
      role="status"
      data-testid="test-mode-banner"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-center text-xs font-semibold text-amber-800 dark:text-amber-300"
    >
      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">
        Test Mode
      </span>
      <span>
        This is a test session — transactions are for testing only
        {startedByName ? ` (started by ${startedByName})` : ''}.
      </span>
    </div>
  );
}
