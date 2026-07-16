import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarChart } from '@/components/ui/bar-chart';

describe('BarChart (real aggregation only, honest empty)', () => {
  it('renders one labelled bar per datum with its value', () => {
    render(
      <BarChart
        ariaLabel="Orders by status"
        data={[
          { label: 'Active Layaway', value: 3 },
          { label: 'Closed', value: 9 },
        ]}
      />,
    );
    const chart = screen.getByTestId('bar-chart');
    expect(chart).toHaveAccessibleName('Orders by status');
    expect(within(chart).getByText('Active Layaway')).toBeInTheDocument();
    expect(within(chart).getByText('3')).toBeInTheDocument();
    expect(within(chart).getByText('9')).toBeInTheDocument();
  });

  it('scales bar widths to the maximum value', () => {
    render(
      <BarChart
        ariaLabel="scaled"
        data={[
          { label: 'Half', value: 5 },
          { label: 'Full', value: 10 },
        ]}
      />,
    );
    const fills = document.querySelectorAll('span.bg-gold');
    expect((fills[0] as HTMLElement).style.width).toBe('50%');
    expect((fills[1] as HTMLElement).style.width).toBe('100%');
  });

  it('shows an authoritative display string instead of the numeric value when given', () => {
    render(
      <BarChart
        ariaLabel="money"
        data={[{ label: 'Mon', value: 12345.67, display: '₱12,345.67' }]}
      />,
    );
    expect(screen.getByText('₱12,345.67')).toBeInTheDocument();
    // The raw float is never shown — no frontend money math on the display.
    expect(screen.queryByText('12345.67')).not.toBeInTheDocument();
  });

  it('shows an honest empty note instead of a blank chart when there is nothing', () => {
    render(<BarChart ariaLabel="empty" data={[]} emptyLabel="No data yet." />);
    expect(screen.getByTestId('bar-chart-empty')).toHaveTextContent('No data yet.');
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('draws labelled categories at zero with a "No data yet" state (real zeros, no fake data)', () => {
    render(
      <BarChart
        ariaLabel="zeros"
        data={[
          { label: 'Active Layaway', value: 0 },
          { label: 'Closed', value: 0 },
        ]}
      />,
    );
    // The chart is visibly present with its categories, not hidden.
    const chart = screen.getByTestId('bar-chart');
    expect(within(chart).getByText('Active Layaway')).toBeInTheDocument();
    expect(within(chart).getByText('Closed')).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart-nodata')).toHaveTextContent('No data yet');
    // Every bar is at 0 width — no invented data.
    for (const fill of document.querySelectorAll('span.bg-gold')) {
      expect((fill as HTMLElement).style.width).toBe('0%');
    }
  });
});
