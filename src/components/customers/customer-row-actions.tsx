'use client';

import { useEffect, useRef, useState, useActionState } from 'react';
import { useRouter } from 'next/navigation';

import { permanentlyDeleteCustomerAction } from '@/lib/customers/actions';
import {
  EMPTY_CUSTOMER_STATE,
  type CustomerActionState,
} from '@/lib/customers/action-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Row action for a customer (Owner/Admin only): a permanent Delete. Deletion is
 * irreversible, so it opens a confirmation modal that requires typing DELETE to
 * enable the button. The database refuses to delete a customer with any linked
 * transaction record (every FK is RESTRICT), so an in-use customer can never be
 * removed — the modal surfaces that block honestly. (The "View" details control
 * lives in the list itself.)
 */
export function CustomerRowActions({
  customerId,
  customerName,
  canManage,
}: {
  customerId: string;
  customerName: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [state, submit, pending] = useActionState<CustomerActionState, FormData>(
    permanentlyDeleteCustomerAction,
    EMPTY_CUSTOMER_STATE,
  );

  // Close + refresh once a delete succeeds (once per new success).
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <>
      {canManage ? (
        <button
          type="button"
          onClick={() => {
            setConfirm('');
            setOpen(true);
          }}
          data-testid={`customer-delete-${customerId}`}
          className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          Delete
        </button>
      ) : null}

      {canManage ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Permanently delete customer"
          description="This cannot be undone."
          size="sm"
          critical
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                form={`customer-delete-form-${customerId}`}
                disabled={pending || confirm !== 'DELETE'}
              >
                {pending ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </>
          }
        >
          <form
            id={`customer-delete-form-${customerId}`}
            action={submit}
            className="space-y-3"
          >
            <input type="hidden" name="customerId" value={customerId} />
            <p className="text-sm">
              Permanently delete <strong>{customerName}</strong>? This cannot be undone.
            </p>
            <p className="text-xs text-muted-foreground">
              A customer with any linked order, invoice, payment, or layaway cannot be
              deleted — its records are protected.
            </p>
            <div>
              <Label htmlFor={`customer-delete-confirm-${customerId}`} className="text-xs">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                id={`customer-delete-confirm-${customerId}`}
                name="confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                placeholder="DELETE"
                className="mt-1 h-9"
              />
            </div>
            {state.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
          </form>
        </Modal>
      ) : null}
    </>
  );
}
