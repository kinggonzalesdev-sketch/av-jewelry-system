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
        Customers should report any defect, damage, or problem as soon as reasonably
        possible after receiving the item. You can report it through any of these
        channels:
      </p>
      <ul>
        <li>Phone call</li>
        <li>Messenger</li>
        <li>In person at our store, during business hours ({LEGAL_BUSINESS.hours})</li>
      </ul>
      <p>
        Please have your proof of purchase ready and describe the problem. We will review
        your report and let you know the result and the next steps.
      </p>

      <h2>2. Other return requests</h2>
      <p>
        If you would like to return an item for any other reason, please contact us before
        sending or bringing it back. We will review your request and respond.
      </p>

      <h2>3. Custom orders and repairs</h2>
      <p>
        Custom orders and repairs require a deposit of{' '}
        <strong>at least {LEGAL_POLICY.minimumDeposit}</strong>. If you need to cancel a
        custom order or repair, please contact us as soon as possible so we can discuss
        how your deposit will be handled.
      </p>
      <p>
        Repair and resizing work has a warranty and re-work period of{' '}
        <strong>{LEGAL_POLICY.repairReworkPeriod}</strong>. If
        there is a problem with the repair or resizing work within this period, please
        bring the item back so we can review it and re-work it where appropriate.
      </p>

      <h2>4. Layaway</h2>
      <p>
        If you are thinking of cancelling a layaway, or you may not be able to complete
        one, please contact us so we can explain how your payments will be handled.
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
        The applicable refund method will be communicated after the request is reviewed
        and approved.
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
        For written requests, email us at the address below. If we cannot resolve your
        concern, you may also seek assistance from the Department of Trade and Industry
        (DTI).
      </p>
      <LegalBusinessDetails />
    </LegalArticle>
  );
}
