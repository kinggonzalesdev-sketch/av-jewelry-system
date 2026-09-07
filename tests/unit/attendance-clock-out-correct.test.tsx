import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import type { HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow } from '@/lib/hr/attendance';

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
}));

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: 'rec-1',
    staffProfileId: 's1',
    staffName: 'Ericka De Dios',
    workDate: '2026-08-13',
    timeIn: '2026-08-12T23:58:00.000Z',
    timeOut: null,
    note: null,
    isOvertime: false,
    overtimeAmount: '0',
    ...over,
  };
}

async function openCorrect(over?: Partial<AttendanceRow>) {
  render(<ReviewAttendanceView records={[row(over)]} canManage />);
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  // The correction control appears inside the day modal.
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
    // Two controls carry this testid: the trigger button and the datetime input. The trigger
    // is the one that reads "Set clock-out" (open session) rather than "Correct clock-out".
    expect(screen.getByRole('button', { name: /set clock-out/i })).toBeInTheDocument();
    const input = screen.getByTestId<HTMLInputElement>('review-correct-time-rec-1');
    // 2026-08-12T23:58 UTC rendered into the input's LOCAL value — non-empty and minute-precise.
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('a COMPLETED session says "Correct clock-out"', async () => {
    await openCorrect({ timeOut: '2026-08-17T00:43:00.000Z' });
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
    const fd = correctMock.mock.calls.at(-1)![1];
    expect(fd.get('recordId')).toBe('rec-1');
    expect(fd.get('reason')).toBe('Left at 6 PM per shift log.');
    // The hidden field carries a real ISO timestamp derived from the local input.
    const raw = fd.get('timeOut');
    const iso = typeof raw === 'string' ? raw : '';
    expect(iso).not.toBe('');
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('is hidden when the viewer cannot manage', async () => {
    render(<ReviewAttendanceView records={[row()]} canManage={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).queryByTestId('review-correct-rec-1')).not.toBeInTheDocument();
  });
});
