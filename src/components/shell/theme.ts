/**
 * Manual Light/Dark theme — the honest, persistent version of the prototype's
 * day/night toggle.
 *
 * Production dark mode is OS-driven by default (prefers-color-scheme, see
 * globals.css). This adds a MANUAL override that wins over the OS preference and
 * persists across refreshes:
 *
 *   - no stored choice  → follow the OS (nothing is written to <html>)
 *   - stored 'light'     → force light  (`<html data-theme="light">`)
 *   - stored 'dark'      → force dark   (`<html data-theme="dark">`)
 *
 * The attribute is applied pre-paint by an inline script in the root layout so a
 * refresh never flashes the wrong theme. This module holds the pure pieces so the
 * toggle logic can be unit-tested without a DOM.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'av-theme';

/** The blocking script placed in <head> so the stored theme applies before paint. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}`;

/** Coerce arbitrary stored input to a valid theme, or null when unset/invalid. */
export function parseTheme(value: string | null | undefined): Theme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

/** The theme currently in effect: the manual choice if any, else the OS preference. */
export function effectiveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? 'dark' : 'light');
}

export const otherTheme = (theme: Theme): Theme => (theme === 'dark' ? 'light' : 'dark');
