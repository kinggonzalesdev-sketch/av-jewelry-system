'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { findCustomerMatchesAction } from '@/lib/customers/matching-actions';
import { mergeCustomerAction } from '@/lib/customers/actions';
import type { CustomerMatch } from '@/lib/customers/matching-types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Owner-only "Merge" for a customer (2026-08-09, "merge lang sa correct Facebook
 * name"). Open it on the record with the CORRECT name — it lists the other same/
 * similar-name customers, and merging one folds ALL its orders/layaway/claims/etc.
 * into THIS record, keeps the old name as a searchable alias, and deactivates the
 * duplicate. Nothing is deleted (reversible). Every merge re-checks Owner in the DB.
 */
export function CustomerMergeButton({
  survivorId,
  survivorName,
}: {
  survivorId: string;
  survivorName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CustomerMatch[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await findCustomerMatchesAction({ name: survivorName });
      setCandidates(res.candidates.filter((c) => c.customerId !== survivorId));
    } catch {
      setError('Could not load possible duplicates.');
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    setOpen(true);
    setConfirmId(null);
    setNote(null);
    void load();
  };

  const doMerge = async (dupId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await mergeCustomerAction(survivorId, dupId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNote(
      `Merged — moved ${res.ordersMoved} order(s), ${res.layawaysMoved} layaway(s), ${res.claimsMoved} claim(s) into ${survivorName}.`,
    );
    setCandidates((cur) => cur.filter((c) => c.customerId !== dupId));
    setConfirmId(null);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        data-testid={`customer-merge-${survivorId}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        Merge
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Merge duplicates"
        description={`Fold other records INTO "${survivorName}". Their orders move here; the duplicate is deactivated (reversible).`}
        size="sm"
      >
        <div className="space-y-3" data-testid="customer-merge-body">
          {note ? (
            <p className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-2 py-1.5 text-xs text-emerald-700">
              {note}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted-foreground">Finding possible duplicates…</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other same-name customers found.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li
                  key={c.customerId}
                  className="rounded-md border border-border px-2 py-1.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{c.displayName}</span>
                      {c.contactNumber ? (
                        <span className="text-muted-foreground"> · {c.contactNumber}</span>
                      ) : null}
                      {c.hasConversation ? (
                        <span className="text-emerald-600"> · FB ✓</span>
                      ) : null}
                    </div>
                    {confirmId !== c.customerId ? (
                      <button
                        type="button"
                        onClick={() => setConfirmId(c.customerId)}
                        data-testid={`customer-merge-pick-${c.customerId}`}
                        className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
                      >
                        Merge in
                      </button>
                    ) : null}
                  </div>

                  {confirmId === c.customerId ? (
                    <div className="mt-1.5 space-y-1.5 border-t border-border pt-1.5">
                      <p className="text-xs text-muted-foreground">
                        Move all of <strong>{c.displayName}</strong>&apos;s records into{' '}
                        <strong>{survivorName}</strong> and deactivate it? This is reversible.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmId(null)}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void doMerge(c.customerId)}
                          disabled={busy}
                          data-testid={`customer-merge-confirm-${c.customerId}`}
                        >
                          {busy ? 'Merging…' : 'Confirm merge'}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
