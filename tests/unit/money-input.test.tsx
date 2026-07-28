import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MoneyInput, sanitizeMoney } from '@/components/ui/money-input';

/**
 * MoneyInput — the shared currency field. Formats with commas while typing, keeps
 * the value numeric on submit (hidden raw input), and rejects letters / negatives
 * / extra dots.
 */

describe('sanitizeMoney', () => {
  it('keeps digits and a single decimal, max two places; drops the rest', () => {
    expect(sanitizeMoney('1000')).toBe('1000');
    expect(sanitizeMoney('1,000')).toBe('1000');
    expect(sanitizeMoney('₱1,250.50')).toBe('1250.50');
    expect(sanitizeMoney('12.999')).toBe('12.99');
    expect(sanitizeMoney('1.2.3')).toBe('1.23');
    expect(sanitizeMoney('-500abc')).toBe('500');
  });
});

describe('MoneyInput', () => {
  it('formats with thousand separators while typing and submits the RAW value', () => {
    render(<MoneyInput name="amount" defaultValue="" data-testid="mi" />);
    const input = screen.getByTestId<HTMLInputElement>('mi');

    fireEvent.change(input, { target: { value: '1000000' } });
    expect(input.value).toBe('1,000,000');

    const hidden = document.querySelector<HTMLInputElement>('input[name="amount"]');
    expect(hidden?.value).toBe('1000000'); // no commas stored/submitted
  });

  it('keeps a decimal amount and rejects letters', () => {
    render(<MoneyInput name="amt" data-testid="mi2" />);
    const input = screen.getByTestId<HTMLInputElement>('mi2');

    fireEvent.change(input, { target: { value: '1250.50' } });
    expect(input.value).toBe('1,250.50');

    fireEvent.change(input, { target: { value: '12ab.5' } });
    expect(input.value).toBe('12.5');
  });

  it('renders ₱ as a prefix, never inside the editable value', () => {
    render(<MoneyInput name="p" defaultValue="1000" data-testid="mi3" />);
    const input = screen.getByTestId<HTMLInputElement>('mi3');
    expect(input.value).toBe('1,000'); // no ₱ in the value
    expect(screen.getByText('₱')).toBeInTheDocument(); // shown beside it
  });
});
