import { describe, expect, it } from 'vitest';

import {
  canOfferCancel,
  canOfferPayment,
  stageConfig,
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
    'keep',
  ])('offers payment on the live stage %s', (status) => {
    expect(payable({ status })).toBe(true);
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
