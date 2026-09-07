import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import type { AttendanceRow } from '@/lib/hr/attendance';
import type { AttendanceFilters, AttendancePage } from '@/lib/hr/attendance-paging';

/**
 * The refined Review Attendance workspace (Owner 2026-09-07): status tabs, server pagination,
 * a scannable table with conditional session/overtime badges, and Open-as-status. The paging
 * maths live in attendance-paging.test.ts; this covers the wiring.
 */

const loadMock = vi.fn<(...a: unknown[]) => Promise<AttendancePage>>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/hr/actions', () => ({
  loadReviewAttendancePageAction: (...a: unknown[]) => loadMock(...a),
  correctAttendanceClockOutAction: vi.fn(),
  deleteAttendanceRecordAction: vi.fn(),
  loadAttendanceSelfiesAction: vi.fn(() => Promise.resolve({})),
}));

function lastCall(): [AttendanceFilters, number, number] {
  return loadMock.mock.calls.at(-1) as unknown as [AttendanceFilters, number, number];
}

const NOW = new Date();
const shopDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const at = (hoursAgo: number) =>
  new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: crypto.randomUUID(),
    staffProfileId: 's1',
    staffName: 'Lalyn Penaranda',
    workDate: shopDate(NOW),
    timeIn: at(9),
    timeOut: at(1),
    note: null,
    isOvertime: false,
    overtimeAmount: '0',
    ...over,
  };
}
function page(rows: AttendanceRow[], over: Partial<AttendancePage> = {}): AttendancePage {
  return { rows, completion: [], total: rows.length, page: 1, pageSize: 25, ...over };
}
const roster = [
  { id: 's1', fullName: 'Lalyn Penaranda', roleKey: 'staff' },
  { id: 's2', fullName: 'Grace Villanueva', roleKey: 'staff' },
];
const render1 = (initialPage: AttendancePage) =>
  render(<ReviewAttendanceView initialPage={initialPage} roster={roster} canManage />);

beforeEach(() => {
  loadMock.mockReset();
  loadMock.mockResolvedValue(page([]));
});

describe('ReviewAttendanceView workspace', () => {
  it('renders the server page without an extra fetch and shows the count', () => {
    render1(page([row()], { total: 1 }));
    expect(screen.getByTestId('review-count')).toHaveTextContent(
      'Showing 1–1 of 1 record',
    );
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('combines clock in→out in one Time column and shows Open as a status', () => {
    render1(page([row({ staffProfileId: 's2', staffName: 'Grace', timeOut: null })]));
    const table = screen.getByTestId('review-attendance');
    const cells = within(table).getAllByRole('cell');
    // Employee, Date, Time, Total worked, Status, Details
    expect(cells[2]!.textContent).toMatch(/→ —/); // open → no clock-out time
    expect(within(table).getByText('Open')).toBeInTheDocument();
    expect(
      within(table)
        .queryByText(/^Open$/)
        ?.closest('td'),
    ).not.toBe(cells[2]);
  });

  it('shows a session badge only when a day has more than one session', () => {
    const a = row({ id: 'a', timeIn: at(9), timeOut: at(6) });
    const b = row({ id: 'b', timeIn: at(4), timeOut: at(1) });
    render1(page([b], { completion: [a], total: 2 }));
    // The badge renders in both the desktop table and the mobile cards; scope to the table.
    const table = screen.getByTestId('review-attendance');
    expect(
      within(table).getByTestId('review-sessions-s1__' + shopDate(NOW)),
    ).toHaveTextContent('2 sessions');
  });

  it('has status tabs; picking one re-queries the server at page 1', async () => {
    loadMock.mockResolvedValue(page([row({ timeOut: null })], { total: 1 }));
    render1(page([row()], { total: 1 }));
    fireEvent.click(screen.getByTestId('review-tab-open'));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    const [filters, pageArg] = lastCall();
    expect(filters.status).toBe('open');
    expect(pageArg).toBe(1);
  });

  it('Next asks the server for the next page', async () => {
    loadMock.mockResolvedValue(page([row()], { total: 60, page: 2 }));
    render1(page([row()], { total: 60 }));
    expect(screen.getByTestId('review-page')).toHaveTextContent('Page 1 of 3');
    fireEvent.click(screen.getByTestId('review-next'));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(lastCall()[1]).toBe(2);
  });

  it('shows a clean empty state', () => {
    render1(page([]));
    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      /No attendance records found/i,
    );
  });

  it('surfaces a read failure instead of an empty state', async () => {
    loadMock.mockRejectedValue(new Error('boom'));
    render1(page([row()], { total: 1 }));
    fireEvent.click(screen.getByTestId('review-tab-completed'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  });
});
