'use client';

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { useRouter } from 'next/navigation';

import {
  correctAttendanceClockOutAction,
  deleteAttendanceRecordAction,
  loadAttendanceSelfiesAction,
  loadReviewAttendancePageAction,
} from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow, AttendanceSelfies } from '@/lib/hr/attendance';
import {
  ATTENDANCE_PAGE_SIZES,
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  assembleDayPage,
  clockTime,
  formatWorkDate,
  matchStaffIds,
  pageCount,
  quickRange,
  type AttendanceFilters,
  type AttendancePage,
  type AttendancePageSize,
  type AttendanceQuickRange,
  type AttendanceStatusFilter,
} from '@/lib/hr/attendance-paging';
import { durationHours, formatDuration } from '@/lib/hr/format';
import type { AttendanceDay } from '@/lib/hr/sessions';
import type { ClockStaffMember } from '@/components/hr/attendance-clock';
import { Money } from '@/components/shell/privacy';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/page-primitives';
import { cn } from '@/lib/utils';

/**
 * Review Attendance (Team Management) — a review WORKSPACE, not an all-records dump (Owner
 * 2026-09-07). Server-paginated (default: last 7 days, 25/page) with status tabs, employee
 * search, quick date ranges and a mobile Filters sheet. The desktop table is scannable
 * (Employee · Date · Time · Total worked · Status · Details) with the session count and
 * overtime shown only when they apply; the full per-session breakdown, selfies, delete and
 * clock-out correction stay in Details. Reuses the same paging lib + status badge as the
 * Attendance page, but the two stay functionally separate (Attendance = clock; Review =
 * review/history). No attendance/overtime/payroll calculation or permission is changed.
 */

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold';

const RANGE_LABEL: Record<AttendanceQuickRange, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  month: 'This month',
  custom: 'Custom',
};

/** Status tabs. "Needs Review" is deliberately absent — no authoritative review/flag state is
 *  stored on a record today, and the spec forbids inventing one from duration/overtime. */
const STATUS_TABS: Array<{ key: AttendanceStatusFilter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export function ReviewAttendanceView({
  initialPage,
  roster,
  canManage = true,
}: {
  /** First page, read on the server so the table is filled on first paint. */
  initialPage: AttendancePage;
  /** Active team members — powers the employee filter + name search. */
  roster: ClockStaffMember[];
  /** Owner/Admin: shows the per-session delete + clock-out correction in Details. */
  canManage?: boolean;
}) {
  const [status, setStatus] = useState<AttendanceStatusFilter>('all');
  const [range, setRange] = useState<AttendanceQuickRange>('7d');
  const initialBounds = useMemo(() => quickRange('7d'), []);
  const [from, setFrom] = useState(initialBounds.from);
  const [to, setTo] = useState(initialBounds.to);
  const [search, setSearch] = useState('');
  const [staffId, setStaffId] = useState('');
  const [pageSize, setPageSize] = useState<AttendancePageSize>(
    initialPage.pageSize ?? DEFAULT_ATTENDANCE_PAGE_SIZE,
  );
  const [page, setPage] = useState(initialPage.page ?? 1);
  const [data, setData] = useState<AttendancePage>(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, startLoad] = useTransition();

  // Details modal + its lazy-loaded selfies (one day at a time).
  const [viewing, setViewing] = useState<AttendanceDay | null>(null);
  const [daySelfies, setDaySelfies] = useState<AttendanceSelfies>({});
  const [loadingSelfies, setLoadingSelfies] = useState(false);
  const openDay = (d: AttendanceDay) => {
    setViewing(d);
    setDaySelfies({});
    setLoadingSelfies(true);
    void loadAttendanceSelfiesAction(d.sessions.map((s) => s.row.id))
      .then((sel) => setDaySelfies(sel))
      .finally(() => setLoadingSelfies(false));
  };

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
    return { from: from || null, to: to || null, staffIds, status };
  }, [roster, debouncedSearch, staffId, from, to, status]);

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
      void loadReviewAttendancePageAction(filters, page, pageSize)
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
  const activeFilterCount = (staffId ? 1 : 0) + (range === '7d' ? 0 : 1);

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
              data-testid={`review-range-${k}`}
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
            <Label htmlFor="review-from" className="text-xs">
              From
            </Label>
            <Input
              id="review-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-9"
              data-testid="review-from"
            />
          </div>
          <div>
            <Label htmlFor="review-to" className="text-xs">
              To
            </Label>
            <Input
              id="review-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-9"
              data-testid="review-to"
            />
          </div>
        </div>
      ) : null}

      <div>
        <Label htmlFor="review-staff" className="text-xs">
          Employee
        </Label>
        <select
          id="review-staff"
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className={cn(SELECT_CLASS, 'mt-1')}
          data-testid="review-staff-filter"
        >
          <option value="">All employees</option>
          {roster.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Status tabs */}
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label="Attendance status"
      >
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={status === t.key}
            onClick={() => setStatus(t.key)}
            data-testid={`review-tab-${t.key}`}
            className={cn(
              'tap-44 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              status === t.key
                ? 'border-gold/40 bg-gold/15 text-gold-strong'
                : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar: search always visible; the rest on desktop, or a Filters sheet on phones. */}
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee…"
          aria-label="Search attendance by employee"
          data-testid="review-search"
          className="h-9 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFiltersOpen(true)}
          data-testid="review-filters-button"
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
            Apply filters
          </Button>
        }
      >
        {filterControls}
      </Modal>

      <p className="text-xs text-muted-foreground" data-testid="review-count">
        {data.total === 0
          ? 'No records'
          : `Showing ${firstShown}–${lastShown} of ${data.total} record${data.total === 1 ? '' : 's'}`}
      </p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {days.length === 0 ? (
        <EmptyState
          title={
            data.total === 0
              ? 'No attendance records found for this filter.'
              : 'No matching records'
          }
          description="Adjust the status, date range or employee to see more."
        />
      ) : (
        <div className={cn(loading && 'opacity-60 transition-opacity')}>
          {/* Desktop table — sticky header, scannable columns. */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
            <table
              className="data-table w-full min-w-[640px] text-left text-sm"
              data-testid="review-attendance"
            >
              <thead className="sticky top-0 z-10 border-b bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="col-grow px-3 py-2.5 text-left font-medium">Employee</th>
                  <th className="px-3 py-2.5 text-center font-medium">Date</th>
                  <th className="px-3 py-2.5 text-center font-medium">Time</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total worked</th>
                  <th className="px-3 py-2.5 text-center font-medium">Status</th>
                  <th className="col-actions px-3 py-2.5 text-right font-medium">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr
                    key={d.key}
                    className="border-b transition-colors last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-3 py-3 font-medium">{d.staffName ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-muted-foreground">
                      {formatWorkDate(d.workDate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-center tabular-nums">
                      {clockTime(d.firstIn)} → {d.finalOut ? clockTime(d.finalOut) : '—'}
                      <DayBadges day={d} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatDuration(d.totalHours)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <DayStatus day={d} />
                    </td>
                    <td className="col-actions px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDay(d)}
                        data-testid={`review-day-view-${d.key}`}
                        className="tap-44 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one compact card per day. */}
          <ul className="space-y-2 sm:hidden" data-testid="review-cards">
            {days.map((d) => (
              <li
                key={d.key}
                className="rounded-xl border border-border bg-card p-3"
                data-testid={`review-card-${d.key}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {d.staffName ?? '—'}
                  </p>
                  <DayStatus day={d} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatWorkDate(d.workDate)}
                </p>
                <p className="mt-2 text-sm tabular-nums">
                  {clockTime(d.firstIn)} → {d.finalOut ? clockTime(d.finalOut) : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Total worked:{' '}
                  <span className="tabular-nums text-foreground">
                    {formatDuration(d.totalHours)}
                  </span>
                </p>
                <div className="mt-1">
                  <DayBadges day={d} />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openDay(d)}
                  data-testid={`review-card-view-${d.key}`}
                  className="mt-2 min-h-11 w-full"
                >
                  Details
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="review-page-size" className="text-xs text-muted-foreground">
            Rows
          </Label>
          <select
            id="review-page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) as AttendancePageSize)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            data-testid="review-page-size"
          >
            {ATTENDANCE_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid="review-page">
            Page {page} of {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            data-testid="review-prev"
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pages || loading}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            data-testid="review-next"
          >
            Next
          </Button>
        </div>
      </div>

      {viewing ? (
        <ReviewDayModal
          day={viewing}
          selfies={daySelfies}
          loadingSelfies={loadingSelfies}
          canManage={canManage}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

/** Open vs Completed as a STATUS badge — never a word inside the Time column. */
function DayStatus({ day }: { day: AttendanceDay }) {
  return day.hasOpen ? (
    <StatusBadge label="Open" tone="gold" />
  ) : (
    <StatusBadge label="Complete" tone="success" />
  );
}

/** Small badges shown only when they apply: a multi-session count, and overtime pay. */
function DayBadges({ day }: { day: AttendanceDay }) {
  if (day.sessionCount <= 1 && !day.isOvertime) return null;
  return (
    <span className="ml-0 mt-1 flex flex-wrap items-center gap-1 sm:ml-2 sm:mt-0 sm:inline-flex">
      {day.sessionCount > 1 ? (
        <span
          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          data-testid={`review-sessions-${day.key}`}
        >
          {day.sessionCount} sessions
        </span>
      ) : null}
      {day.isOvertime ? (
        <span
          className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold-strong"
          data-testid={`review-ot-${day.key}`}
        >
          OT <Money amount={day.overtimeAmount} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * One day's work sessions for Review (§14): each session's clock in/out, duration,
 * its selfies, and the off-duty gaps shown but NOT counted, ending in the day's
 * total worked. Corrections are per session (clock-out edit / delete).
 */
function ReviewDayModal({
  day,
  selfies,
  loadingSelfies,
  canManage,
  onClose,
}: {
  day: AttendanceDay;
  selfies: AttendanceSelfies;
  loadingSelfies: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${day.staffName ?? 'Staff'} — ${formatWorkDate(day.workDate)}`}
      description={`${day.sessionCount} work session${day.sessionCount === 1 ? '' : 's'}`}
      size="lg"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-2">
        {day.sessions.map((s, i) => {
          const next = day.sessions[i + 1];
          const gapH =
            s.row.timeOut && next ? durationHours(s.row.timeOut, next.row.timeIn) : null;
          return (
            <div key={s.row.id}>
              <div className="rounded-md border border-border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Session {s.sessionNumber}
                    {s.continued ? (
                      <span className="ml-2 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold-strong">
                        Continued Duty
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm tabular-nums">
                    {formatDuration(s.durationHrs)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {clockTime(s.row.timeIn)} →{' '}
                    {s.row.timeOut ? (
                      clockTime(s.row.timeOut)
                    ) : (
                      <span className="text-gold-strong">still clocked in</span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {loadingSelfies ? (
                      <span className="text-[10px] text-muted-foreground">
                        Loading selfies…
                      </span>
                    ) : (
                      <>
                        <SelfieThumb label="In" url={selfies[s.row.id]?.inUrl ?? null} />
                        <SelfieThumb
                          label="Out"
                          url={selfies[s.row.id]?.outUrl ?? null}
                        />
                      </>
                    )}
                  </div>
                </div>
                {s.row.isOvertime ? (
                  <p className="mt-1 text-[11px] text-gold-strong">
                    Overtime (night) · <Money amount={s.row.overtimeAmount} />
                  </p>
                ) : null}
                {canManage ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ReviewRowCorrect row={s.row} />
                    <ReviewRowDelete row={s.row} />
                  </div>
                ) : null}
              </div>
              {next && gapH && gapH > 0 ? (
                <p className="py-1 text-center text-[11px] text-muted-foreground">
                  Off duty · {formatDuration(gapH)} — not counted
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Total worked</span>
          <span className="tabular-nums">{formatDuration(day.totalHours)}</span>
        </div>
      </div>
    </Modal>
  );
}

/** A clock-in or clock-out selfie: a thumbnail that also downloads when clicked. */
function SelfieThumb({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return <span className="text-[11px] text-muted-foreground">{label} —</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download
      title={`${label} selfie — click to view / download`}
      className="inline-flex flex-col items-center gap-0.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${label} selfie`}
        className="h-9 w-9 rounded object-cover ring-1 ring-border"
      />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </a>
  );
}

/** A timestamptz → the `YYYY-MM-DDTHH:mm` value a datetime-local input expects, in local time. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/**
 * Owner/Selected Admin clock-out correction (Owner 2026-09-07). Closes a forgotten OPEN
 * session — which also unblocks that staff member from clocking in again — or shortens an
 * over-long one, with a mandatory reason. It never edits the clock-IN; the database validates
 * the new time (>= clock-in, <= now) and records who/why. Payroll recomputes on the next read.
 */
function ReviewRowCorrect({ row }: { row: AttendanceRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState('');
  const [reason, setReason] = useState('');
  const [state, submit, pending] = useActionState<HrActionState, FormData>(
    correctAttendanceClockOutAction,
    EMPTY_HR_STATE,
  );

  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  const openModal = () => {
    setLocalValue(toLocalInputValue(row.timeOut ?? row.timeIn));
    setReason('');
    setOpen(true);
  };

  const formId = `review-correct-form-${row.id}`;
  const isoValue = localValue ? new Date(localValue).toISOString() : '';

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        data-testid={`review-correct-${row.id}`}
        className="tap-44 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        {row.timeOut ? 'Correct clock-out' : 'Set clock-out'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={row.timeOut ? 'Correct clock-out time' : 'Set clock-out time'}
        description="Closes or shortens this session. Clock-in is unchanged; payroll recomputes."
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={pending || !localValue || reason.trim().length === 0}
            >
              {pending ? 'Saving…' : 'Save correction'}
            </Button>
          </>
        }
      >
        <form id={formId} action={submit} className="space-y-3">
          <input type="hidden" name="recordId" value={row.id} />
          <input type="hidden" name="timeOut" value={isoValue} />
          <p className="text-sm">
            {row.staffName ?? 'This staff member'} clocked in at{' '}
            <strong>{new Date(row.timeIn).toLocaleString()}</strong>
            {row.timeOut ? (
              <>
                {' '}
                and out at <strong>{new Date(row.timeOut).toLocaleString()}</strong>.
              </>
            ) : (
              <> and has no clock-out (session still open).</>
            )}
          </p>
          <div>
            <Label htmlFor={`review-correct-time-${row.id}`} className="text-xs">
              New clock-out time
            </Label>
            <Input
              id={`review-correct-time-${row.id}`}
              type="datetime-local"
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              data-testid={`review-correct-time-${row.id}`}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor={`review-correct-reason-${row.id}`} className="text-xs">
              Reason <span className="text-destructive">*</span>
            </Label>
            <textarea
              id={`review-correct-reason-${row.id}`}
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Forgot to clock out; left at 6:00 PM per shift log."
              data-testid={`review-correct-reason-${row.id}`}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-gold"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}

/**
 * Owner/Admin permanent delete of one attendance record from the Review table.
 * Same guarded action + irreversible "type DELETE" confirmation as the Attendance
 * page — deleting here removes the record everywhere; payroll, being derived,
 * recomputes on the next read.
 */
function ReviewRowDelete({ row }: { row: AttendanceRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [state, submit, pending] = useActionState<HrActionState, FormData>(
    deleteAttendanceRecordAction,
    EMPTY_HR_STATE,
  );

  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  const formId = `review-delete-form-${row.id}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirm('');
          setOpen(true);
        }}
        data-testid={`review-delete-${row.id}`}
        className="tap-44 rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Permanently delete attendance record"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              form={formId}
              disabled={pending || confirm !== 'DELETE'}
            >
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <form id={formId} action={submit} className="space-y-3">
          <input type="hidden" name="recordId" value={row.id} />
          <p className="text-sm">
            Delete the {formatWorkDate(row.workDate)} record for{' '}
            <strong>{row.staffName ?? 'this staff member'}</strong>? Payroll totals will
            recompute without it.
          </p>
          <div>
            <Label htmlFor={`review-delete-confirm-${row.id}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`review-delete-confirm-${row.id}`}
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
