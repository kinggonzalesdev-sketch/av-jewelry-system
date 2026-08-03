import { describe, expect, it } from 'vitest';

import {
  canOfferCancel,
  canOfferCompletion,
  canOfferPayment,
  stageConfig,
  stageLabel,
  stageOffers,
  STAGE_ACTIONS,
} from '@/lib/orders/stage-actions';

/** The default happy case: a live order that still owes money, user may record. */
function payable(over: Partial<Parameters<typeof canOfferPayment>[0]> = {}) {
  return canOfferPayment({
    status: 'for_preparation',
    paidInFull: false,
    balanceUnavailable: false,
    canRecordPayment: true,
    ...over,
  });
}

describe('stage → actions configuration', () => {
  it('labels every stage the Orders workflow can be in', () => {
    expect(stageConfig('invoiced').label).toBe('For Invoice');
    expect(stageConfig('awaiting_required_payment').label).toBe('For Reminder');
    expect(stageConfig('required_payment_verified').label).toBe('For Confirm');
    expect(stageConfig('for_preparation').label).toBe('For Prepare');
    expect(stageConfig('for_layaway').label).toBe('For Layaway');
    expect(stageConfig('keep').label).toBe('Keep');
  });

  it('falls back to a SAFE read-only shape for an unknown status', () => {
    const cfg = stageConfig('something_new');
    expect(cfg.readOnly).toBe(true);
    expect(cfg.allowsPayment).toBe(false);
    expect(cfg.allowsCancel).toBe(false);
  });

  it('treats Completed and Cancelled as read-only', () => {
    expect(STAGE_ACTIONS.completed.readOnly).toBe(true);
    expect(STAGE_ACTIONS.cancelled.readOnly).toBe(true);
  });

  it('shows fulfillment detail only where fulfillment actually happens', () => {
    expect(STAGE_ACTIONS.for_preparation.tabs).toContain('fulfillment');
    expect(STAGE_ACTIONS.dispatched_or_picked_up.tabs).toContain('fulfillment');
    // A For Invoice order has no fulfillment yet — do not force the tab on it.
    expect(STAGE_ACTIONS.invoiced.tabs).not.toContain('fulfillment');
    // Layaway detail belongs only to a linked layaway order.
    expect(STAGE_ACTIONS.for_layaway.tabs).toContain('layaway');
    expect(STAGE_ACTIONS.invoiced.tabs).not.toContain('layaway');
  });
});

describe('payment visibility', () => {
  it('offers payment on a live stage with a remaining balance', () => {
    expect(payable()).toBe(true);
  });

  it('never offers payment once the order is fully paid', () => {
    expect(payable({ paidInFull: true })).toBe(false);
  });

  it('never offers payment without the record-payment permission', () => {
    expect(payable({ canRecordPayment: false })).toBe(false);
  });

  it('never offers payment when the balance could not be read', () => {
    expect(payable({ balanceUnavailable: true })).toBe(false);
  });

  it.each(['completed', 'cancelled', 'for_cancel'])(
    'never offers payment on a closed or under-review order (%s)',
    (status) => {
      expect(payable({ status })).toBe(false);
    },
  );

  it.each([
    'invoiced',
    'awaiting_required_payment',
    'required_payment_verified',
    'for_preparation',
    'for_shipping_or_pickup',
    'approved_for_release',
    'dispatched_or_picked_up',
    'for_layaway',
  ])('offers payment on the live stage %s', (status) => {
    expect(payable({ status })).toBe(true);
  });

  it('does NOT offer payment on Keep (Owner request 2026-07-30 — Keep modal has no Add Payment)', () => {
    expect(payable({ status: 'keep' })).toBe(false);
  });
});

describe('Danger Zone — Cancel Order visibility', () => {
  it.each(['for_cancel', 'cancelled', 'completed'])(
    'never offers Cancel Order for %s',
    (status) => {
      expect(canOfferCancel(status)).toBe(false);
    },
  );

  it.each(['invoiced', 'for_preparation', 'for_layaway', 'keep'])(
    'offers Cancel Order on the active stage %s',
    (status) => {
      expect(canOfferCancel(status)).toBe(true);
    },
  );
});

describe('the status shown at the top matches the section (§7)', () => {
  it('names the stage the operator sees, never the raw status', () => {
    expect(stageLabel('required_payment_verified')).toBe('For Confirm');
    expect(stageLabel('approved_for_release')).toBe('Ship Confirm');
    expect(stageLabel('exceptional_release_pending')).toBe('Ship Confirm');
    expect(stageLabel('for_shipping_or_pickup')).toBe('For Shipping');
    expect(stageLabel('dispatched_or_picked_up')).toBe('Delivery / Pickup');
  });
});

describe('stage action sets (§7)', () => {
  it('Keep offers ONLY Transfer to Completed (Owner request 2026-07-30)', () => {
    // The destination dropdown was removed from Keep; its one workflow action is
    // Transfer to Completed (gated by order_completion_block in SQL).
    expect(STAGE_ACTIONS.keep.actions).toEqual(['transfer_completed']);
    expect(stageOffers('keep', 'transfer_destination')).toBe(false);
  });

  it.each(['required_payment_verified', 'approved_for_release', 'exceptional_release_pending'])(
    '%s offers transfer but never a handover action',
    (status) => {
      expect(stageOffers(status, 'transfer_destination')).toBe(true);
      expect(stageOffers(status, 'done')).toBe(false);
      expect(stageOffers(status, 'transfer_completed')).toBe(false);
    },
  );

  it('For Shipping keeps Transfer to Destination (§6)', () => {
    expect(stageOffers('for_shipping_or_pickup', 'transfer_destination')).toBe(true);
  });

  it('Delivery / Pickup is the only stage offering Done, Released, and completion', () => {
    expect(stageOffers('dispatched_or_picked_up', 'done')).toBe(true);
    expect(stageOffers('dispatched_or_picked_up', 'confirm_released')).toBe(true);
    expect(stageOffers('dispatched_or_picked_up', 'transfer_completed')).toBe(true);
  });

  it.each(['completed', 'cancelled', 'for_cancel'] as const)(
    '%s offers no workflow action at all',
    (stage) => {
      expect(STAGE_ACTIONS[stage].actions).toEqual([]);
    },
  );
});

/**
 * Completion is the action that closes money and retires stock, so its visibility
 * rules get their own pinning. The DATABASE is the authority (order_completion_block);
 * these tests assert the UI never offers what SQL would refuse.
 */
describe('completion visibility (§5)', () => {
  const base = {
    status: 'dispatched_or_picked_up',
    action: 'done' as const,
    paidInFull: true,
    balanceUnavailable: false,
    canRelease: true,
    completionBlock: null,
  };

  it('is offered when fully paid, permitted, and the database raises no block', () => {
    expect(canOfferCompletion(base)).toBe(true);
    expect(canOfferCompletion({ ...base, action: 'transfer_completed' })).toBe(true);
  });

  it('is REFUSED when the order is not fully paid', () => {
    expect(canOfferCompletion({ ...base, paidInFull: false })).toBe(false);
  });

  it('is REFUSED when the database says it cannot complete, however right it looks here', () => {
    expect(
      canOfferCompletion({
        ...base,
        completionBlock: 'Fulfillment is not finished yet.',
      }),
    ).toBe(false);
  });

  it('is REFUSED when the balance is unreadable — that is not a paid order', () => {
    expect(canOfferCompletion({ ...base, balanceUnavailable: true })).toBe(false);
  });

  it('is REFUSED without the release permission', () => {
    expect(canOfferCompletion({ ...base, canRelease: false })).toBe(false);
  });

  it.each(['for_preparation', 'for_layaway', 'invoiced'])(
    'is REFUSED on %s, which does not offer completion however paid it is',
    (status) => {
      expect(canOfferCompletion({ ...base, status })).toBe(false);
    },
  );

  it('is OFFERED on keep via Transfer to Completed once paid (Owner request 2026-07-30)', () => {
    // Keep now completes directly; the SQL block (order_completion_block) is still
    // the authority, mirrored here by completionBlock: null.
    expect(
      canOfferCompletion({ ...base, status: 'keep', action: 'transfer_completed' }),
    ).toBe(true);
    // It still never offers Delivery's "Done" — that is not a Keep action.
    expect(canOfferCompletion({ ...base, status: 'keep', action: 'done' })).toBe(false);
  });
});
