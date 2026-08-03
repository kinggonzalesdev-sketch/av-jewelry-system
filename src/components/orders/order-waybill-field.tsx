'use client';

import { useState } from 'react';

import { setOrderWaybillAction } from '@/lib/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Waybill Number for the Ship Confirm view. Editable by authorized users; the
 * database refuses a blank or a duplicate (case-insensitive, among active orders)
 * and records who set it and when. A shipping order cannot be completed until this
 * is set — that gate lives in `order_completion_block`, so the button and the
 * server always agree.
 */
export function OrderWaybillField({
  orderId,
  waybill,
  canEdit,
  onSaved,
}: {
  orderId: string;
  waybill: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(waybill ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    if (pending || !value.trim()) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await setOrderWaybillAction(orderId, value.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    onSaved();
  };

  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-waybill">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Waybill Number
      </p>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. tracking / airway bill no."
            data-testid="order-waybill-input"
            className="h-9 min-w-[12rem] flex-1"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={pending || !value.trim()}
            data-testid="order-waybill-save"
          >
            {pending ? 'Saving…' : waybill ? 'Update' : 'Save'}
          </Button>
        </div>
      ) : (
        <p className="text-sm font-medium">
          {waybill ?? <span className="text-muted-foreground">Not set</span>}
        </p>
      )}
      {saved ? (
        <p className="mt-1 text-xs text-green-700" data-testid="order-waybill-saved">
          Waybill saved.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
