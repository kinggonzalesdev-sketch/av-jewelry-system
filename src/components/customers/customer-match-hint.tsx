'use client';

import { useEffect, useState } from 'react';

import { findCustomerMatchesAction } from '@/lib/customers/matching-actions';
import type { CustomerMatchOutcome } from '@/lib/customers/matching-types';

/**
 * Reusable customer-match hint (spec §1/§3) — drop it under any customer-name input on
 * Orders, Walk-In, Layaway, or Customer editing. As the operator types it looks up
 * existing MineFlow customers (debounced, RLS-scoped) and shows, honestly:
 *   - a high-confidence auto-match with its Facebook-linked state, or
 *   - several possible matches (pick one to avoid a duplicate), or
 *   - nothing when the name is new.
 * Read-only — it never changes the form or links anything on its own; it just makes the
 * operator aware, so the SAME matching logic surfaces the same way everywhere.
 */
export function CustomerMatchHint({
  name,
  phone,
  excludeCustomerId,
  className,
}: {
  name: string;
  phone?: string | null;
  /** Omit this customer from the results — used in Customer editing so a record never
   *  "matches itself" (only real duplicates surface). */
  excludeCustomerId?: string;
  className?: string;
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

  return (
    <div className={className} data-testid="customer-match-hint">
      {auto ? (
        <p
          className="rounded-md border border-green-600/40 bg-green-600/10 px-2 py-1 text-[11px] text-green-700"
          data-testid="customer-match-auto"
        >
          Matches existing customer <strong>{auto.displayName}</strong>
          {auto.hasConversation ? (
            <span className="ml-1 font-semibold">· Facebook linked ✓</span>
          ) : (
            <span className="ml-1 text-muted-foreground">· no Facebook chat linked yet</span>
          )}
          . Reusing this customer avoids a duplicate.
        </p>
      ) : (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800"
          data-testid="customer-match-multi"
        >
          {candidates.length} possible match(es) — confirm which person this is to
          avoid a duplicate:
          <ul className="mt-0.5 space-y-0.5">
            {candidates.slice(0, 4).map((c) => (
              <li key={c.customerId} className="flex items-center gap-1">
                <span className="font-medium">{c.displayName}</span>
                {c.contactNumber ? (
                  <span className="text-muted-foreground">· {c.contactNumber}</span>
                ) : null}
                {c.hasConversation ? <span className="text-green-700">· FB ✓</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
