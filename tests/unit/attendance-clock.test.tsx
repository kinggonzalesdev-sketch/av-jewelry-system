import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceClock, type ClockStaffMember } from '@/components/hr/attendance-clock';

/**
 * The time clock has three states per selected staff member (§12):
 *   - no attendance today → Clock In
 *   - an open session      → Clock Out
 *   - clocked out today    → Continue Duty (adds a session to the same day)
 * Continue Duty opens a confirmation first and never navigates.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/hr/actions', () => ({ clockInAction: vi.fn(), clockOutAction: vi.fn() }));
vi.mock('@/lib/attachments/actions', () => ({ uploadAttachmentAction: vi.fn() }));

const staff: ClockStaffMember[] = [{ id: 's1', fullName: 'Ana Cruz', roleKey: 'staff' }];

function selectAna() {
  fireEvent.change(screen.getByTestId('clock-staff-select'), { target: { value: 's1' } });
}

describe('AttendanceClock — Continue Duty state', () => {
  it('offers Clock In when there is no attendance today', () => {
    render(<AttendanceClock staff={staff} openSessions={{}} lastOutToday={{}} />);
    selectAna();
    expect(screen.getByTestId('clock-in')).toBeInTheDocument();
    expect(screen.queryByTestId('clock-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clock-out')).not.toBeInTheDocument();
  });

  it('offers Clock Out while a session is open', () => {
    render(
      <AttendanceClock
        staff={staff}
        openSessions={{ s1: '2026-08-10T01:00:00Z' }}
        lastOutToday={{ s1: '2026-08-10T00:00:00Z' }}
      />,
    );
    selectAna();
    expect(screen.getByTestId('clock-out')).toBeInTheDocument();
    // Open session wins — no Continue Duty and no Clock In.
    expect(screen.queryByTestId('clock-continue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clock-in')).not.toBeInTheDocument();
  });

  it('offers Continue Duty after clocking out today, behind a confirmation', () => {
    render(
      <AttendanceClock
        staff={staff}
        openSessions={{}}
        lastOutToday={{ s1: '2026-08-10T09:00:00Z' }}
      />,
    );
    selectAna();
    const cont = screen.getByTestId('clock-continue');
    expect(cont).toBeInTheDocument();
    expect(screen.queryByTestId('clock-in')).not.toBeInTheDocument();

    // Clicking opens a confirmation (does not immediately start a session).
    fireEvent.click(cont);
    expect(screen.getByRole('dialog')).toHaveTextContent('Continue Duty?');
    expect(screen.getByTestId('clock-continue-confirm')).toBeInTheDocument();
  });
});
