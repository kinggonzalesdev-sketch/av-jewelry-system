import { z } from 'zod';

/**
 * Authentication validation schemas (ADR §4).
 *
 * Sign-in only. There is no registration schema, because public self-registration
 * does not exist and there is no customer login.
 *
 * Password policy (minimum length, complexity, rotation) is an approved-but-unresolved
 * decision (ADR §17) owned by Owner/developer. Sign-in therefore only checks that a
 * password is non-empty: inventing a policy here would silently create a business rule
 * the client has not approved (Bible §33.2). Policy is enforced at account creation,
 * which is Roadmap Phase 2.
 */

export const signInSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email address')
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required'),
});

export type SignInInput = z.infer<typeof signInSchema>;
