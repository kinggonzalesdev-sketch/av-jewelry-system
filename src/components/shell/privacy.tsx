'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useMounted } from '@/components/shell/use-mounted';
import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Privacy Mode (Privacy-Mode spec §1–§11) — a per-user, screen-only display
 * preference that instantly masks sensitive financial + customer information when
 * someone else is looking at the screen.
 *
 * Honesty + scope invariants:
 *   - It changes ONLY what is DISPLAYED. It never changes data, permissions, or
 *     what the user may do (§11). It is not a security control.
 *   - It must NOT affect printing or export (§10): those read the underlying data,
 *     not these components, so they are unaffected by design.
 *   - Toggling re-renders every consumer instantly — no page refresh (§12).
 *   - The choice persists per browser (localStorage) while the user is logged in.
 *
 * The default context value (hidden = false) makes consumers safe to render
 * WITHOUT a provider (e.g. isolated unit tests) — they simply show real values.
 */

const STORAGE_KEY = 'av-privacy-mode';
const MONEY_MASK = '₱••••••';
const TEXT_MASK = '•••••••';

type PrivacyContextValue = { hidden: boolean; toggle: () => void };

const PrivacyContext = createContext<PrivacyContextValue>({
  hidden: false,
  toggle: () => {},
});

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  // `useMounted` (useSyncExternalStore) lets us read localStorage without a
  // hydration mismatch and without a setState-in-effect. Server + hydration paint
  // as visible (false); once mounted we adopt the stored preference. A toggle this
  // session takes precedence via `override`.
  const mounted = useMounted();
  const [override, setOverride] = useState<boolean | null>(null);
  const hidden = override ?? (mounted ? readStored() : false);

  const toggle = useCallback(() => {
    setOverride((prev) => {
      const current = prev ?? readStored();
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Storage disabled — the toggle still applies for this view.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}

/**
 * Returns a formatter that masks money to `₱••••••` in Privacy Mode, for use in
 * string contexts (table cells, chart labels) where a `<Money>` element does not
 * fit. Screen-only — export/print read the underlying data, not this.
 */
export function usePrivacyMoney(): (amount: string) => string {
  const { hidden } = usePrivacy();
  return (amount: string) => (hidden ? MONEY_MASK : formatPeso(amount));
}

/** Partially masks a contact number: keeps the first 4 and last 3 digits
 *  (e.g. "0917-123-4567" → "0917••••567"). Falls back to a full mask when there
 *  are too few digits to partially reveal. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) return TEXT_MASK;
  return `${digits.slice(0, 4)}••••${digits.slice(-3)}`;
}

/**
 * A monetary value that hides to `₱••••••` in Privacy Mode (§2). `amount` is the
 * authoritative string; when visible it is formatted with the shared formatter,
 * never a JS float.
 */
export function Money({
  amount,
  className,
}: {
  amount: string;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  const real = formatPeso(amount);
  if (!hidden) {
    return <span className={cn('tabular-nums', className)}>{real}</span>;
  }
  // Masked on SCREEN, but the real value is still emitted for PRINT (§10: Privacy
  // Mode never affects printing) — kept display:none on screen, inline on print.
  return (
    <span className={cn('tabular-nums', className)} data-sensitive="money">
      <span className="print:hidden">{MONEY_MASK}</span>
      <span className="hidden print:inline">{real}</span>
    </span>
  );
}

/**
 * Generic sensitive text (address, email, messenger id, etc.) that hides to dots
 * in Privacy Mode (§3). Pass an already-formatted child; when hidden it is
 * replaced entirely by the mask.
 */
export function Sensitive({
  children,
  mask = TEXT_MASK,
  className,
}: {
  children: ReactNode;
  mask?: string;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  if (!hidden) return <span className={className}>{children}</span>;
  return (
    <span className={className} data-sensitive="text">
      <span className="print:hidden">{mask}</span>
      <span className="hidden print:inline">{children}</span>
    </span>
  );
}

/** A contact number that partially masks in Privacy Mode (§3). */
export function SensitivePhone({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const { hidden } = usePrivacy();
  if (!hidden) return <span className={className}>{value}</span>;
  return (
    <span className={className} data-sensitive="phone">
      <span className="print:hidden">{maskPhone(value)}</span>
      <span className="hidden print:inline">{value}</span>
    </span>
  );
}

/**
 * The eye / eye-off toggle for the app chrome (§1). Mirrors the ThemeToggle's two
 * shells so it sits naturally in the sidebar footer and the compact mobile header.
 */
export function PrivacyToggle({
  variant = 'sidebar',
}: {
  variant?: 'sidebar' | 'compact';
}) {
  const { hidden, toggle } = usePrivacy();
  const label = hidden ? 'Show sensitive info' : 'Hide sensitive info';
  const glyph = hidden ? '🙈' : '👁';

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={hidden}
        aria-label={label}
        title={label}
        data-testid="privacy-toggle"
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
      aria-pressed={hidden}
      title={label}
      data-testid="privacy-toggle"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
        {glyph}
      </span>
      <span>{label}</span>
    </button>
  );
}
