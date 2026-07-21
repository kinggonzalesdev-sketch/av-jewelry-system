import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getClientEnv } from '@/lib/env';

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
const PUBLIC_ROUTES = ['/', '/sign-in', '/account-disabled'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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
            supabaseResponse.cookies.set(name, value, options);
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

  if (user && pathname === '/sign-in') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
