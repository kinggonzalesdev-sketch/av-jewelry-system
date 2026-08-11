import type { Metadata } from 'next';

import { SignInForm } from '@/app/(auth)/sign-in/sign-in-form';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Staff sign-in (Bible §8.2: login exists outside authenticated navigation).
 *
 * There is NO public self-registration and NO customer login (ADR §4).
 * Simplified to logo · title · form (Owner request 2026-07-24) — the auth logic,
 * routes, validation, and security in SignInForm are unchanged.
 */
export default function SignInPage() {
  return (
    <main
      id="main-content"
      className="relative flex min-h-dvh flex-col items-center overflow-hidden px-4 py-6"
    >
      {/* Background: the A.V. Jewelry sign-in photo, stretched to cover the page. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/av-jewelry-signinbg.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {/* Light dark overlay — just enough to keep the logo + card readable while the
          jewelry photo still shows through clearly (approved "Option C" look). */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/30" />

      {/* Logo pinned near the TOP with a little space above it (not vertically
          centered). Transparent PNG, no box behind it — sits on the dark page bg. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/av-jewelry-logo.png"
        alt="A.V. Jewelry"
        className="relative mt-2 block h-auto w-[240px] max-w-[72vw] object-contain sm:w-[320px]"
      />

      {/* Sign-in card sits just below the logo with the empty space pushed to the
          bottom, so on a normal-height screen it lands around the vertical middle.
          `theme-light-card` forces the WHITE emerald card regardless of the viewer's
          OS light/dark preference, so it always reads like the approved mockup over
          the dark jewelry photo. */}
      <div className="theme-light-card relative mt-8 w-full max-w-sm">
        <Card>
          <CardContent className="pt-6">
            {/* Large, bold form heading above the email field (Owner request). */}
            <h1 className="mb-5 text-4xl font-bold tracking-tight text-foreground">
              Sign in
            </h1>
            <SignInForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
