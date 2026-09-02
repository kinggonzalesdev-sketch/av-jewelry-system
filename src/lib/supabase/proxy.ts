import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getClientEnv } from '@/lib/env';
import { toSessionCookie } from '@/lib/supabase/cookies';
import { createRetryingFetch } from '@/lib/supabase/retry-fetch';

/**
 * Session refresh + unauthenticated redirect (ADR §6).
 *
 * Runs on every matched request (via `src/proxy.ts`) to keep the Supabase session
 * cookie fresh and to bounce unauthenticated visitors away from internal routes.
 *
 * ⚠️  This is a convenience/UX boundary and a defense-in-depth layer — it is NOT the
 *     security control. It must never be the only thing standing between a user and
 *     data: every protected page independently revalidates the session server-side
 *     (`requireUser`), and RLS backs that at the data layer (ADR §8). Treating this
 *     edge check as sufficient would be exactly the "authorized only at the edge"
 *     mistake the ADR prohibits.
 */

/**
 * Routes reachable without a session. Everything else is internal and protected.
 *
 * `/account-disabled` is listed because a signed-in user with a deactivated
 * account must be able to see WHY they are blocked and sign out. It is not a
 * public page — it renders nothing sensitive and reveals no reason.
 */
// '/' is the public landing page (marketing). Because isPublicRoute matches
// `pathname === route`, only the EXACT root is public — every other path stays
// protected and unauthenticated visitors are still sent to sign-in.
const PUBLIC_ROUTES = ['/', '/sign-in', '/account-disabled', '/reset-password'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Routes that authenticate WITHOUT the session cookie this proxy manages must be
  // bypassed, or the cookie check finds no cookie and 307-redirects them to /sign-in:
  //   - /api/mobile/*  — the MineFlow Capture app sends a Supabase Bearer token,
  //     verified in-handler by resolveMobileStaff.
  //   - /api/cron/*    — Vercel Cron sends `Authorization: Bearer $CRON_SECRET`,
  //     verified in-handler; a redirect here would stop the cron ever running.
  // (The matcher also excludes both; this guard keeps the behaviour correct even if
  // the matcher is ever narrowed.)
  if (
    request.nextUrl.pathname.startsWith('/api/mobile/') ||
    request.nextUrl.pathname.startsWith('/api/cron/')
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // The per-request session refresh (`getUser` below) runs on every navigation.
      // Retry a transient network blip for idempotent GET/HEAD reads so a one-off
      // hiccup doesn't fail the whole request right after sign-in. Never retries a
      // write — see retry-fetch.ts.
      global: { fetch: createRetryingFetch() },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, toSessionCookie(options));
          }
        },
      },
    },
  );

  // `getUser()` revalidates the token with the Auth server. Do not replace this with
  // `getSession()`, which trusts the cookie without verification.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicRoute(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/sign-in';
    redirectUrl.searchParams.set('redirectedFrom', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Staff ALWAYS pass through the sign-in section (Owner request 2026-07-25): an
  // already-signed-in visitor to /sign-in is NOT bounced to the dashboard — the
  // sign-in page is shown every time, so entering the app always goes through it.
  // (Protected pages still redirect the UNauthenticated to sign-in, above.)

  return supabaseResponse;
}
