'use client';

import { useEffect, useRef } from 'react';

import { signOut } from '@/lib/auth/actions';

/**
 * Idle-timeout auto sign-out (Owner request 2026-07-28). After a period of no user
 * activity the session is signed out and the browser is returned to /sign-in, so an
 * unattended terminal cannot be used by someone else. Any real activity (mouse,
 * keys, touch, scroll, tab focus) resets the timer. Combined with session-only
 * cookies, a closed OR idle browser always requires signing in again.
 *
 * This is a convenience/safety layer only — the real controls remain server-side
 * session revalidation + RLS. It only runs inside the authenticated app shell.
 */
export function IdleLogout({ minutes = 30 }: { minutes?: number }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    const ms = Math.max(1, minutes) * 60 * 1000;

    const logout = () => {
      if (fired.current) return;
      fired.current = true;
      void signOut();
    };
    const reset = () => {
      if (fired.current) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(logout, ms);
    };

    const events = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
      'visibilitychange',
    ] as const;
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();

    return () => {
      for (const e of events) window.removeEventListener(e, reset);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [minutes]);

  return null;
}
