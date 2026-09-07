import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceRecords } from '@/components/hr/attendance-records';
import type { AttendanceRow } from '@/lib/hr/attendance';
import type { AttendanceFilters, AttendancePage } from '@/lib/hr/attendance-paging';

/**
 * The refined Attendance records list (Owner 2026-09-06): server pagination, the toolbar
 * filters, Open-as-status (never inside the Final out column), and the desktop-table /
 * mobile-card split. The paging maths live in attendance-paging.test.ts; this covers the wiring.
 */

const loadMock = vi.fn<(...args: unknown[]) => Promise<AttendancePage>>();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/hr/actions', () => ({
  loadAttendancePageAction: (...args: unknown[]) => loadMock(...args),
  deleteAttendanceRecordAction: vi.fn(),
  requestAttendanceDeletionAction: vi.fn(),
}));

/** The args of the most recent loadAttendancePageAction call, typed. */
function lastCall(): [AttendanceFilters, number, number] {
  return loadMock.mock.calls.at(-1) as unknown as [AttendanceFilters, number, number];
}

function row(over: Partial<AttendanceRow>): AttendanceRow {
  return {
    id: crypto.randomUUID(),
    staffProfileId: 's1',
    staffName: 'Lalyn Penaranda',
    workDate: '2026-09-05',
    timeIn: '2026-09-05T01:00:00.000Z',
    timeOut: '2026-09-05T13:00:00.000Z',
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

function renderRecords(over?: {
  initialPage?: AttendancePage;
  canFilterStaff?: boolean;
  canManage?: boolean;
}) {
  return render(
    <AttendanceRecords
      initialPage={over?.initialPage ?? page([row({})])}
      roster={roster}
      canManage={over?.canManage ?? true}
      isOwner
      canFilterStaff={over?.canFilterStaff ?? true}
      defaultRange="7d"
    />,
  );
}

beforeEach(() => {
  loadMock.mockReset();
  loadMock.mockResolvedValue(page([]));
});

describe('AttendanceRecords', () => {
  it('renders the first (server) page without an extra fetch', () => {
    renderRecords();
    expect(screen.getByTestId('attendance-count')).toHaveTextContent('1–1 of 1 session');
    expect(loadMock).not.toHaveBeenCalled();
  });

  it('shows Open as a STATUS, with Final out "—" (never the word Open in the time column)', () => {
    renderRecords({ initialPage: page([row({ timeOut: null })]) });
    const table = screen.getByTestId('attendance-days');
    const cells = within(table).getAllByRole('cell');
    const finalOut = cells[3]!; // Staff, Date, First in, Final out, ...
    expect(finalOut.textContent).toBe('—');
    expect(within(table).getByText('Clocked in')).toBeInTheDocument();
    // The literal word "Open" is not used anywhere in the row.
    expect(within(table).queryByText('Open')).not.toBeInTheDocument();
  });

  it('has no Sessions column; a multi-session day shows a count marker instead', () => {
    const day = [
      row({ id: 'a', timeIn: '2026-09-05T01:00:00Z', timeOut: '2026-09-05T09:00:00Z' }),
      row({ id: 'b', timeIn: '2026-09-05T11:00:00Z', timeOut: '2026-09-05T13:00:00Z' }),
    ];
    renderRecords({ initialPage: page([day[1]!], { completion: [day[0]!], total: 2 }) });
    const heads = within(screen.getByTestId('attendance-days'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual([
      'Staff',
      'Date',
      'First in',
      'Final out',
      'Total worked',
      'Status',
      'Details',
    ]);
    expect(screen.getByTestId('attendance-sessions-s1__2026-09-05')).toHaveTextContent(
      '2×',
    );
  });

  it('changing the status filter re-queries the server and resets to page 1', async () => {
    loadMock.mockResolvedValue(page([row({ timeOut: null })], { total: 1 }));
    renderRecords();
    fireEvent.change(screen.getByTestId('attendance-status-filter'), {
      target: { value: 'open' },
    });
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    const [filters, pageArg] = lastCall();
    expect(filters.status).toBe('open');
    expect(pageArg).toBe(1);
  });

  it('typing a search debounces into a staff filter query', async () => {
    vi.useFakeTimers();
    try {
      renderRecords();
      fireEvent.change(screen.getByTestId('attendance-search'), {
        target: { value: 'grace' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(loadMock).toHaveBeenCalled();
      const [filters] = lastCall();
      expect(filters.staffIds).toEqual(['s2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Next advances the page and asks the server for it', async () => {
    loadMock.mockResolvedValue(page([row({})], { total: 60, page: 2 }));
    renderRecords({ initialPage: page([row({})], { total: 60 }) });
    expect(screen.getByTestId('attendance-page')).toHaveTextContent('Page 1 of 3');
    fireEvent.click(screen.getByTestId('attendance-next'));
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    expect(lastCall()[1]).toBe(2);
  });

  it('hides the staff filter when the member may not see the team', () => {
    renderRecords({ canFilterStaff: false });
    expect(screen.queryByTestId('attendance-staff-filter')).not.toBeInTheDocument();
    // Search stays available regardless.
    expect(screen.getByTestId('attendance-search')).toBeInTheDocument();
  });

  it('surfaces a read failure instead of an empty state', async () => {
    loadMock.mockRejectedValue(new Error('boom'));
    renderRecords();
    fireEvent.change(screen.getByTestId('attendance-status-filter'), {
      target: { value: 'completed' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  });
});
