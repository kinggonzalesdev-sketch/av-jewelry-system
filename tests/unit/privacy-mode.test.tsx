import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';

import {
  Money,
  PrivacyProvider,
  PrivacyToggle,
  Sensitive,
  SensitivePhone,
  maskPhone,
} from '@/components/shell/privacy';

/**
 * Privacy Mode (spec §1–§12): a screen-only display toggle that masks financial
 * and customer values to dots, instantly, without a page refresh. It never
 * changes data or permissions, and the real value is still emitted for print.
 */

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

describe('mask helpers', () => {
  it('partially masks a phone number, keeping first 4 + last 3 digits', () => {
    expect(maskPhone('0917-123-4567')).toBe('0917••••567');
  });
  it('fully masks a too-short number', () => {
    expect(maskPhone('123')).toBe('•••••••');
  });
});

describe('Money', () => {
  it('shows the real amount when Privacy Mode is off', () => {
    render(
      <PrivacyProvider>
        <Money amount="1500" />
      </PrivacyProvider>,
    );
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.queryByText('₱••••••')).not.toBeInTheDocument();
  });

  it('masks to dots after the toggle is pressed — no refresh', () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <Money amount="1500" />
      </PrivacyProvider>,
    );
    fireEvent.click(screen.getByTestId('privacy-toggle'));
    // Screen mask is shown…
    expect(screen.getByText('₱••••••')).toBeInTheDocument();
    // …and the toggle now reflects the hidden state.
    expect(screen.getByTestId('privacy-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('still emits the real amount for print even when hidden (§10)', () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <Money amount="1500" />
      </PrivacyProvider>,
    );
    fireEvent.click(screen.getByTestId('privacy-toggle'));
    // The print-only span keeps the real value in the DOM (CSS hides it on screen).
    const printSpan = document.querySelector('.print\\:inline');
    expect(printSpan?.textContent).toMatch(/1,500/);
  });
});

describe('Sensitive / SensitivePhone', () => {
  it('masks generic text and phone once hidden', () => {
    render(
      <PrivacyProvider>
        <PrivacyToggle />
        <Sensitive>123 Rizal St</Sensitive>
        <SensitivePhone value="0917-123-4567" />
      </PrivacyProvider>,
    );
    // Visible first.
    expect(screen.getByText('123 Rizal St')).toBeInTheDocument();
    expect(screen.getByText('0917-123-4567')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('privacy-toggle'));
    expect(screen.getByText('•••••••')).toBeInTheDocument();
    expect(screen.getByText('0917••••567')).toBeInTheDocument();
  });
});

describe('default (no provider)', () => {
  it('renders real values when there is no PrivacyProvider (safe default)', () => {
    render(<Money amount="2500" />);
    expect(screen.getByText(/2,500/)).toBeInTheDocument();
  });
});
