import type { Metadata } from 'next';

import { PriceDownPaymentCalculator } from '@/components/calculator/price-down-payment-calculator';
import { requireActiveStaff } from '@/lib/authz/guard';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Price & Down Payment Calculator (Owner request 2026-08-01) — a staff utility to
 * quickly compute fixed / per-gram item prices and the 10/20/30% down payment +
 * remaining balance. Any active staff member may open it; it reads and writes no
 * business data, so no special permission is required.
 */
export default async function CalculatorPage() {
  await requireActiveStaff();

  return <PriceDownPaymentCalculator />;
}
