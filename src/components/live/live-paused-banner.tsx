/**
 * Persistent PAUSED banner. Rendered app-wide when the active live session is paused,
 * so every operator on every device knows new order/capture intake is stopped. Static
 * (no client JS) — it appears/disappears as the layout re-renders after the
 * DashboardSyncProvider catches the live_sessions realtime change.
 */
export function LivePausedBanner({ sessionName }: { sessionName: string | null }) {
  return (
    <div
      role="status"
      data-testid="live-paused-banner"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-destructive/50 bg-destructive/15 px-3 py-1.5 text-center text-xs font-semibold text-destructive"
    >
      <span className="rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        Paused
      </span>
      <span>
        Live selling is paused{sessionName ? ` (${sessionName})` : ''} — new orders,
        walk-ins, and captures are on hold until it is resumed.
      </span>
    </div>
  );
}
