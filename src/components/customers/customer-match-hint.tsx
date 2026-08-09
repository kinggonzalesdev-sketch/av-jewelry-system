'use client';

import { useEffect, useState } from 'react';

import { findCustomerMatchesAction } from '@/lib/customers/matching-actions';
import type { CustomerMatch, CustomerMatchOutcome } from '@/lib/customers/matching-types';

/**
 * Reusable customer-match hint (spec §1/§3) — drop it under any customer-name input on
 * Orders, Walk-In, Layaway, or Customer editing. As the operator types it looks up
 * existing MineFlow customers (debounced, RLS-scoped) and shows, honestly:
 *   - a high-confidence auto-match with its Facebook-linked state, or
 *   - several possible matches (pick one to avoid a duplicate), or
 *   - nothing when the name is new.
 *
 * PICKABLE (Owner request 2026-08-09): when `onPick` is passed (Orders / Layaway), each
 * listed person is a CLICKABLE button — tapping one calls `onPick(match)` so the form
 * can fill that EXACT existing customer, which links the order/layaway to them and
 * prevents a duplicate. Without `onPick` (Customer editing) it stays a read-only hint —
 * it never changes the form on its own there.
 */
export function CustomerMatchHint({
  name,
  phone,
  excludeCustomerId,
  className,
  onPick,
}: {
  name: string;
  phone?: string | null;
  /** Omit this customer from the results — used in Customer editing so a record never
   *  "matches itself" (only real duplicates surface). */
  excludeCustomerId?: string;
  className?: string;
  /** When given, the matches become clickable; picking one hands the chosen existing
   *  customer back so the caller can reuse it (no duplicate). Omit for a read-only hint. */
  onPick?: (match: CustomerMatch) => void;
}) {
  const [raw, setRaw] = useState<CustomerMatchOutcome | null>(null);

  useEffect(() => {
    const q = name.trim();
    let alive = true;
    // Debounced; all state is set inside the async callback (never synchronously in
    // the effect body).
    const t = setTimeout(() => {
      if (!alive) return;
      if (q.length < 2) {
        setRaw(null);
        return;
      }
      findCustomerMatchesAction({ name: q, phone: phone ?? null })
        .then((res) => {
          if (alive) setRaw(res);
        })
        .catch(() => {
          if (alive) setRaw(null);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [name, phone]);

  if (!raw) return null;

  // Drop the edited customer itself (so it never "matches itself"). Recompute the
  // auto-match on the filtered set: only a single remaining high-confidence match
  // auto-selects.
  const candidates = excludeCustomerId
    ? raw.candidates.filter((c) => c.customerId !== excludeCustomerId)
    : raw.candidates;
  if (candidates.length === 0) return null;

  const highs = candidates.filter((c) => c.confidence === 'high');
  const auto = highs.length === 1 ? highs[0]! : null;
  const pickable = typeof onPick === 'function';

  /** The Facebook-linked flag, shown the same way in every row. */
  const fbTag = (c: CustomerMatch) =>
    c.hasConversation ? <span className="text-green-700">· FB ✓</span> : null;

  return (
    <div className={className} data-testid="customer-match-hint">
      {auto ? (
        <div
          className="rounded-md border border-green-600/40 bg-green-600/10 px-2 py-1 text-[11px] text-green-700"
          data-testid="customer-match-auto"
        >
          <p>
            Matches existing customer <strong>{auto.displayName}</strong>
            {auto.hasConversation ? (
              <span className="ml-1 font-semibold">· Facebook linked ✓</span>
            ) : (
              <span className="ml-1 text-muted-foreground">· no Facebook chat linked yet</span>
            )}
            . Reusing this customer avoids a duplicate.
          </p>
          {pickable ? (
            <button
              type="button"
              onClick={() => onPick(auto)}
              data-testid={`customer-match-pick-${auto.customerId}`}
              className="mt-1 rounded border border-green-600/50 bg-green-600/10 px-2 py-0.5 text-[11px] font-semibold text-green-800 hover:bg-green-600/20"
            >
              Use this customer
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800"
          data-testid="customer-match-multi"
        >
          {candidates.length} possible match(es) —{' '}
          {pickable
            ? 'tap the correct person to use them (avoids a duplicate):'
            : 'confirm which person this is to avoid a duplicate:'}
          <ul className="mt-0.5 space-y-0.5">
            {candidates.slice(0, 4).map((c) =>
              pickable ? (
                <li key={c.customerId}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    data-testid={`customer-match-pick-${c.customerId}`}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-amber-500/20"
                  >
                    <span className="font-medium">{c.displayName}</span>
                    {c.contactNumber ? (
                      <span className="text-muted-foreground">· {c.contactNumber}</span>
                    ) : null}
                    {fbTag(c)}
                    <span className="ml-auto text-[10px] font-semibold text-amber-700">Use →</span>
                  </button>
                </li>
              ) : (
                <li key={c.customerId} className="flex items-center gap-1">
                  <span className="font-medium">{c.displayName}</span>
                  {c.contactNumber ? (
                    <span className="text-muted-foreground">· {c.contactNumber}</span>
                  ) : null}
                  {fbTag(c)}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
