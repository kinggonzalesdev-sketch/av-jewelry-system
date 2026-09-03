'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  changePassword,
  requestPasswordReset,
  verifyResetOtp,
} from '@/lib/auth/password-reset';
import {
  cooldownDeadline,
  isCompleteOtp,
  passwordChecks,
  sanitizeOtp,
  secondsLeft,
} from '@/lib/auth/reset-cooldown';
import { MINIMUM_PASSWORD_LENGTH } from '@/lib/validation/auth';

type Step = 'email' | 'code' | 'password' | 'done';

const emailShape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li
      className={met ? 'text-emerald-600' : 'text-muted-foreground'}
      data-met={met}
    >
      <span aria-hidden="true">{met ? '✓' : '○'}</span> {children}
    </li>
  );
}

// Inline eye glyph (the codebase carries no icon library — icons are inline SVG). `off` shows the
// struck-through eye, meaning "currently visible, click to hide".
function EyeGlyph({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {off ? (
        <>
          <path d="M10.7 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.4M6.1 6.1A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.9 9.9 0 0 0 5.9-1.9" />
          <path d="m1 1 22 22" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// A password field with a show/hide eye toggle. Each field keeps its own reveal state so New and
// Confirm can be shown independently; the toggle never submits and stays out of the tab order so
// the field → field → submit flow is unbroken.
function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  testId,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={reveal ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          className="pr-10"
          required
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? 'Hide password' : 'Show password'}
          aria-pressed={reveal}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
          data-testid={`${testId}-toggle`}
        >
          <EyeGlyph off={reveal} />
        </button>
      </div>
    </div>
  );
}

/**
 * Forgot-password flow: Email → 6-digit code → New password → Success. Uses Supabase Auth's
 * native email-OTP recovery via the server actions; the browser never decides auth. Matches
 * the sign-in card design.
 */
export function ResetPasswordForm() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Resend cooldown — derived from an absolute DEADLINE so it never drifts when the tab is
  // backgrounded and timers throttle.
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, force] = useState(0);
  const remaining = secondsLeft(deadline);
  useEffect(() => {
    if (deadline == null || remaining <= 0) return;
    const id = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, [deadline, remaining]);

  const send = (target: string) => {
    setError(null);
    startTransition(async () => {
      const res = await requestPasswordReset(target);
      setNotice(res.message);
      setDeadline(cooldownDeadline()); // gates ONLY resend — never the 10-min OTP
    });
  };

  const onSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailShape.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    send(email.trim().toLowerCase());
    setStep('code');
  };

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteOtp(code)) return;
    setError(null);
    startTransition(async () => {
      const res = await verifyResetOtp(email, code);
      if (res.ok) {
        setStep('password');
        setNotice(null);
      } else {
        setError(res.error);
        if (res.expired) setCode('');
      }
    });
  };

  const checks = passwordChecks(password, confirm, MINIMUM_PASSWORD_LENGTH);
  const onSetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checks.valid) return;
    setError(null);
    startTransition(async () => {
      const res = await changePassword(password, confirm);
      if (res.ok) setStep('done');
      else setError(res.error);
    });
  };

  return (
    <div className="space-y-4" data-testid="reset-password">
      {step === 'email' ? (
        <form onSubmit={onSendEmail} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            Enter your account email and we'll send a 6-digit code to reset your password.
          </p>
          <div className="space-y-2">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Sending…' : 'Send code'}
          </Button>
        </form>
      ) : null}

      {step === 'code' ? (
        <form onSubmit={onVerify} className="space-y-4" noValidate>
          {notice ? (
            <p className="text-sm text-muted-foreground" data-testid="reset-notice">
              {notice}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="reset-code">6-digit code</Label>
            <Input
              id="reset-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(sanitizeOtp(e.target.value))}
              data-testid="reset-code-input"
              required
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive" data-testid="reset-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={pending || !isCompleteOtp(code)}
            data-testid="reset-verify"
          >
            {pending ? 'Verifying…' : 'Verify'}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => send(email)}
              disabled={pending || remaining > 0}
              className="text-muted-foreground underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
              data-testid="reset-resend"
            >
              {remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
              className="text-muted-foreground underline-offset-2 hover:underline"
            >
              Use a different email
            </button>
          </div>
        </form>
      ) : null}

      {step === 'password' ? (
        <form onSubmit={onSetPassword} className="space-y-4" noValidate>
          <PasswordField
            id="reset-password-input"
            name="password"
            label="New password"
            value={password}
            onChange={setPassword}
            testId="reset-new-password"
          />
          <PasswordField
            id="reset-confirm"
            name="confirmPassword"
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            testId="reset-confirm-password"
          />
          <ul className="space-y-1 text-xs">
            <Requirement met={checks.length}>
              At least {MINIMUM_PASSWORD_LENGTH} characters
            </Requirement>
            <Requirement met={checks.match}>Passwords match</Requirement>
          </ul>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={pending || !checks.valid}
            data-testid="reset-set-password"
          >
            {pending ? 'Setting…' : 'Set new password'}
          </Button>
        </form>
      ) : null}

      {step === 'done' ? (
        <div className="space-y-4" data-testid="reset-done">
          <p className="text-sm text-foreground">
            Your password has been changed and you've been signed out of all devices. Sign
            in with your new password.
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              window.location.href = '/sign-in';
            }}
          >
            Go to sign in
          </Button>
        </div>
      ) : null}

      {step !== 'done' ? (
        <p className="text-center text-sm">
          <Link
            href="/sign-in"
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      ) : null}
    </div>
  );
}
