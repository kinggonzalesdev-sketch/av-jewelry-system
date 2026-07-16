import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReportsView } from '@/components/reports/reports-view';

const summary = {
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-07-15T00:00:00.000Z',
  verifiedCollected: '209100.00',
  paymentsRecorded: 24,
  paymentsVerified: 18,
  paymentsUnverified: 6,
};

describe('ReportsView (only the approved sales summary)', () => {
  it('lets any staff VIEW the summary; only export is noted as gated', () => {
    // Owner-approved visibility: viewing on-screen totals is broad; only
    // export/download is gated by export_data_reports.
    render(<ReportsView canExport={false} from="" to="" result={null} />);
    expect(screen.getByRole('button', { name: /run report/i })).toBeInTheDocument();
    expect(screen.getByTestId('reports-export-note')).toBeInTheDocument();
    expect(screen.queryByTestId('reports-denied')).not.toBeInTheDocument();
  });

  it('prompts for a range before any report has been run', () => {
    render(<ReportsView canExport={true} from="" to="" result={null} />);
    expect(screen.getByTestId('reports-prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run report/i })).toBeInTheDocument();
  });

  it('surfaces a read error explicitly', () => {
    render(
      <ReportsView
        canExport={true}
        from="2026-07-01"
        to="2026-07-15"
        result={{ ok: false, error: 'boom' }}
      />,
    );
    expect(screen.getByText(/could not be generated/i)).toBeInTheDocument();
  });

  it('renders the verified total, counts, and the payments chart', () => {
    render(
      <ReportsView
        canExport={true}
        from="2026-07-01"
        to="2026-07-15"
        result={{ ok: true, data: summary }}
      />,
    );
    expect(screen.getByTestId('reports-result')).toBeInTheDocument();
    expect(screen.getByText('₱209,100.00')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toHaveAccessibleName(
      /payments by verification/i,
    );
  });
});
