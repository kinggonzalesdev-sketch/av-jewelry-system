'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/**
 * Minimal unsaved-changes registry (Owner 2026-09-05) — exists so the PWA update flow can NEVER
 * reload the page over an entry in progress (invoice, payment, walk-in sale, inventory edit…).
 *
 * Any component declares `useUnsavedChanges(isDirty)`; while at least one registration is dirty,
 * `hasUnsavedChanges()` is true and the browser's own leave-page warning is armed. The Modal
 * primitive registers every open `critical` dialog automatically (that is this app's existing
 * definition of "a half-filled entry"), so most forms are covered with no per-form wiring.
 *
 * Without the provider every hook is a no-op — primitives stay usable in isolation and in tests.
 */

type Registry = {
  /** Returns an unregister function. */
  register: (dirty: boolean) => () => void;
  hasUnsavedChanges: () => boolean;
};

const noop: Registry = {
  register: () => () => undefined,
  hasUnsavedChanges: () => false,
};
const Ctx = createContext<Registry>(noop);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  // A counter, not a boolean: several dirty forms can coexist (a modal over a page form).
  const dirtyCount = useRef(0);

  const register = useCallback((dirty: boolean) => {
    if (!dirty) return () => undefined;
    dirtyCount.current += 1;
    return () => {
      dirtyCount.current = Math.max(0, dirtyCount.current - 1);
    };
  }, []);
  const hasUnsavedChanges = useCallback(() => dirtyCount.current > 0, []);

  // The browser's native "Leave site?" guard, armed only while something is dirty. Not a custom
  // dialog — browsers ignore custom text, and the native one is the reliable last line.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyCount.current > 0) {
        e.preventDefault();
        e.returnValue = ''; // required by older Chromium/WebKit for the prompt to show
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const value = useMemo(
    () => ({ register, hasUnsavedChanges }),
    [register, hasUnsavedChanges],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Declare that this component currently holds unsaved work while `dirty` is true. */
export function useUnsavedChanges(dirty: boolean): void {
  const { register } = useContext(Ctx);
  useEffect(() => register(dirty), [register, dirty]);
}

/** Read the registry (for the update toast / diagnostics). */
export function useUnsavedChangesRegistry(): Registry {
  return useContext(Ctx);
}
