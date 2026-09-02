import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/app/(auth)/reset-password/reset-password-form';
import { Card, CardContent } from '@/components/ui/card';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Forgot password / reset (Owner 2026-09-02). Public, unauthenticated route — reachable from
 * the "Forgot password?" link on sign-in. Uses Supabase Auth's native email-OTP recovery.
 * Same card design as sign-in (Owner: match the app, do not redesign).
 */
export default function ResetPasswordPage() {
  return (
    <main
      id="main-content"
      className="relative flex min-h-dvh flex-col items-center overflow-hidden px-4 py-6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/av-jewelry-signinbg.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-black/30" />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/av-jewelry-logo.png"
        alt="A.V. Jewelry"
        className="relative mt-2 block h-auto w-[240px] max-w-[72vw] object-contain sm:w-[320px]"
      />

      <div className="theme-light-card relative mt-8 w-full max-w-sm">
        <Card>
          <CardContent className="pt-6">
            <h1 className="mb-5 text-4xl font-bold tracking-tight text-foreground">
              Reset password
            </h1>
            <ResetPasswordForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
