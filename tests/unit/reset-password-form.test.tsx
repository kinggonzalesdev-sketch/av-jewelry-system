import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResetPasswordForm } from '@/app/(auth)/reset-password/reset-password-form';

// The password step is gated behind the email → 6-digit code flow, so mock the three server
// actions to walk the form to that step deterministically.
// Rest params so the forwarding spreads below type-check (a zero-arg vi.fn cannot take a spread).
const requestReset = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ message: 'If an account exists…' }),
);
const verifyOtp = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true as const }));
const changePw = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true as const }));
vi.mock('@/lib/auth/password-reset', () => ({
  requestPasswordReset: (...a: unknown[]) => requestReset(...a),
  verifyResetOtp: (...a: unknown[]) => verifyOtp(...a),
  changePassword: (...a: unknown[]) => changePw(...a),
}));

async function advanceToPasswordStep() {
  render(<ResetPasswordForm />);
  // Email step → submit moves to the code step synchronously.
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'staff@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: /send code/i }));
  // Code step → a valid 6-digit code enables Verify; success advances to the password step.
  const codeInput = await screen.findByTestId('reset-code-input');
  fireEvent.change(codeInput, { target: { value: '123456' } });
  fireEvent.click(screen.getByTestId('reset-verify'));
  await screen.findByTestId('reset-new-password');
}

describe('ResetPasswordForm — password reveal toggle (Owner 2026-09-03)', () => {
  it('New password starts masked and the eye toggles it visible then masked again', async () => {
    await advanceToPasswordStep();
    const input = screen.getByTestId('reset-new-password');
    const toggle = screen.getByTestId('reset-new-password-toggle');

    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-label', 'Show password');

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-label', 'Hide password');

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('New and Confirm reveal independently (their own eye each)', async () => {
    await advanceToPasswordStep();
    const newPw = screen.getByTestId('reset-new-password');
    const confirmPw = screen.getByTestId('reset-confirm-password');

    fireEvent.click(screen.getByTestId('reset-new-password-toggle'));
    expect(newPw).toHaveAttribute('type', 'text');
    // Confirm stays masked — each field owns its reveal state.
    expect(confirmPw).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByTestId('reset-confirm-password-toggle'));
    expect(confirmPw).toHaveAttribute('type', 'text');
  });
});
