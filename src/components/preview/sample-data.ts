/**
 * SAMPLE DATA — PROTOTYPE ONLY. NOT REAL.
 * =======================================
 *
 * Every record here is invented for UI review. Nothing is read from or written
 * to the database. No production code may import this module (an ESLint rule
 * enforces that).
 *
 * The numbers are deliberately small and obviously fake so no one mistakes this
 * screen for an operational report.
 */

export const SAMPLE_DATA_NOTICE =
  'Sample data — invented for UI review. Not real orders, customers, or amounts.';

export type OrderStatus =
  | 'for_invoice'
  | 'for_reminder'
  | 'for_preparation'
  | 'for_payment_confirmation'
  | 'shipping_confirmed'
  | 'keep'
  | 'for_cancellation_review'
  | 'cancelled'
  | 'payment_evidence_submitted';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  for_invoice: 'For Invoice',
  for_reminder: 'For Reminder',
  for_preparation: 'For Preparation',
  for_payment_confirmation: 'For Payment Confirmation',
  shipping_confirmed: 'Shipping Confirmed',
  keep: 'Keep',
  for_cancellation_review: 'For Cancellation Review',
  cancelled: 'Cancelled',
  payment_evidence_submitted: 'Payment Evidence Submitted',
};

/** Tone drives the badge colour. Nothing here implies a business guarantee. */
export const ORDER_STATUS_TONE: Record<
  OrderStatus,
  'green' | 'amber' | 'slate' | 'red' | 'blue'
> = {
  for_invoice: 'blue',
  for_reminder: 'amber',
  for_preparation: 'blue',
  for_payment_confirmation: 'amber',
  shipping_confirmed: 'green',
  keep: 'slate',
  for_cancellation_review: 'red',
  cancelled: 'slate',
  payment_evidence_submitted: 'amber',
};

export type SampleOrder = {
  id: string;
  status: OrderStatus;
  shop: string;
  orderNumber: string;
  invoiceNumber: string | null;
  claimNumber: string;
  customer: string;
  facebookName: string;
  itemCode: string;
  trackingNumber: string | null;
  quantity: number;
  amount: number;
  /**
   * Bible §22.11: Verified is NOT Paid in Full. "Paid in Full" is deliberately
   * absent from this union — it remains To be confirmed (§22.19).
   */
  paymentState:
    | 'Awaiting Required Payment'
    | 'Evidence Submitted'
    | 'Required Payment Verified'
    | 'Rejected';
  fulfillmentState:
    | 'Not Started'
    | 'For Preparation'
    | 'For Shipping'
    | 'Approved for Release'
    | 'Dispatched';
  paymentArrangement: 'Full Payment' | 'Layaway' | 'Deposit';
  fulfillmentMethod: 'Shipping' | 'Pickup';
  assignedStaff: string;
  orderDate: string;
  shippingDate: string | null;
  holdExpiry: string | null;
  requiredDeposit: number | null;
  remainingBalance: number | null;
  /**
   * True when this claim already sits in an ACTIVE (unsent) Invoice Draft.
   *
   * Modelled as its own field rather than inferred from `invoiceNumber`: a draft
   * has no invoice number until it is sent, so the two are genuinely different
   * facts. Bible §22.8 — one claim cannot belong to two active drafts.
   */
  inActiveDraft: boolean;
};

export const SAMPLE_SHOPS = ['A.V. Jewelry Main', 'A.V. Jewelry Live 2'] as const;
export const SAMPLE_STAFF = ['Maria Santos', 'Jun Cruz', 'Owner'] as const;

export const SAMPLE_ORDERS: SampleOrder[] = [
  {
    id: 'o1',
    status: 'for_invoice',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000101',
    invoiceNumber: null,
    claimNumber: 'CLM-2026-000451',
    customer: 'Ana Reyes',
    facebookName: 'Ana R.',
    itemCode: 'RG-18K-004',
    trackingNumber: null,
    quantity: 1,
    amount: 12500,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-14',
    shippingDate: null,
    holdExpiry: '2026-07-17',
    requiredDeposit: null,
    remainingBalance: 12500,
    inActiveDraft: false,
  },
  {
    id: 'o2',
    status: 'for_reminder',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000102',
    invoiceNumber: 'INV-2026-000088',
    claimNumber: 'CLM-2026-000452',
    customer: 'Bea Lim',
    facebookName: 'Bea Lim ♡',
    itemCode: 'NK-21K-011',
    trackingNumber: null,
    quantity: 2,
    amount: 24000,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Layaway',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Jun Cruz',
    orderDate: '2026-07-12',
    shippingDate: null,
    holdExpiry: '2026-07-15',
    requiredDeposit: 4800,
    remainingBalance: 24000,
    inActiveDraft: false,
  },
  {
    id: 'o3',
    status: 'payment_evidence_submitted',
    shop: 'A.V. Jewelry Live 2',
    orderNumber: 'ORD-2026-000103',
    invoiceNumber: 'INV-2026-000089',
    claimNumber: 'CLM-2026-000455',
    customer: 'Carlo Uy',
    facebookName: 'Carlo U.',
    itemCode: 'BR-18K-002',
    trackingNumber: null,
    quantity: 1,
    amount: 8900,
    paymentState: 'Evidence Submitted',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Pickup',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-13',
    shippingDate: null,
    holdExpiry: '2026-07-16',
    requiredDeposit: null,
    remainingBalance: 8900,
    inActiveDraft: false,
  },
  {
    id: 'o4',
    status: 'for_preparation',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000104',
    invoiceNumber: 'INV-2026-000090',
    claimNumber: 'CLM-2026-000458',
    customer: 'Dina Flores',
    facebookName: 'Dina F.',
    itemCode: 'ER-18K-007',
    trackingNumber: null,
    quantity: 1,
    amount: 6400,
    paymentState: 'Required Payment Verified',
    fulfillmentState: 'For Preparation',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Jun Cruz',
    orderDate: '2026-07-11',
    shippingDate: '2026-07-16',
    holdExpiry: null,
    requiredDeposit: null,
    remainingBalance: 0,
    inActiveDraft: false,
  },
  {
    id: 'o5',
    status: 'shipping_confirmed',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000105',
    invoiceNumber: 'INV-2026-000091',
    claimNumber: 'CLM-2026-000460',
    customer: 'Elena Ramos',
    facebookName: 'Elena R.',
    itemCode: 'RG-21K-009',
    trackingNumber: 'JT-8842-9910',
    quantity: 1,
    amount: 15200,
    paymentState: 'Required Payment Verified',
    fulfillmentState: 'Dispatched',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-09',
    shippingDate: '2026-07-12',
    holdExpiry: null,
    requiredDeposit: null,
    remainingBalance: 0,
    inActiveDraft: false,
  },
  {
    id: 'o6',
    status: 'keep',
    shop: 'A.V. Jewelry Live 2',
    orderNumber: 'ORD-2026-000106',
    invoiceNumber: 'INV-2026-000092',
    claimNumber: 'CLM-2026-000461',
    customer: 'Faye Ong',
    facebookName: 'Faye O.',
    itemCode: 'NK-18K-013',
    trackingNumber: null,
    quantity: 1,
    amount: 9800,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Deposit',
    fulfillmentMethod: 'Pickup',
    assignedStaff: 'Jun Cruz',
    orderDate: '2026-07-08',
    shippingDate: null,
    holdExpiry: null,
    requiredDeposit: 1960,
    remainingBalance: 9800,
    inActiveDraft: false,
  },
  {
    id: 'o7',
    status: 'for_cancellation_review',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000107',
    invoiceNumber: 'INV-2026-000093',
    claimNumber: 'CLM-2026-000463',
    customer: 'Gina Tan',
    facebookName: 'Gina T.',
    itemCode: 'BR-21K-005',
    trackingNumber: null,
    quantity: 1,
    amount: 11300,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-05',
    shippingDate: null,
    holdExpiry: '2026-07-08',
    requiredDeposit: null,
    remainingBalance: 11300,
    inActiveDraft: false,
  },
  {
    id: 'o8',
    status: 'for_payment_confirmation',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000108',
    invoiceNumber: 'INV-2026-000094',
    claimNumber: 'CLM-2026-000464',
    customer: 'Ana Reyes',
    facebookName: 'Ana R.',
    itemCode: 'ER-21K-003',
    trackingNumber: null,
    quantity: 1,
    amount: 7200,
    paymentState: 'Evidence Submitted',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-14',
    shippingDate: null,
    holdExpiry: '2026-07-17',
    requiredDeposit: null,
    remainingBalance: 7200,
    inActiveDraft: false,
  },
  {
    id: 'o9',
    status: 'cancelled',
    shop: 'A.V. Jewelry Live 2',
    orderNumber: 'ORD-2026-000109',
    invoiceNumber: 'INV-2026-000095',
    claimNumber: 'CLM-2026-000466',
    customer: 'Hazel Dy',
    facebookName: 'Hazel D.',
    itemCode: 'RG-18K-015',
    trackingNumber: null,
    quantity: 1,
    amount: 5400,
    paymentState: 'Rejected',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Pickup',
    assignedStaff: 'Owner',
    orderDate: '2026-07-02',
    shippingDate: null,
    holdExpiry: null,
    requiredDeposit: null,
    remainingBalance: 5400,
    inActiveDraft: false,
  },
  {
    id: 'o10',
    status: 'for_invoice',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000110',
    invoiceNumber: null,
    claimNumber: 'CLM-2026-000470',
    customer: 'Ana Reyes',
    facebookName: 'Ana R.',
    itemCode: 'NK-18K-020',
    trackingNumber: null,
    quantity: 1,
    amount: 10100,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-14',
    shippingDate: null,
    holdExpiry: '2026-07-17',
    requiredDeposit: null,
    remainingBalance: 10100,
    inActiveDraft: false,
  },
  {
    id: 'o11',
    status: 'for_invoice',
    shop: 'A.V. Jewelry Live 2',
    orderNumber: 'ORD-2026-000111',
    invoiceNumber: null,
    claimNumber: 'CLM-2026-000471',
    customer: 'Bea Lim',
    facebookName: 'Bea Lim ♡',
    itemCode: 'ER-18K-021',
    trackingNumber: null,
    quantity: 1,
    amount: 4300,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Pickup',
    assignedStaff: 'Jun Cruz',
    orderDate: '2026-07-14',
    shippingDate: null,
    holdExpiry: '2026-07-17',
    requiredDeposit: null,
    remainingBalance: 4300,
    inActiveDraft: false,
  },
  {
    id: 'o12',
    status: 'for_invoice',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000112',
    invoiceNumber: null,
    claimNumber: 'CLM-2026-000472',
    customer: 'Carlo Uy',
    facebookName: 'Carlo U.',
    itemCode: 'RG-21K-022',
    trackingNumber: null,
    quantity: 1,
    amount: 13800,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Layaway',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Maria Santos',
    orderDate: '2026-07-14',
    shippingDate: null,
    holdExpiry: '2026-07-17',
    requiredDeposit: 2760,
    remainingBalance: 13800,
    inActiveDraft: false,
  },
  {
    // Deliberately included so the Owner can SEE the "already in another active
    // Invoice Draft" exclusion actually fire in the Invoice All flow. Without a
    // record like this, that rule would be untestable and invisible.
    id: 'o13',
    status: 'for_invoice',
    shop: 'A.V. Jewelry Main',
    orderNumber: 'ORD-2026-000113',
    invoiceNumber: null,
    claimNumber: 'CLM-2026-000473',
    customer: 'Dina Flores',
    facebookName: 'Dina F.',
    itemCode: 'BR-18K-024',
    trackingNumber: null,
    quantity: 1,
    amount: 6900,
    paymentState: 'Awaiting Required Payment',
    fulfillmentState: 'Not Started',
    paymentArrangement: 'Full Payment',
    fulfillmentMethod: 'Shipping',
    assignedStaff: 'Jun Cruz',
    orderDate: '2026-07-14',
    shippingDate: null,
    holdExpiry: '2026-07-17',
    requiredDeposit: null,
    remainingBalance: 6900,
    inActiveDraft: true,
  },
];

/** Currency formatting for display only. */
export function peso(value: number): string {
  return `₱${value.toLocaleString('en-PH')}`;
}

/**
 * Invoice-grouping eligibility for the two-step "Invoice All" flow.
 *
 * Bible §22.8: one claim cannot sit in two active Invoice Drafts, and a draft
 * groups claims for ONE buyer/arrangement. Records that fail any rule are shown
 * separately WITH the reason — never silently dropped.
 */
export type EligibilityResult = {
  eligible: SampleOrder[];
  excluded: Array<{ order: SampleOrder; reason: string }>;
  groups: Array<{
    customer: string;
    arrangement: string;
    fulfillment: string;
    orders: SampleOrder[];
  }>;
};

export function computeInvoiceEligibility(orders: SampleOrder[]): EligibilityResult {
  const eligible: SampleOrder[] = [];
  const excluded: Array<{ order: SampleOrder; reason: string }> = [];

  for (const order of orders) {
    if (order.status !== 'for_invoice') {
      excluded.push({
        order,
        reason: `Not in For Invoice readiness (currently ${ORDER_STATUS_LABEL[order.status]})`,
      });
      continue;
    }
    if (order.inActiveDraft) {
      excluded.push({
        order,
        reason: 'Claim is already in another active Invoice Draft',
      });
      continue;
    }
    eligible.push(order);
  }

  // Group by customer + payment arrangement + fulfillment method. A draft may
  // never mix buyers or arrangements.
  const map = new Map<string, SampleOrder[]>();
  for (const order of eligible) {
    const key = `${order.customer}||${order.paymentArrangement}||${order.fulfillmentMethod}`;
    const list = map.get(key) ?? [];
    list.push(order);
    map.set(key, list);
  }

  const groups = [...map.entries()].map(([key, list]) => {
    const [customer, arrangement, fulfillment] = key.split('||');
    return {
      customer: customer ?? '',
      arrangement: arrangement ?? '',
      fulfillment: fulfillment ?? '',
      orders: list,
    };
  });

  return { eligible, excluded, groups };
}

/**
 * Printer / Bluetooth states. "Connected" is never shown unless a verified
 * connection exists — the prototype defaults to Disconnected for that reason.
 */
export type PrinterState =
  'Connected' | 'Disconnected' | 'Connecting' | 'Error' | 'Unsupported on Device';

/**
 * Pancake / Facebook connection states. All honest — none claims a working
 * integration, because none has been validated.
 */
export type IntegrationState =
  | 'Not Connected'
  | 'Connected Demo'
  | 'Needs Reauthorization'
  | 'API Access Pending Validation'
  | 'Connection Error';
