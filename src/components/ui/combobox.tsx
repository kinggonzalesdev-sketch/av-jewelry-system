'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Combobox — a searchable, always-clickable picker that replaces the native
 * <datalist>. The datalist has one flaw the Owner hit: once a value is selected,
 * it filters to only that one match, so you can't re-open the full list. This
 * shows ALL options when the field is empty OR already holds a full selection, and
 * filters only while you actively type. Click the field (or the ▾) any time — even
 * with a value set — to see and pick a different option. Free text is allowed, so
 * "pick OR type a new one" still works; the parent derives the match/id as before.
 */
export type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Optional form field name — set it when the visible text IS the submitted
   *  value (e.g. Walk-In customer name). Omit when a hidden input carries it. */
  name?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  required?: boolean;
  'data-testid'?: string;
};

export function Combobox({
  value,
  onChange,
  options,
  name,
  id,
  placeholder,
  className,
  required,
  ...rest
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = value.trim().toLowerCase();
  const exact = options.some((o) => o.toLowerCase() === q);
  // Show everything when empty or when a full selection is in place; otherwise
  // filter by what the user is typing.
  const filtered = q === '' || exact ? options : options.filter((o) => o.toLowerCase().includes(q));

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        className={cn('pr-9', className)}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show options"
        onClick={() => setOpen((o) => !o)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        ▾
      </button>
      {open && filtered.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-lg"
        >
          {filtered.map((opt) => (
            <li
              key={opt}
              role="option"
              aria-selected={opt === value}
              // mousedown (not click) so the option is chosen before the input blurs.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(opt);
                setOpen(false);
              }}
              className={cn(
                'cursor-pointer px-3 py-1.5 hover:bg-accent',
                opt === value && 'bg-accent/60',
              )}
            >
              {opt}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
