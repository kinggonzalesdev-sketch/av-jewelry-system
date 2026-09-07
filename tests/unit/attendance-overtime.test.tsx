import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceClock } from '@/components/hr/attendance-clock';
import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import type { AttendanceRow } from '@/lib/hr/attendance';
import type { AttendancePage } from '@/lib/hr/attendance-paging';

// The clock calls server actions + useRouter; stub them so the render/UX tests
// never touch the server chain (the camera path is exercised via jsdom, which
// has no getUserMedia, driving the "no photo" fallback branch).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/hr/actions', () => ({
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  deleteAttendanceRecordAction: vi.fn(),
  correctAttendanceClockOutAction: vi.fn(),
  // Server pagination for Review — not hit on first render (initialPage is used).
  loadReviewAttendancePageAction: vi.fn(),
  // Selfies are lazy-loaded when a day is opened — echo signed URLs for the requested ids.
  loadAttendanceSelfiesAction: vi.fn((ids: string[]) =>
    Promise.resolve({
      [ids[0] ?? '']: {
        inUrl: 'https://signed.example/in.jpg',
        outUrl: 'https://signed.example/out.jpg',
      },
    }),
  ),
}));
vi.mock('@/lib/attachments/actions', () => ({
  uploadAttachmentAction: vi.fn(),
}));

// A "today" (shop-time) date so the row falls inside the default last-7-days range.
const NOW = new Date();
const shopDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: crypto.randomUUID(),
    staffProfileId: 's1',
    staffName: 'King Gonzales',
    workDate: shopDate(NOW),
    timeIn: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    timeOut: new Date(NOW.getTime() - 1 * 3_600_000).toISOString(),
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
const roster = [
  { id: 's1', fullName: 'King Gonzales', roleKey: 'staff' },
  { id: 's2', fullName: 'Late Nighter', roleKey: 'staff' },
];

describe('ReviewAttendanceView — overtime is a conditional badge (not a column)', () => {
  it('shows an OT badge with the ₱ amount only for an overtime day', () => {
    const late = row({
      staffProfileId: 's2',
      staffName: 'Late Nighter',
      isOvertime: true,
      overtimeAmount: '300.00',
    });
    const day = row({ staffProfileId: 's1', staffName: 'Day Shift', isOvertime: false });
    render(
      <ReviewAttendanceView initialPage={page([late, day])} roster={roster} canManage />,
    );
    const table = screen.getByTestId('review-attendance');
    // There's no "Overtime" column header anymore.
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(heads).toEqual([
      'Employee',
      'Date',
      'Time',
      'Total worked',
      'Status',
      'Details',
    ]);
    // The late day carries an OT badge with ₱300; the day-shift row carries none.
    expect(
      within(table).getByTestId(`review-ot-${late.staffProfileId}__${late.workDate}`),
    ).toHaveTextContent(/₱\s?300/);
    expect(
      within(table).queryByTestId(`review-ot-${day.staffProfileId}__${day.workDate}`),
    ).not.toBeInTheDocument();
  });

  it('shows clock-in/out selfie thumbnails inside Details (lazy-loaded on open)', async () => {
    const r = row({ isOvertime: false });
    render(<ReviewAttendanceView initialPage={page([r])} roster={roster} canManage />);
    // Desktop table + mobile cards both render in jsdom → two "Details"; open the first.
    fireEvent.click(screen.getAllByRole('button', { name: /details/i })[0]!);
    const inThumb = await screen.findByAltText('In selfie');
    const outThumb = screen.getByAltText('Out selfie');
    expect(inThumb).toHaveAttribute('src', 'https://signed.example/in.jpg');
    expect(outThumb.closest('a')).toHaveAttribute(
      'href',
      'https://signed.example/out.jpg',
    );
  });
});

describe('AttendanceClock', () => {
  const staff = [{ id: 's1', fullName: 'Grace Villanueva', roleKey: 'staff' }];

  it('requires picking a team member from the dropdown before offering Clock In', () => {
    render(<AttendanceClock staff={staff} openSessions={{}} />);
    const select = screen.getByTestId<HTMLSelectElement>('clock-staff-select');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grace Villanueva' })).toBeInTheDocument();
    expect(screen.queryByTestId('clock-in')).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 's1' } });
    expect(screen.getByTestId('clock-in')).toBeInTheDocument();
  });

  it('reveals the selfie step (Cancel) when Clock In is pressed, and Cancel returns', () => {
    render(<AttendanceClock staff={staff} openSessions={{}} />);
    fireEvent.change(screen.getByTestId('clock-staff-select'), {
      target: { value: 's1' },
    });
    fireEvent.click(screen.getByTestId('clock-in'));

    expect(screen.getByText(/Take a selfie/i)).toBeInTheDocument();
    expect(screen.getByTestId('clock-cancel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('clock-cancel'));
    expect(screen.getByTestId('clock-in')).toBeInTheDocument();
  });

  it('offers Clock Out when the selected member already has an open session', () => {
    render(
      <AttendanceClock staff={staff} openSessions={{ s1: '2026-07-22T14:00:00.000Z' }} />,
    );
    fireEvent.change(screen.getByTestId('clock-staff-select'), {
      target: { value: 's1' },
    });
    const clockOut = screen.getByTestId('clock-out');
    expect(clockOut).toBeInTheDocument();

    fireEvent.click(clockOut);
    expect(screen.getByText(/Take a selfie to clock out/i)).toBeInTheDocument();
    expect(screen.getByTestId('clock-cancel')).toBeInTheDocument();
  });
});
