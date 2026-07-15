import type { Metadata } from 'next';

import { SignInForm } from '@/app/(auth)/sign-in/sign-in-form';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign in — A.V. Jewelry Operations',
  robots: { index: false, follow: false },
};

/**
 * Staff sign-in (Bible §8.2: login exists outside authenticated navigation).
 *
 * There is NO public self-registration and NO customer login (ADR §4).
 * Staff accounts are created through an authorized internal administration process
 * (Bible §5.3, §30.5), which is not implemented in Phase 0.
 */
export default function SignInPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Staff sign-in</CardTitle>
            <CardDescription>
              Internal staff access only. Accounts are issued by the Owner or an
              authorized administrator — there is no public registration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignInForm />
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Phase 0 foundation. This system is not production-ready.
        </p>
      </div>
    </main>
  );
}
