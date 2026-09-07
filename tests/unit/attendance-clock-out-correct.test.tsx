import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import type { HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow } from '@/lib/hr/attendance';
import type { AttendancePage } from '@/lib/hr/attendance-paging';

/**
 * The Review Attendance clock-out correction (Owner 2026-09-07): a manager closes a forgotten
 * open session (which unblocks re-clock-in) or shortens an over-long one, with a mandatory
 * reason. The server action + RPC are the real guards; here we cover the modal wiring — the
 * submitted ISO time and reason, and that the button won't submit without both.
 */

const correctMock =
  vi.fn<(prev: HrActionState, fd: FormData) => Promise<HrActionState>>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/hr/actions', () => ({
  correctAttendanceClockOutAction: (prev: HrActionState, fd: FormData) =>
    correctMock(prev, fd),
  deleteAttendanceRecordAction: vi.fn(),
  loadAttendanceSelfiesAction: vi.fn(() => Promise.resolve({})),
  loadReviewAttendancePageAction: vi.fn(),
}));

/** The args of the most recent correctAttendanceClockOutAction call, typed. */
function lastCall(): [HrActionState, FormData] {
  return correctMock.mock.calls.at(-1) as unknown as [HrActionState, FormData];
}

// A "today" (shop-time) date so the row falls inside the default last-7-days range.
const NOW = new Date();
const shopDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: 'rec-1',
    staffProfileId: 's1',
    staffName: 'Ericka De Dios',
    workDate: shopDate(NOW),
    timeIn: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    timeOut: null,
    note: null,
    isOvertime: false,
    overtimeAmount: '0',
    ...over,
  };
}
const page = (rows: AttendanceRow[]): AttendancePage => ({
  rows,
  completion: [],
  total: rows.length,
  page: 1,
  pageSize: 25,
});
const roster = [{ id: 's1', fullName: 'Ericka De Dios', roleKey: 'staff' }];

async function openCorrect(over?: Partial<AttendanceRow>) {
  render(
    <ReviewAttendanceView initialPage={page([row(over)])} roster={roster} canManage />,
  );
  // Desktop table + mobile cards both render in jsdom → two "Details"; open the first.
  fireEvent.click(screen.getAllByRole('button', { name: /details/i })[0]!);
  const btn = await screen.findByTestId('review-correct-rec-1');
  fireEvent.click(btn);
}

beforeEach(() => {
  correctMock.mockReset();
  correctMock.mockResolvedValue({ error: null, success: 'Clock-out corrected.' });
});

describe('Review Attendance — clock-out correction', () => {
  it('an OPEN session offers "Set clock-out" and defaults the time to the clock-in', async () => {
    await openCorrect({ timeOut: null });
    expect(screen.getByRole('button', { name: /set clock-out/i })).toBeInTheDocument();
    const input = screen.getByTestId<HTMLInputElement>('review-correct-time-rec-1');
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('a COMPLETED session says "Correct clock-out"', async () => {
    await openCorrect({ timeOut: new Date(NOW.getTime() - 3_600_000).toISOString() });
    expect(
      screen.getByRole('button', { name: /correct clock-out/i }),
    ).toBeInTheDocument();
  });

  it('will not submit without a reason (Save disabled until one is typed)', async () => {
    await openCorrect();
    const save = screen.getByRole('button', { name: /save correction/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByTestId('review-correct-reason-rec-1'), {
      target: { value: 'Forgot to clock out; left 6 PM.' },
    });
    expect(save).toBeEnabled();
  });

  it('submits the record id, an ISO clock-out and the reason', async () => {
    await openCorrect();
    fireEvent.change(screen.getByTestId('review-correct-time-rec-1'), {
      target: { value: '2026-08-13T18:00' },
    });
    fireEvent.change(screen.getByTestId('review-correct-reason-rec-1'), {
      target: { value: 'Left at 6 PM per shift log.' },
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /save correction/i }));
    });
    await waitFor(() => expect(correctMock).toHaveBeenCalled());
    const [, fd] = lastCall();
    expect(fd.get('recordId')).toBe('rec-1');
    expect(fd.get('reason')).toBe('Left at 6 PM per shift log.');
    const raw = fd.get('timeOut');
    const iso = typeof raw === 'string' ? raw : '';
    expect(iso).not.toBe('');
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('is hidden when the viewer cannot manage', async () => {
    render(
      <ReviewAttendanceView
        initialPage={page([row()])}
        roster={roster}
        canManage={false}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /details/i })[0]!);
    const modal = await screen.findByRole('dialog');
    expect(within(modal).queryByTestId('review-correct-rec-1')).not.toBeInTheDocument();
  });
});
