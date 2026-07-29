'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * MoneyInput — the ONE shared currency input for the whole system. It formats the
 * amount with thousand separators live as the user types, keeps the caret stable,
 * shows `₱` as a prefix beside the field (never inside the value), and SUBMITS the
 * RAW numeric value (no commas) via a hidden input so FormData / calculations stay
 * numeric. Display-only formatting — it changes no stored value or calculation.
 *
 * Accepts digits and one decimal point (max two decimals); rejects letters,
 * negatives, and extra dots. Works both uncontrolled (name + defaultValue, the
 * FormData pattern) and controlled (value + onValueChange).
 */

/** Keep only digits and a single decimal point, max two decimal places. */
export function sanitizeMoney(input: string): string {
  let s = input.replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    // drop any further dots
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    s = s.slice(0, firstDot + 3); // one dot + up to two decimals
  }
  return s;
}

/** Group the integer part with commas; keep the decimal part exactly as typed. */
function formatWithCommas(raw: string): string {
  if (raw === '') return '';
  const [whole = '', frac] = raw.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** The clean value to submit/store: raw without a trailing dot. */
function toSubmitValue(raw: string): string {
  return raw.endsWith('.') ? raw.slice(0, -1) : raw;
}

function digitsBefore(str: string, pos: number): number {
  let count = 0;
  for (let i = 0; i < pos && i < str.length; i++) {
    if (str[i] === '.' || /\d/.test(str[i] ?? '')) count++;
  }
  return count;
}

/** Index in `str` just after the Nth significant char (digit or dot). */
function indexAfterSignificant(str: string, n: number): number {
  if (n <= 0) return 0;
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i] ?? '';
    if (c === '.' || /\d/.test(c)) {
      count++;
      if (count === n) return i + 1;
    }
  }
  return str.length;
}

export type MoneyInputProps = {
  /** Hidden input name — the RAW value submitted with the form (no commas). */
  name?: string;
  id?: string;
  /** Controlled raw value (no commas). */
  value?: string;
  /** Uncontrolled initial raw value (no commas). */
  defaultValue?: string;
  onValueChange?: (raw: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
};

export function MoneyInput({
  name,
  id,
  value,
  defaultValue = '',
  onValueChange,
  placeholder,
  className,
  required,
  disabled,
  autoFocus,
  ...rest
}: MoneyInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const isControlled = value !== undefined;
  const [rawState, setRawState] = useState(() => sanitizeMoney(String(defaultValue ?? '')));
  const raw = isControlled ? sanitizeMoney(String(value ?? '')) : rawState;
  const display = formatWithCommas(raw);

  // Restore the caret AFTER the formatted value renders (only following an edit).
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      const pos = indexAfterSignificant(inputRef.current.value, pendingCaret.current);
      inputRef.current.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    pendingCaret.current = digitsBefore(el.value, el.selectionStart ?? el.value.length);
    const newRaw = sanitizeMoney(el.value);
    if (!isControlled) setRawState(newRaw);
    onValueChange?.(newRaw);
  };

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
      >
        ₱
      </span>
      <Input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        // The left padding that clears the ₱ prefix must come AFTER className:
        // callers pass their own `px-*`, and tailwind-merge lets the last class
        // win, so ordered first the padding would be overridden and the value
        // would sit right under the peso sign. Ordered last, it always keeps the
        // gap regardless of the caller's field styling.
        className={cn(className, 'pl-8')}
        {...rest}
      />
      {name ? <input type="hidden" name={name} value={toSubmitValue(raw)} /> : null}
    </div>
  );
}
