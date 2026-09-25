import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';
import { LegalBusinessDetails } from '@/components/legal/legal-business-details';
import { LEGAL_BUSINESS, LEGAL_POLICY } from '@/lib/legal/legal-info';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description:
    'How A.V. Jewelry handles reports of defective items, cancellations, and refunds, consistent with Philippine consumer law.',
  robots: { index: true, follow: true },
};

export default function RefundPolicyPage() {
  return (
    <LegalArticle title="Refund & Cancellation Policy">
      <p>
        This policy explains how <strong>{LEGAL_BUSINESS.brand}</strong>, the trading name
        of <strong>{LEGAL_BUSINESS.registeredName}</strong>, handles reports of defective
        items, cancellations, and refunds. Nothing in this policy removes any right you
        have under Philippine law, including the{' '}
        <strong>Consumer Act of the Philippines (Republic Act No. 7394)</strong>. Please
        read the section that applies to your transaction, together with our{' '}
        <Link href="/terms">Terms &amp; Conditions</Link>.
      </p>

      <h2>1. Defective, damaged, or problem items</h2>
      <p>
        If an item has a defect, damage, or other problem, please contact the shop through
        any of these channels:
      </p>
      <ul>
        <li>Phone call</li>
        <li>Messenger</li>
        <li>In person at our store, during business hours ({LEGAL_BUSINESS.hours})</li>
      </ul>
      <p>
        Please have your proof of purchase ready and describe the problem. We will discuss
        it with you, and the problem will be resolved in the way we agree on together.
      </p>

      <h2>2. Change of mind</h2>
      <p>
        We do not accept returns or exchanges because you changed your mind, since the
        item may already have been worn or used. If you no longer want the item, you may
        sell it instead, including to us under our gold and scrap buying terms (Section
        5). This does not apply to items with a defect, damage, or other problem, which
        are handled under Section 1.
      </p>

      <h2>3. Custom orders and repairs</h2>
      <p>
        Custom orders and repairs require a deposit of{' '}
        <strong>at least {LEGAL_POLICY.minimumDeposit}</strong>. If you cancel a custom
        order or repair, your deposit can be refunded or transferred to another item.
        Please contact us to arrange it.
      </p>
      <p>
        Repair and resizing work has a warranty and re-work period of{' '}
        <strong>{LEGAL_POLICY.repairReworkPeriod}</strong>. If
        there is a problem with the repair or resizing work within this period, please
        bring the item back so we can review it and re-work it where appropriate.
      </p>

      <h2>4. Layaway</h2>
      <p>
        If you cancel a layaway, or it is not fully paid by the end of the layaway period
        and grace period, the payments you have made are <strong>forfeited</strong> and
        will not be refunded. The layaway period and grace period are set out in our{' '}
        <Link href="/terms">Terms &amp; Conditions</Link>.
      </p>

      <h2>5. Gold and scrap buying</h2>
      <p>A scrap-buying transaction becomes final when:</p>
      <ol>
        <li>you agree to the price we offer;</li>
        <li>payment is accepted or received; and</li>
        <li>the applicable receipt is issued or provided.</li>
      </ol>
      <p>Please review the offered price carefully before you agree to it.</p>

      <h2>6. Duplicate or incorrect payments</h2>
      <p>
        If you believe you paid twice or paid an incorrect amount, please contact us with
        your proof of payment so we can review it.
      </p>

      <h2>7. Refund method</h2>
      <p>
        Approved refunds are paid through <strong>GCash</strong> or in{' '}
        <strong>cash</strong>, depending on what you prefer.
      </p>

      <h2>8. Refund processing time</h2>
      <p>
        Approved refunds are generally processed within <strong>2–3 business days</strong>
        , subject to the applicable payment channel and financial institution processing
        time. When the funds appear in your account depends on your bank, e-wallet, or
        payment channel.
      </p>

      <h2>9. Contact us</h2>
      <p>
        Call or message us using the details below, or email us for written requests. If
        we cannot resolve your concern, you may also seek assistance from the Department of
        Trade and Industry (DTI).
      </p>
      <LegalBusinessDetails />
    </LegalArticle>
  );
}
