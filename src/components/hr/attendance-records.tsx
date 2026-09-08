'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { loadAttendancePageAction } from '@/lib/hr/actions';
import type { AttendanceRow } from '@/lib/hr/attendance';
import {
  ATTENDANCE_PAGE_SIZES,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  assembleDayPage,
  clockTime,
  formatWorkDate,
  matchStaffIds,
  pageCount,
  quickRange,
  shopToday,
  type AttendanceFilters,
  type AttendancePage,
  type AttendancePageSize,
  type AttendanceQuickRange,
  type AttendanceStatusFilter,
} from '@/lib/hr/attendance-paging';
import { formatDuration } from '@/lib/hr/format';
import type { AttendanceDay } from '@/lib/hr/sessions';
import type { ClockStaffMember } from '@/components/hr/attendance-clock';
import { AttendanceDayDetails } from '@/components/hr/attendance-day-details';
import { EmptyState } from '@/components/states/empty-state';
import { StatusBadge } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';

/**
 * Attendance records (Owner 2026-09-06) — a filtered, SERVER-PAGINATED history.
 *
 * What changed and why: the page used to render the newest 100 sessions with no filters, so
 * older history was unreachable and every render carried the whole list. Now the date range,
 * staff and status filters are SQL `where` clauses and only one page of rows is read.
 *
 * What did NOT change: sessions, totals and overtime still come from `groupAttendanceDays`
 * (the same pure helper payroll's SQL mirrors), and nothing here writes to a record. "Open" is
 * a STATUS, not a fake clock-out time: an open day shows Final out "—" with an Open badge.
 */

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

const RANGE_LABEL: Record<AttendanceQuickRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  month: 'This month',
  custom: 'Custom',
};

export function AttendanceRecords({
  initialPage,
  roster,
  canManage,
  isOwner,
  canFilterStaff,
  defaultRange = '7d',
}: {
  /** The first page, read on the server so the table is filled on first paint. */
  initialPage: AttendancePage;
  /** Active team members — powers the staff filter (name search matches these). */
  roster: ClockStaffMember[];
  canManage: boolean;
  isOwner: boolean;
  /** Owner/reviewers can filter by team member; a member who only sees their own cannot. */
  canFilterStaff: boolean;
  /** Which quick range the server pre-loaded (kept in sync with the page). */
  defaultRange?: AttendanceQuickRange;
}) {
  const [range, setRange] = useState<AttendanceQuickRange>(defaultRange);
  const initialBounds = useMemo(
    () => (defaultRange === 'custom' ? null : quickRange(defaultRange)),
    [defaultRange],
  );
  const [from, setFrom] = useState(initialBounds?.from ?? '');
  const [to, setTo] = useState(initialBounds?.to ?? '');
  const [search, setSearch] = useState('');
  const [staffId, setStaffId] = useState('');
  const [status, setStatus] = useState<AttendanceStatusFilter>('all');
  const [pageSize, setPageSize] = useState<AttendancePageSize>(
    initialPage.pageSize ?? DEFAULT_ATTENDANCE_PAGE_SIZE,
  );
  const [page, setPage] = useState(initialPage.page ?? 1);
  const [data, setData] = useState<AttendancePage>(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewing, setViewing] = useState<AttendanceDay | null>(null);
  const [loading, startLoad] = useTransition();

  // Debounce the name search so typing does not fire a query per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const filters = useMemo<AttendanceFilters>(() => {
    const searched = matchStaffIds(roster, debouncedSearch);
    const picked = staffId ? [staffId] : null;
    const staffIds =
      searched && picked
        ? searched.filter((id) => picked.includes(id))
        : (searched ?? picked);
    return {
      from: from || null,
      to: to || null,
      staffIds,
      status,
    };
  }, [roster, debouncedSearch, staffId, from, to, status]);

  // Reset to page 1 whenever the filters change (never leave the reader on a page that no
  // longer exists), then load. The first render reuses the server's page — no double fetch.
  const firstRender = useRef(true);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    if (firstRender.current) return;
    setPage(1);
  }, [filterKey, pageSize]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    startLoad(() => {
      void loadAttendancePageAction(filters, page, pageSize)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) setError('Could not load attendance records. Please retry.');
        });
    });
    return () => {
      cancelled = true;
    };
  }, [filterKey, page, pageSize, filters]);

  const days = useMemo(
    () => assembleDayPage(data.rows, data.completion, filters),
    [data, filters],
  );
  const pages = pageCount(data.total, pageSize);
  const firstShown = data.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, data.total);

  const applyRange = (next: AttendanceQuickRange) => {
    setRange(next);
    if (next === 'custom') return;
    const b = quickRange(next);
    setFrom(b.from);
    setTo(b.to);
  };

  const activeFilterCount =
    (status === 'all' ? 0 : 1) + (staffId ? 1 : 0) + (range === '7d' ? 0 : 1);

  const filterControls = (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Date range</p>
        <div className="flex flex-wrap gap-1.5">
          {(['today', '7d', 'month', 'custom'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => applyRange(k)}
              aria-pressed={range === k}
              data-testid={`attendance-range-${k}`}
              className={cn(
                'tap-44 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                range === k
                  ? 'border-gold/40 bg-gold/15 text-gold-strong'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {range === 'custom' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="att-from" className="text-xs">
              From
            </Label>
            <Input
              id="att-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-9"
              data-testid="attendance-from"
            />
          </div>
          <div>
            <Label htmlFor="att-to" className="text-xs">
              To
            </Label>
            <Input
              id="att-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-9"
              data-testid="attendance-to"
            />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {canFilterStaff ? (
          <div>
            <Label htmlFor="att-staff" className="text-xs">
              Team member
            </Label>
            <select
              id="att-staff"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className={cn(SELECT_CLASS, 'mt-1')}
              data-testid="attendance-staff-filter"
            >
              <option value="">All staff</option>
              {roster.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <Label htmlFor="att-status" className="text-xs">
            Status
          </Label>
          <select
            id="att-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatusFilter)}
            className={cn(SELECT_CLASS, 'mt-1')}
            data-testid="attendance-status-filter"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Attendance records</CardTitle>
          <p className="text-xs text-muted-foreground" data-testid="attendance-count">
            {data.total === 0
              ? 'No sessions'
              : `${firstShown}–${lastShown} of ${data.total} session${data.total === 1 ? '' : 's'}`}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Toolbar. Search stays visible on phones; the rest moves into a Filters sheet. */}
        <div className="flex items-center gap-2">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team member…"
            aria-label="Search attendance by team member"
            data-testid="attendance-search"
            className="h-9 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFiltersOpen(true)}
            data-testid="attendance-filters-button"
            className="shrink-0 sm:hidden"
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
        </div>
        <div className="hidden sm:block">{filterControls}</div>
        <Modal
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title="Filters"
          size="sm"
          footer={
            <Button type="button" onClick={() => setFiltersOpen(false)}>
              Done
            </Button>
          }
        >
          {filterControls}
        </Modal>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {days.length === 0 ? (
          <EmptyState
            title={
              data.total === 0 ? 'No attendance in this range' : 'No matching records'
            }
            description="Adjust the date range or filters to see more."
          />
        ) : (
          <div className={cn(loading && 'opacity-60 transition-opacity')}>
            {/* Desktop: a compact table. Sessions is no longer a column — a day with more
                than one session shows a small marker beside the date instead. */}
            <div className="hidden overflow-x-auto sm:block">
              <table
                className="data-table w-full min-w-[680px] text-left text-sm"
                data-testid="attendance-days"
              >
                <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="col-grow px-3 py-2.5 text-left font-medium">Staff</th>
                    <th className="px-3 py-2.5 text-center font-medium">Date</th>
                    <th className="px-3 py-2.5 text-center font-medium">First in</th>
                    <th className="px-3 py-2.5 text-center font-medium">Final out</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total worked</th>
                    <th className="px-3 py-2.5 text-center font-medium">Status</th>
                    <th className="col-actions px-3 py-2.5 text-right font-medium">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.key} className="border-b last:border-0">
                      <td className="px-3 py-2.5">{d.staffName ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        {formatWorkDate(d.workDate)}
                        {d.sessionCount > 1 ? (
                          <span
                            className="ml-1.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            title={`${d.sessionCount} work sessions`}
                            data-testid={`attendance-sessions-${d.key}`}
                          >
                            {d.sessionCount}×
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        {clockTime(d.firstIn)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        {d.finalOut ? clockTime(d.finalOut) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatDuration(d.totalHours)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">
                        <DayStatus day={d} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setViewing(d)}
                          data-testid={`attendance-day-view-${d.key}`}
                          className="tap-44 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phones: one compact card per day — not the desktop table squeezed down. */}
            <ul className="space-y-2 sm:hidden" data-testid="attendance-cards">
              {days.map((d) => (
                <li
                  key={d.key}
                  className="rounded-xl border border-border bg-card p-3"
                  data-testid={`attendance-card-${d.key}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {d.staffName ?? '—'}
                    </p>
                    <DayStatus day={d} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatWorkDate(d.workDate)}
                    {d.sessionCount > 1 ? ` · ${d.sessionCount} sessions` : ''}
                  </p>
                  <p className="mt-2 text-sm tabular-nums">
                    {clockTime(d.firstIn)} → {d.finalOut ? clockTime(d.finalOut) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.hasOpen ? 'Completed so far' : 'Total'}:{' '}
                    <span className="tabular-nums text-foreground">
                      {formatDuration(d.totalHours)}
                    </span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setViewing(d)}
                    data-testid={`attendance-card-view-${d.key}`}
                    className="mt-2 min-h-11 w-full"
                  >
                    View details
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="att-page-size" className="text-xs text-muted-foreground">
              Rows
            </Label>
            <select
              id="att-page-size"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as AttendancePageSize)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              data-testid="attendance-page-size"
            >
              {ATTENDANCE_PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" data-testid="attendance-page">
              Page {page} of {pages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="attendance-prev"
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pages || loading}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              data-testid="attendance-next"
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>

      {viewing ? (
        <AttendanceDayDetails
          day={viewing}
          canManage={canManage}
          isOwner={isOwner}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </Card>
  );
}

/** Open vs Completed as a STATUS — never a word in the Final out time column. */
function DayStatus({ day }: { day: AttendanceDay }) {
  return day.hasOpen ? (
    <StatusBadge label="Clocked in" tone="gold" />
  ) : (
    <StatusBadge label="Completed" tone="success" />
  );
}

/** Today's shop date, exported for callers that need the same definition. */
export { shopToday };
export type { AttendanceRow };
