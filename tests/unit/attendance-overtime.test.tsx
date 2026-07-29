import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceClock } from '@/components/hr/attendance-clock';
import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import type { AttendanceRow } from '@/lib/hr/attendance';

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
}));
vi.mock('@/lib/attachments/actions', () => ({
  uploadAttachmentAction: vi.fn(),
}));

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    id: crypto.randomUUID(),
    staffProfileId: 's1',
    staffName: 'King Gonzales',
    workDate: '2026-07-22',
    timeIn: '2026-07-22T14:00:00.000Z',
    timeOut: '2026-07-22T15:00:00.000Z',
    note: null,
    isOvertime: false,
    overtimeAmount: '0',
    ...over,
  };
}

describe('ReviewAttendanceView — Overtime column', () => {
  it('shows an Overtime column with the ₱ amount for a 10 PM+ clock-in', () => {
    render(
      <ReviewAttendanceView
        records={[
          row({ staffName: 'Late Nighter', isOvertime: true, overtimeAmount: '300.00' }),
          row({ staffName: 'Day Shift', isOvertime: false, overtimeAmount: '0' }),
        ]}
      />,
    );

    const table = screen.getByTestId('review-attendance');
    expect(within(table).getByText('Overtime')).toBeInTheDocument();
    // The overtime row shows ₱300 (whole → no decimals); the day-shift row a dash.
    expect(within(table).getByText(/₱\s?300\b/)).toBeInTheDocument();
    // The explanatory footer was removed by Owner request; the COLUMN is the record.
    expect(screen.queryByText(/Total overtime shown/i)).not.toBeInTheDocument();
  });

  it('shows clock-in/out selfie thumbnails that link to the image (view/download)', () => {
    const r = row({ isOvertime: false });
    render(
      <ReviewAttendanceView
        records={[r]}
        selfies={{
          [r.id]: {
            inUrl: 'https://signed.example/in.jpg',
            outUrl: 'https://signed.example/out.jpg',
          },
        }}
      />,
    );
    const inThumb = screen.getByAltText('In selfie');
    const outThumb = screen.getByAltText('Out selfie');
    expect(inThumb).toHaveAttribute('src', 'https://signed.example/in.jpg');
    expect(outThumb.closest('a')).toHaveAttribute('href', 'https://signed.example/out.jpg');
  });
});

describe('AttendanceClock', () => {
  const staff = [{ id: 's1', fullName: 'Grace Villanueva', roleKey: 'staff' }];

  it('requires picking a team member from the dropdown before offering Clock In', () => {
    render(<AttendanceClock staff={staff} openSessions={{}} />);
    // One dropdown; the option reads the NAME ONLY (Owner request); no clock
    // button until someone is picked.
    const select = screen.getByTestId<HTMLSelectElement>('clock-staff-select');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Grace Villanueva' })).toBeInTheDocument();
    expect(screen.queryByTestId('clock-in')).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 's1' } });
    expect(screen.getByTestId('clock-in')).toBeInTheDocument();
  });

  it('reveals the selfie step (Cancel) when Clock In is pressed, and Cancel returns', () => {
    render(<AttendanceClock staff={staff} openSessions={{}} />);
    fireEvent.change(screen.getByTestId('clock-staff-select'), { target: { value: 's1' } });
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
    fireEvent.change(screen.getByTestId('clock-staff-select'), { target: { value: 's1' } });
    const clockOut = screen.getByTestId('clock-out');
    expect(clockOut).toBeInTheDocument();

    // Clock Out routes through the same selfie step ("clock out" wording).
    fireEvent.click(clockOut);
    expect(screen.getByText(/Take a selfie to clock out/i)).toBeInTheDocument();
    expect(screen.getByTestId('clock-cancel')).toBeInTheDocument();
  });
});
