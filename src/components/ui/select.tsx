'use client';

import { cn } from '@/lib/utils';

/**
 * Select — the ONE styled dropdown for the whole system. A thin wrapper over the
 * native <select> so every module shares the same height (h-9), border, radius, focus
 * ring, and chevron, instead of each page re-styling a raw <select>. Pass <option>s as
 * children and any native select props (value/onChange/name/required/disabled).
 */
export function Select({
  className,
  children,
  ...props
}: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-border bg-background px-3 pr-8 text-sm text-foreground outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
      >
        ▾
      </span>
    </div>
  );
}
