'use client';

import { createPortal } from 'react-dom';
import { useEffect, useId } from 'react';

/**
 * Modal — the ONE standard dialog for the whole app. Every Create / Add / Edit /
 * View / Upload / Payment / Fulfillment / Scrap / Supplier / Financer / Customer
 * entry opens through this, so dialogs look and behave identically everywhere.
 *
 * It is the Orders → View modal's shell, generalised (same centered card, dark
 * overlay, portal, scroll-lock). Behaviour matches the standard:
 *   - Width 720–900px by `size`; 95% width on mobile; max-height 90vh with the
 *     body scrolling internally only when it overflows.
 *   - The overlay dims the page; clicking it closes a normal dialog but is
 *     DISABLED for a `critical` form (so a half-filled entry is never lost to a
 *     stray click). Escape likewise closes a normal dialog, not a critical one.
 *   - The ✕ and any Cancel button always close, critical or not.
 *
 * Rendered through a portal so it always stacks above the page, and the page
 * behind stays mounted — opening a dialog never navigates or loses list state.
 */

const WIDTH: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'sm:max-w-[720px]', // simple forms (few fields)
  md: 'sm:max-w-[820px]', // typical forms
  lg: 'sm:max-w-[900px]', // complex / two-column forms
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  critical = false,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** 'sm' 720 · 'md' 820 · 'lg' 900 — pick by form complexity. */
  size?: 'sm' | 'md' | 'lg';
  /** Critical forms ignore Escape and click-outside (only ✕ / Cancel close). */
  critical?: boolean;
  /** Bottom bar — primary action aligned bottom-right by convention. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();

  // Lock background scroll while open; close on Escape unless the form is critical.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !critical) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, critical, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      {...(title ? { 'aria-labelledby': titleId } : {})}
    >
      {/* Overlay — closes a normal dialog, inert for a critical one. */}
      {critical ? (
        <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      ) : (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          data-testid="modal-overlay"
          className="absolute inset-0 bg-black/50"
        />
      )}

      <div
        className={`relative z-10 flex max-h-[90vh] w-[95vw] flex-col overflow-hidden border border-border bg-card shadow-xl sm:w-full sm:rounded-xl ${WIDTH[size]}`}
        data-testid="modal"
      >
        {title || description ? (
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="text-base font-semibold text-foreground">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid="modal-close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground hover:bg-accent"
            >
              ✕
            </button>
          </div>
        ) : null}

        {/* Body — scrolls internally only when it overflows 90vh. */}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Standard form grid for modal bodies: a readable two-column layout on desktop
 * that collapses to one column on mobile. Inputs never stretch the full page —
 * they sit in these columns, so Price/Grams, Size/Supplier, etc. pair up.
 */
export function ModalFormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

/** A field that should span both columns (e.g. a name or a note). */
export function ModalFieldFull({ children }: { children: React.ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}
