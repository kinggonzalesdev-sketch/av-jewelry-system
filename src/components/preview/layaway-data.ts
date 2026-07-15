/**
 * SAMPLE LAYAWAY DATA — PROTOTYPE ONLY. NOT REAL.
 *
 * Approved rules represented here (Bible §17, §22.12):
 *   - minimum 20% down payment
 *   - maximum 3 months
 *   - maximum 10-day grace period
 *   - a Layaway BELONGS TO an Official Order — it is not another order
 *   - payment evidence and verification remain separate
 *   - non-cancellable after deposit
 *   - forfeiture requires Owner approval; there is no automatic forfeiture
 *   - forfeited items go to Returned-to-Stock Review; no automatic stock return
 */

export const LAYAWAY_RULES = {
  minimumDownPaymentPercent: 20,
  maximumMonths: 3,
  maximumGraceDays: 10,
} as const;

/**
 * Fee concept, as given by the Owner: ₱150 × grams × number of months.
 *
 * ⚠️  The EXACT application is NOT settled. Whether this is per piece, per order,
 *     per item line, or charged at a different point is an open business
 *     question. This function computes the concept literally so the screen has a
 *     number to show — it must not be read as the final rule.
 */
export const LAYAWAY_FEE_RATE_PER_GRAM_MONTH = 150;

export const LAYAWAY_FEE_NOTE =
  'Fee concept: ₱150 × grams × number of months. The exact fee application — per piece, per order, or applied differently — remains subject to final business confirmation.';

export function layawayFeeConcept(grams: number, months: number): number {
  return Math.round(LAYAWAY_FEE_RATE_PER_GRAM_MONTH * grams * months);
}

/** Bible §22.12 status model. "Completed (Paid in Full)" is deliberately absent. */
export type LayawayStatus =
  | 'Active'
  | 'Overdue'
  | 'Grace Period'
  | 'Forfeiture-Eligible'
  | 'Forfeited'
  | 'Completed';

export const LAYAWAY_STATUS_TONE: Record<
  LayawayStatus,
  'green' | 'amber' | 'red' | 'slate'
> = {
  Active: 'green',
  Overdue: 'amber',
  'Grace Period': 'amber',
  'Forfeiture-Eligible': 'red',
  Forfeited: 'slate',
  Completed: 'slate',
};

export type VerificationStatus = 'Verified' | 'Evidence Submitted' | 'Rejected' | 'None';

export type Installment = {
  number: number;
  dueDate: string;
  amountDue: number;
  paidAmount: number | null;
  paidDate: string | null;
  /** Evidence and verification are SEPARATE: evidence can exist unverified. */
  evidence: string | null;
  verification: VerificationStatus;
};

export type LayawayAccount = {
  id: string;
  customer: string;
  facebookName: string;
  /** A Layaway belongs to an Official Order. It is NOT another order. */
  officialOrderNumber: string;
  invoiceNumber: string;
  itemSummary: string;
  itemGrams: number;
  totalOrderAmount: number;
  requiredDownPayment: number;
  downPaymentPaid: number;
  remainingBalance: number;
  startDate: string;
  dueDate: string;
  gracePeriodEnd: string;
  months: number;
  layawayFee: number;
  installments: Installment[];
  /** Who is carrying the arrangement. */
  financer: string;
  downPaymentVerification: VerificationStatus;
  status: LayawayStatus;
  shop: string;
};

function acct(
  base: Omit<
    LayawayAccount,
    'requiredDownPayment' | 'layawayFee' | 'remainingBalance'
  > & {
    paidTotal: number;
  },
): LayawayAccount {
  const requiredDownPayment = Math.round(
    (base.totalOrderAmount * LAYAWAY_RULES.minimumDownPaymentPercent) / 100,
  );
  const { paidTotal, ...rest } = base;
  return {
    ...rest,
    requiredDownPayment,
    layawayFee: layawayFeeConcept(base.itemGrams, base.months),
    remainingBalance: base.totalOrderAmount - paidTotal,
  };
}

export const SAMPLE_LAYAWAYS: LayawayAccount[] = [
  acct({
    id: 'lw1',
    customer: 'Bea Lim',
    facebookName: 'Bea Lim ♡',
    officialOrderNumber: 'ORD-2026-000102',
    invoiceNumber: 'INV-2026-000088',
    itemSummary: 'NK-21K-011 · Necklace 21K · ×2',
    itemGrams: 12.4,
    totalOrderAmount: 24000,
    downPaymentPaid: 4800,
    paidTotal: 12800,
    startDate: '2026-05-12',
    dueDate: '2026-08-12',
    gracePeriodEnd: '2026-08-22',
    months: 3,
    financer: 'A.V. Jewelry (in-house)',
    downPaymentVerification: 'Verified',
    status: 'Active',
    shop: 'A.V. Jewelry Main',
    installments: [
      {
        number: 1,
        dueDate: '2026-06-12',
        amountDue: 6400,
        paidAmount: 6400,
        paidDate: '2026-06-11',
        evidence: 'gcash-receipt-1.jpg',
        verification: 'Verified',
      },
      {
        number: 2,
        dueDate: '2026-07-12',
        amountDue: 6400,
        paidAmount: 1600,
        paidDate: '2026-07-13',
        evidence: 'gcash-receipt-2.jpg',
        verification: 'Evidence Submitted',
      },
      {
        number: 3,
        dueDate: '2026-08-12',
        amountDue: 6400,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
    ],
  }),
  acct({
    id: 'lw2',
    customer: 'Faye Ong',
    facebookName: 'Faye O.',
    officialOrderNumber: 'ORD-2026-000106',
    invoiceNumber: 'INV-2026-000092',
    itemSummary: 'NK-18K-013 · Necklace 18K · ×1',
    itemGrams: 8.2,
    totalOrderAmount: 9800,
    downPaymentPaid: 1960,
    paidTotal: 1960,
    startDate: '2026-05-20',
    dueDate: '2026-07-10',
    gracePeriodEnd: '2026-07-20',
    months: 2,
    financer: 'A.V. Jewelry (in-house)',
    downPaymentVerification: 'Verified',
    status: 'Overdue',
    shop: 'A.V. Jewelry Live 2',
    installments: [
      {
        number: 1,
        dueDate: '2026-06-10',
        amountDue: 3920,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
      {
        number: 2,
        dueDate: '2026-07-10',
        amountDue: 3920,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
    ],
  }),
  acct({
    id: 'lw3',
    customer: 'Gina Tan',
    facebookName: 'Gina T.',
    officialOrderNumber: 'ORD-2026-000107',
    invoiceNumber: 'INV-2026-000093',
    itemSummary: 'BR-21K-005 · Bracelet 21K · ×1',
    itemGrams: 10.0,
    totalOrderAmount: 11300,
    downPaymentPaid: 2260,
    paidTotal: 2260,
    startDate: '2026-04-18',
    dueDate: '2026-07-08',
    gracePeriodEnd: '2026-07-18',
    months: 3,
    financer: 'A.V. Jewelry (in-house)',
    downPaymentVerification: 'Verified',
    status: 'Grace Period',
    shop: 'A.V. Jewelry Main',
    installments: [
      {
        number: 1,
        dueDate: '2026-05-18',
        amountDue: 3766,
        paidAmount: 3766,
        paidDate: '2026-05-17',
        evidence: 'bank-slip-1.jpg',
        verification: 'Verified',
      },
      {
        number: 2,
        dueDate: '2026-06-18',
        amountDue: 3766,
        paidAmount: null,
        paidDate: null,
        evidence: 'blurred-receipt.jpg',
        verification: 'Rejected',
      },
      {
        number: 3,
        dueDate: '2026-07-08',
        amountDue: 3768,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
    ],
  }),
  acct({
    id: 'lw4',
    customer: 'Hazel Dy',
    facebookName: 'Hazel D.',
    officialOrderNumber: 'ORD-2026-000109',
    invoiceNumber: 'INV-2026-000095',
    itemSummary: 'RG-18K-015 · Ring 18K · ×1',
    itemGrams: 4.5,
    totalOrderAmount: 5400,
    downPaymentPaid: 1080,
    paidTotal: 1080,
    startDate: '2026-03-30',
    dueDate: '2026-06-30',
    gracePeriodEnd: '2026-07-10',
    months: 3,
    financer: 'A.V. Jewelry (in-house)',
    downPaymentVerification: 'Verified',
    status: 'Forfeiture-Eligible',
    shop: 'A.V. Jewelry Live 2',
    installments: [
      {
        number: 1,
        dueDate: '2026-04-30',
        amountDue: 1800,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
      {
        number: 2,
        dueDate: '2026-05-30',
        amountDue: 1800,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
      {
        number: 3,
        dueDate: '2026-06-30',
        amountDue: 1800,
        paidAmount: null,
        paidDate: null,
        evidence: null,
        verification: 'None',
      },
    ],
  }),
  acct({
    id: 'lw5',
    customer: 'Elena Ramos',
    facebookName: 'Elena R.',
    officialOrderNumber: 'ORD-2026-000105',
    invoiceNumber: 'INV-2026-000091',
    itemSummary: 'RG-21K-009 · Ring 21K · ×1',
    itemGrams: 6.0,
    totalOrderAmount: 15200,
    downPaymentPaid: 3040,
    paidTotal: 15200,
    startDate: '2026-04-09',
    dueDate: '2026-06-09',
    gracePeriodEnd: '2026-06-19',
    months: 2,
    financer: 'A.V. Jewelry (in-house)',
    downPaymentVerification: 'Verified',
    status: 'Completed',
    shop: 'A.V. Jewelry Main',
    installments: [
      {
        number: 1,
        dueDate: '2026-05-09',
        amountDue: 6080,
        paidAmount: 6080,
        paidDate: '2026-05-08',
        evidence: 'gcash-receipt-a.jpg',
        verification: 'Verified',
      },
      {
        number: 2,
        dueDate: '2026-06-09',
        amountDue: 6080,
        paidAmount: 6080,
        paidDate: '2026-06-07',
        evidence: 'gcash-receipt-b.jpg',
        verification: 'Verified',
      },
    ],
  }),
];

/** Dashboard Report summary counts for layaway. */
export function layawaySummary() {
  return {
    activeLayaways: SAMPLE_LAYAWAYS.filter((l) => l.status === 'Active').length,
    installmentsDue: SAMPLE_LAYAWAYS.flatMap((l) => l.installments).filter(
      (i) => i.paidAmount === null,
    ).length,
    overdueOrGrace: SAMPLE_LAYAWAYS.filter(
      (l) => l.status === 'Overdue' || l.status === 'Grace Period',
    ).length,
    forfeitureEligible: SAMPLE_LAYAWAYS.filter((l) => l.status === 'Forfeiture-Eligible')
      .length,
  };
}
