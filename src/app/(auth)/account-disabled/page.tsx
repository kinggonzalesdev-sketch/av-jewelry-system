import type { Metadata } from 'next';

import { SignOutButton } from '@/components/shell/sign-out-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Account-access-disabled state (Bible §30.6).
 *
 * Reached when the credentials are valid but the ACCOUNT is not: it has been
 * deactivated, or the signed-in user has no staff profile at all (there is no
 * customer login, so such a user is not an application user).
 *
 * Deliberately does not say which of those it is, and gives no reason: an account
 * holder who has lost access should learn that from a person, not from a screen
 * that could equally be probed by someone who should not be here.
 *
 * A disabled account loses FUTURE access; its history remains fully attributable.
 */
export default function AccountDisabledPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Access disabled</CardTitle>
            <CardDescription>
              This account cannot access the system. If you believe this is a mistake,
              contact the Owner or an authorized administrator.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your sign-in was valid, but the account is not active.
            </p>
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
