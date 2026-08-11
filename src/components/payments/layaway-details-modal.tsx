'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import {
  findOrCreateFinancerAction,
  setLayawayDetailsAction,
} from '@/lib/payments/actions';
import {
  EMPTY_PAYMENT_STATE,
  type PaymentActionState,
} from '@/lib/payments/action-state';
import type { Financer } from '@/lib/payments/financer';
import type { LayawayRow } from '@/lib/payments/workspace';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFormGrid } from '@/components/ui/modal';

/**
 * Edit a layaway's financer, current holder/location, and remarks (spec §14) in
 * the standard modal. Financer ≠ supplier; "OK" belongs in Remarks. Gated on
 * layaway_monitoring — the server re-checks and the DB RLS enforces it.
 */
export function LayawayDetailsModal({
  row,
  financers,
}: {
  row: LayawayRow;
  financers: Financer[];
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, saving] = useActionState<PaymentActionState, FormData>(
    setLayawayDetailsAction,
    EMPTY_PAYMENT_STATE,
  );

  // Financer is a searchable pick-OR-type field. The typed/selected NAME lives in
  // state; the resolved financer id is written into the hidden input at save time,
  // creating (deduped) the financer first if the name is new.
  const [financerInput, setFinancerInput] = useState(row.financer ?? '');
  const [resolving, setResolving] = useState(false);
  const [financerError, setFinancerError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const financerIdRef = useRef<HTMLInputElement | null>(null);

  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
    }
  }, [state.success]);

  const formId = `layaway-details-${row.layawayId}`;

  // Resolve the financer to an id (matching existing, or find-or-create), stamp the
  // hidden input, then submit the form. Empty = clear the financer.
  const handleSave = async () => {
    setFinancerError(null);
    const typed = financerInput.trim();
    let financerId = '';
    if (typed) {
      const match = financers.find(
        (f) => f.name.trim().toLowerCase() === typed.toLowerCase(),
      );
      if (match) {
        financerId = match.id;
      } else {
        setResolving(true);
        const res = await findOrCreateFinancerAction(typed);
        setResolving(false);
        if (!res.ok) {
          setFinancerError(res.error);
          return;
        }
        financerId = res.financer.id;
      }
    }
    if (financerIdRef.current) financerIdRef.current.value = financerId;
    formRef.current?.requestSubmit();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`layaway-details-${row.layawayId}`}
        className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent"
      >
        Edit details
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Layaway details"
        description="Financer, current holder / location, and remarks. Financer is not a supplier."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || resolving}
            >
              {saving || resolving ? 'Saving…' : 'Save details'}
            </Button>
          </>
        }
      >
        <form ref={formRef} id={formId} action={submit} className="space-y-3">
          <input type="hidden" name="layawayArrangementId" value={row.layawayId} />
          <input
            ref={financerIdRef}
            type="hidden"
            name="financerId"
            defaultValue={row.financerId ?? ''}
          />
          <ModalFormGrid>
            <div>
              <Label htmlFor={`fin-${row.layawayId}`} className="text-xs">
                Financer
              </Label>
              <Combobox
                id={`fin-${row.layawayId}`}
                value={financerInput}
                onChange={setFinancerInput}
                options={financers.map((f) => f.name)}
                placeholder="Select a financer… or type a new name"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
              />
              {financerError ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {financerError}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor={`hold-${row.layawayId}`} className="text-xs">
                Current holder
              </Label>
              <Input
                id={`hold-${row.layawayId}`}
                name="currentHolder"
                defaultValue={row.currentHolder ?? ''}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor={`loc-${row.layawayId}`} className="text-xs">
                Current location
              </Label>
              <Input
                id={`loc-${row.layawayId}`}
                name="currentLocation"
                defaultValue={row.currentLocation ?? ''}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor={`rem-${row.layawayId}`} className="text-xs">
                Remarks
              </Label>
              <Input
                id={`rem-${row.layawayId}`}
                name="remarks"
                defaultValue={row.remarks ?? ''}
                placeholder="e.g. OK"
                className="mt-1 h-9"
              />
            </div>
          </ModalFormGrid>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
