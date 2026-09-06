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
     *  - preview/**  (the UI prototype)
     *  - api/mobile/**  (Bearer-token endpoints for the MineFlow Capture app —
     *    they verify their own token in-handler and must NOT be redirected to
     *    /sign-in by the cookie-based session check)
     *  - api/cron/**  (Vercel Cron endpoints — authenticated in-handler by
     *    CRON_SECRET, not the session cookie; a redirect would stop the cron)
     *  - api/webhooks/**  (inbound provider webhooks, e.g. Pancake — authenticated
     *    in-handler by a shared secret, not the session cookie. The caller has no
     *    session, so a redirect to /sign-in (307) would stop every webhook.)
     *
     * `preview` is excluded deliberately. The prototype holds only sample data,
     * touches no database, and makes no authorization decision — running the
     * session proxy over it would force a Supabase connection just to look at
     * static screens. It is guarded instead by its own layout, which returns 404
     * when NODE_ENV is production, so it can never be served from a production
     * build. Excluding it here therefore widens no production surface.
     */
    // `manifest.webmanifest` is excluded because the browser fetches it WITHOUT credentials
    // when offering "Add to Home Screen" / launching the installed app. Under the proxy it
    // 307s to /sign-in and the install silently breaks. It carries only public metadata
    // (app name, colours, icon paths) and makes no authorization decision, so excluding it
    // widens no production surface — same reasoning as the static assets beside it.
    // `sw.js`, `offline` and `pwa-icon/*` are excluded for the same reason: the service worker
    // fetches them WITHOUT a session (install-time precache, offline fallback, launcher icons).
    // All three are static/public and carry no business data (Owner 2026-09-05).
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|offline|pwa-icon|preview|api/mobile|api/cron|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
