import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`; the old name still
 * works but emits a deprecation warning, so this project adopts the current convention.
 *
 * ⚠️  This runs at the edge and is a session-refresh/UX layer plus defense in depth —
 *     it is NOT the security control. Authorization is enforced at the trusted
 *     server/data boundary (ADR §7): each protected layout re-verifies the session
 *     server-side, and RLS backs it at the data layer.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match every request path except:
     *  - _next/static, _next/image  (build assets)
     *  - favicon.ico
     *  - common static image files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
