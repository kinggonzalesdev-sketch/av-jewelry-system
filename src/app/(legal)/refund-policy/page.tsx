import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description:
    'When and how A.V. Jewelry handles cancellations, returns, and refunds, consistent with Philippine consumer law.',
  robots: { index: true, follow: true },
};

export default function RefundPolicyPage() {
  return (
    <LegalArticle title="Refund & Cancellation Policy">
      <p>
        This policy explains cancellations, returns, and refunds for products and services from{' '}
        <strong>A.V. Jewelry</strong>. It is written to respect your rights under the Philippine{' '}
        <strong>Consumer Act (RA 7394)</strong> — nothing here removes a right the law gives you.
        Different situations are treated differently, so please read the section that applies.
      </p>

      <h2>1. Defective, misrepresented, or non-conforming items</h2>
      <p>
        If an item is defective, not as described, or not the agreed weight/purity, you are entitled
        to a remedy under the Consumer Act — repair, replacement, or refund as appropriate. Bring
        the item and your proof of purchase.{' '}
        <strong>[OWNER INPUT REQUIRED — how to report, assessment process, timeframe.]</strong>
      </p>

      <h2>2. Change of mind</h2>
      <p>
        For a change of mind on a regular (non-custom) item, any accommodation (exchange, store
        credit, or refund) and the window for it is our policy, offered on top of your legal rights:{' '}
        <strong>[OWNER INPUT REQUIRED — allowed? within how many days? item condition required?]</strong>
      </p>

      <h2>3. Custom orders and deposits</h2>
      <p>
        Custom pieces and made-to-order work are produced to your specifications. Whether a deposit
        is refundable, and what happens if you cancel before or after work has begun, is:{' '}
        <strong>[OWNER INPUT REQUIRED — must be fair; a deposit forfeiture should reflect actual
        work/cost, not an arbitrary penalty. Lawyer review required.]</strong>
      </p>

      <h2>4. Layaway cancellation</h2>
      <p>
        If a layaway account is cancelled, how paid amounts are treated (refund, store credit, or
        forfeiture) is:{' '}
        <strong>[OWNER INPUT REQUIRED — forfeiture terms must be fair and clearly disclosed at
        sign-up; unfair forfeiture may be challenged under consumer law. Lawyer review required.]</strong>
      </p>

      <h2>5. Repairs and services</h2>
      <p>
        For repairs, resizing, and similar services, remedies for work that was not done properly
        are handled under the Consumer Act.{' '}
        <strong>[OWNER INPUT REQUIRED — any service warranty period and re-work terms.]</strong>
      </p>

      <h2>6. Gold and scrap buying</h2>
      <p>
        When we buy your gold or silver, the transaction is normally final once the assessed price
        is accepted and paid. The exact terms are: <strong>[OWNER INPUT REQUIRED.]</strong>
      </p>

      <h2>7. Duplicate or accidental charges</h2>
      <p>
        If you were charged twice or in error, contact us with proof and we will correct or refund
        the erroneous amount.
      </p>

      <h2>8. How refunds are made</h2>
      <p>
        Approved refunds are returned using a reasonable method (for example, the original payment
        method or an agreed alternative) within a reasonable time.{' '}
        <strong>[OWNER INPUT REQUIRED — method and timeframe.]</strong>
      </p>

      <h2>9. How to request</h2>
      <p>
        Contact us at 0917-203-5820 / 0919-096-9617 / 0919-097-5063 or{' '}
        <strong>[OWNER INPUT REQUIRED — email]</strong>, with your proof of purchase. See our{' '}
        <Link href="/terms">Terms &amp; Conditions</Link> for the overall agreement. If we cannot
        resolve a concern, you may seek assistance from the Department of Trade and Industry (DTI).
      </p>
    </LegalArticle>
  );
}
