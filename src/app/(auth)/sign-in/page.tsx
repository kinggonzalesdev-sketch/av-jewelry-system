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
      {/* Same premium background as the landing hero: gradient fallback + jewelry
          video + dark overlay so the card stays readable. Video degrades to the
          gradient if it is missing or blocked. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gold/20 via-background to-background"
      />
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/hero-jewelry.jpg"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
      >
        <source src="/hero-jewelry.mp4" type="video/mp4" />
      </video>
      <div aria-hidden="true" className="absolute inset-0 bg-black/70" />

      {/* Logo pinned near the TOP with a little space above it (not vertically
          centered). Transparent PNG, no box behind it — sits on the dark page bg. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/av-jewelry-logo.png"
        alt="A.V. Jewelry"
        className="relative mt-2 block h-auto w-[240px] max-w-[72vw] object-contain sm:w-[320px]"
      />

      {/* Sign-in card sits just below the logo with the empty space pushed to the
          bottom, so on a normal-height screen it lands around the vertical middle. */}
      <div className="relative mt-8 w-full max-w-sm">
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
