import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PriceDownPaymentCalculator } from '@/components/calculator/price-down-payment-calculator';

/**
 * Owner 2026-08-24 — the Special Calculator's Down Payment Breakdown shows ONE percentage at a time
 * (20% / 30% toggle, default 20%), with NO Remaining Balance.
 */
describe('Special Calculator — Down Payment Breakdown (single-select)', () => {
  it('defaults to 20% and shows only ONE result card; 30% is not rendered', () => {
    render(<PriceDownPaymentCalculator />);
    expect(screen.getByTestId('calc-dp-toggle-20')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('calc-dp-toggle-30')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('calc-tier-20')).toBeInTheDocument();
    expect(screen.queryByTestId('calc-tier-30')).toBeNull();
  });

  it('NEVER shows a Remaining Balance', () => {
    render(<PriceDownPaymentCalculator />);
    fireEvent.change(screen.getByTestId('calc-fixed-price'), { target: { value: '20000' } });
    expect(screen.queryByText(/Remaining Balance/i)).toBeNull();
    fireEvent.click(screen.getByTestId('calc-dp-toggle-30'));
    expect(screen.queryByText(/Remaining Balance/i)).toBeNull();
  });

  it('FIXED PRICE: 20% and 30% compute correctly; only the selected card is visible', () => {
    render(<PriceDownPaymentCalculator />);
    fireEvent.change(screen.getByTestId('calc-fixed-price'), { target: { value: '20000' } });
    expect(screen.getByTestId('calc-item-price')).toHaveTextContent('₱20,000');
    // Default 20% → ₱4,000
    expect(screen.getByTestId('calc-down-20')).toHaveTextContent('₱4,000');
    // Switch to 30% → ₱6,000, and the 20% card is gone (one at a time)
    fireEvent.click(screen.getByTestId('calc-dp-toggle-30'));
    expect(screen.getByTestId('calc-down-30')).toHaveTextContent('₱6,000');
    expect(screen.queryByTestId('calc-tier-20')).toBeNull();
  });

  it('PRICE PER GRAM: item price and DP compute correctly', () => {
    render(<PriceDownPaymentCalculator />);
    fireEvent.click(screen.getByTestId('calc-type-per_gram'));
    fireEvent.change(screen.getByTestId('calc-grams'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByTestId('calc-price-per-gram'), { target: { value: '4000' } });
    expect(screen.getByTestId('calc-item-price')).toHaveTextContent('₱10,000');
    expect(screen.getByTestId('calc-down-20')).toHaveTextContent('₱2,000');
    fireEvent.click(screen.getByTestId('calc-dp-toggle-30'));
    expect(screen.getByTestId('calc-down-30')).toHaveTextContent('₱3,000');
  });

  it('shows ₱0 before any price is entered', () => {
    render(<PriceDownPaymentCalculator />);
    expect(screen.getByTestId('calc-down-20')).toHaveTextContent('₱0');
  });
});
