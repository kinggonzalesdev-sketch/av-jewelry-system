'use client';

import { useState } from 'react';

import {
  effectiveTheme,
  otherTheme,
  parseTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from '@/components/shell/theme';
import { useMounted } from '@/components/shell/use-mounted';
import { cn } from '@/lib/utils';

/**
 * Manual Light/Dark toggle. Reads the theme in effect on mount, flips it on
 * click, and persists the choice to localStorage (applied pre-paint on the next
 * load by the root-layout init script). See {@link file://./theme.ts}.
 *
 * Renders a stable, theme-agnostic label until mounted so server and client
 * markup match; the effective theme is only knowable in the browser.
 */
export function ThemeToggle({
  variant = 'sidebar',
}: {
  variant?: 'sidebar' | 'compact';
}) {
  const mounted = useMounted();
  // The user's explicit choice this session, if any. Before mount and before any
  // toggle, the theme is read directly from the client (localStorage + OS).
  const [override, setOverride] = useState<Theme | null>(null);

  function currentClientTheme(): Theme {
    const stored = parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
    return effectiveTheme(
      stored,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
  }

  const theme: Theme | null = override ?? (mounted ? currentClientTheme() : null);

  function toggle() {
    const next = otherTheme(theme ?? 'light');
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-mode / storage-disabled: the toggle still works for this view.
    }
    setOverride(next);
  }

  const isDark = theme === 'dark';
  // Action label: the toggle names the mode it will switch TO.
  const actionLabel =
    theme === null ? 'Toggle theme' : isDark ? 'Light mode' : 'Dark mode';
  const glyph = theme === null ? '◑' : isDark ? '☀' : '☾';

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={theme === null ? undefined : isDark}
        aria-label={actionLabel}
        title={actionLabel}
        data-testid="theme-toggle"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground"
      >
        <span aria-hidden="true">{glyph}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === null ? undefined : isDark}
      title={actionLabel}
      data-testid="theme-toggle"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
        {glyph}
      </span>
      <span>{actionLabel}</span>
    </button>
  );
}
