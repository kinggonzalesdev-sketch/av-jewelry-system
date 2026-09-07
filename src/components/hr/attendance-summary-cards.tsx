import type { AttendanceTodaySummary } from '@/lib/hr/attendance-paging';

/**
 * Compact team-attendance summary (Owner/reviewers only) — Present Today, Clocked In Now,
 * Completed Today. Derived entirely from data the page already reads; there is deliberately no
 * "Needs attention" card because no authoritative review/flag state is stored on a record yet.
 * A member who may see only their own attendance never receives these team totals.
 */
export function AttendanceSummaryCards({ summary }: { summary: AttendanceTodaySummary }) {
  const cards: Array<{ label: string; value: number; testId: string }> = [
    { label: 'Present today', value: summary.presentToday, testId: 'summary-present' },
    {
      label: 'Clocked in now',
      value: summary.clockedInNow,
      testId: 'summary-clocked-in',
    },
    {
      label: 'Completed today',
      value: summary.completedToday,
      testId: 'summary-completed',
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="attendance-summary">
      {cards.map((c) => (
        <div
          key={c.testId}
          className="rounded-xl border border-border bg-card px-3 py-2.5"
          data-testid={c.testId}
        >
          <p className="text-xl font-semibold tabular-nums text-foreground">{c.value}</p>
          <p className="text-[11px] leading-tight text-muted-foreground">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
