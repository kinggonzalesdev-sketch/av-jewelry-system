import { z } from 'zod';

/**
 * Authentication validation schemas (ADR §4, approved Phase 2 password policy).
 *
 * Sign-in only, plus the password policy used when an account's password is SET.
 * There is deliberately no registration schema: public self-registration does not
 * exist and there is no customer login.
 */

/**
 * Approved minimum password length. Complexity rules beyond length remain
 * configurable and are deliberately NOT invented here.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;

export const signInSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email address')
    .transform((value) => value.trim().toLowerCase()),
  // Sign-in validates only that a password was supplied. It must NOT apply the
  // length policy: an account created before the policy would be told its
  // password is "invalid" rather than simply wrong, which leaks policy state and
  // blocks a legitimate reset. Policy is enforced where a password is SET.
  password: z.string().min(1, 'Password is required'),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * Password policy, applied wherever a password is CHOSEN (invite, reset, change).
 *
 * Minimum 12 characters (approved). Passwords are handled exclusively by Supabase
 * Auth — MineFlow never stores plaintext or recoverable passwords, and no custom
 * hashing exists anywhere in this codebase.
 */
export const passwordSchema = z
  .string()
  .min(
    MINIMUM_PASSWORD_LENGTH,
    `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`,
  )
  // A generous ceiling that still refuses absurd input; bcrypt-family hashes
  // silently truncate very long inputs, so an explicit limit is honest.
  .max(200, 'Password must be at most 200 characters');

export const setPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

/**
 * Password reset request: email only.
 * The reset link goes to the staff member's verified email via Supabase Auth.
 */
export const passwordResetRequestSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email address')
    .transform((value) => value.trim().toLowerCase()),
});

export const totpCodeSchema = z.object({
  factorId: z.string().min(1),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});

/**
 * Password-reset OTP verification: the recovery email + the 6-digit code Supabase Auth
 * emailed. The code is EXACTLY six digits (Supabase `mailer_otp_length = 6`); it is
 * validated server-side with the same /^\d{6}$/ shape the input enforces client-side.
 */
export const passwordResetVerifySchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email address')
    .transform((value) => value.trim().toLowerCase()),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
});
