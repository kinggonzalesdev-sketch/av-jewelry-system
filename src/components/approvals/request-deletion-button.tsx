'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * A non-owner's "Request delete" (Approvals Phase 2, 2026-08-09). Opens a reason box
 * and creates an Owner-approval request via `onRequest` — it deletes NOTHING. The
 * Owner approves + executes it in /approvals, and only then is the target removed.
 * Owners never see this; they delete directly. Shared by Inventory / Scrap /
 * Attendance so the request UX is identical everywhere.
 */
export function RequestDeletionButton({
  label,
  entityNoun,
  onRequest,
  testIdBase,
}: {
  /** What is being deleted, shown to the Owner (e.g. an item code / customer name). */
  label: string;
  /** The kind of thing, for the dialog title (e.g. "item", "scrap sale"). */
  entityNoun: string;
  /** Creates the Owner-approval request. Returns ok, or an error to surface. */
  onRequest: (reason: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** data-testid for the trigger button; the send button gets `${testIdBase}-send`. */
  testIdBase: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (busy) return;
    if (reason.trim().length === 0) {
      setError('Add a reason for the Owner.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await onRequest(reason);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReason('');
          setError(null);
          setSent(false);
          setOpen(true);
        }}
        data-testid={testIdBase}
        className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
      >
        Request delete
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Request ${entityNoun} deletion`}
        description="Sent to the Owner for approval — nothing is deleted yet."
        footer={
          sent ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void send()}
                disabled={busy}
                data-testid={`${testIdBase}-send`}
              >
                {busy ? 'Sending…' : 'Send request'}
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <p className="text-sm text-emerald-600" data-testid={`${testIdBase}-sent`}>
            Request sent. The Owner reviews it in Approvals — nothing is deleted until
            then.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Ask the Owner to permanently delete <strong>{label}</strong>. This deletes
              nothing now; the Owner approves it in Approvals.
            </p>
            <div>
              <Label htmlFor={`${testIdBase}-reason`} className="text-xs">
                Reason (for the Owner)
              </Label>
              <Input
                id={`${testIdBase}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoComplete="off"
                placeholder="Why should this be deleted?"
                className="mt-1 h-9"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
