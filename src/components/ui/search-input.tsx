'use client';

import { cn } from '@/lib/utils';

/**
 * SearchInput — the shared search box: a leading magnifier, a clear (✕) button when
 * there is text, and the same height/border/focus as every other control. Controlled
 * (value + onChange). Use for every list search so search bars look identical system-wide.
 */
export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = 'Search…',
  className,
  id,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  onClear?: (() => void) | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
  id?: string | undefined;
  'aria-label'?: string | undefined;
  'data-testid'?: string | undefined;
}) {
  return (
    <div className={cn('relative', className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
      >
        ⌕
      </span>
      <input
        id={id}
        type="text"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm text-foreground outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        {...rest}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => (onClear ? onClear() : onChange(''))}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
