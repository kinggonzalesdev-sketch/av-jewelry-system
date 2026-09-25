import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';
import { LegalBusinessDetails } from '@/components/legal/legal-business-details';
import { LEGAL_BUSINESS, LEGAL_POLICY } from '@/lib/legal/legal-info';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'The terms that apply when you buy jewelry or use the services of A.V. Jewelry.',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalArticle title="Terms & Conditions">
      <p>
        These terms apply when you buy products from, or use the services of,{' '}
        <strong>{LEGAL_BUSINESS.brand}</strong>, the trading name of{' '}
        <strong>{LEGAL_BUSINESS.registeredName}</strong> (&quot;we&quot;, &quot;us&quot;).
        Orders and payments are handled in our store, through Messenger, or during our
        live selling. Please read these terms together with our{' '}
        <Link href="/privacy">Privacy Policy</Link>,{' '}
        <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>, and{' '}
        <Link href="/cookie-policy">Cookie Policy</Link>.
      </p>

      <h2>1. Who we are</h2>
      <p>
        {LEGAL_BUSINESS.registeredName} (DTI Registration No.{' '}
        {LEGAL_BUSINESS.dtiRegistrationNumber}) trades as {LEGAL_BUSINESS.brand}. Our full
        business details are listed in Section 13 (Contact us).
      </p>
      <p>
        We comply with the Anti-Money Laundering Act of 2001 (Republic Act No. 9160), as
        amended, and the rules of the Anti-Money Laundering Council (AMLC). Where the law
        requires it, we may ask for valid identification and keep records of your
        transaction.
      </p>

      <h2>2. Products and services</h2>
      <p>
        We offer gold jewelry (including 18K Saudi and K18 Japan gold, electro-forms,
        wedding rings, nameplates, and custom pieces) and services such as customization,
        repair, ring resizing, live selling, layaway, and gold and silver scrap buying.
      </p>

      <h2>3. Prices and orders</h2>
      <p>
        Prices of gold items generally depend on weight and our current rate, and may
        change over time. The price that applies to your order is the price we confirm
        with you for that transaction.
      </p>

      <h2>4. Payment</h2>
      <p>
        Accepted payment channels may include <strong>BDO</strong>, <strong>BPI</strong>,{' '}
        <strong>GCash</strong>, <strong>Credit Card</strong>, <strong>Remittance</strong>,
        and <strong>Cash on Delivery (COD)</strong>, where applicable. Not every payment
        method is available for every transaction, destination, or order. We will confirm
        the applicable payment method before your transaction is completed. Payments are
        subject to our review and confirmation, so please keep your payment reference or
        proof of payment.
      </p>
      <p>
        Cash on Delivery requires a down payment of{' '}
        <strong>at least {LEGAL_POLICY.codDownPayment}</strong> before the item is
        released for delivery.
      </p>

      <h2>5. Delivery and pick-up</h2>
      <p>
        {LEGAL_BUSINESS.brand} serves customers nationwide in the Philippines and may also
        accommodate international deliveries. Courier options may include our own{' '}
        {LEGAL_BUSINESS.brand} riders, LBC, FedEx, and DHL.
      </p>
      <ul>
        <li>
          There is no fixed delivery fee. Where applicable, the shipping cost depends on
          the destination and the courier.
        </li>
        <li>Delivery timelines may depend on the courier and the destination.</li>
        <li>Courier and tracking details are provided when available.</li>
        <li>Store pick-up is also available.</li>
      </ul>

      <h2>6. Release of items</h2>
      <p>
        Items are released after your payment has been verified. For Cash on Delivery,
        the item is released once the required down payment (at least{' '}
        {LEGAL_POLICY.codDownPayment}) has been verified, and the balance is paid on
        delivery.
      </p>

      <h2>7. Layaway</h2>
      <p>Layaway lets you reserve an item and pay for it in installments.</p>
      <ul>
        <li>
          <strong>Required down payment:</strong> 20% of the total layaway amount payable.
        </li>
        <li>
          <strong>Maximum layaway period:</strong> 3 calendar months.
        </li>
        <li>
          <strong>Grace period:</strong> up to 10 calendar days after the final due date.
        </li>
        <li>
          The installment schedule, due dates, and total amount payable (including any
          applicable layaway fee) are confirmed with you when the layaway is set up.
        </li>
      </ul>
      <p>
        If you cancel a layaway, or it is not fully paid by the end of the layaway period
        and grace period, the payments you have made are <strong>forfeited</strong> and
        will not be refunded.
      </p>

      <h2>8. Custom orders, repairs, and resizing</h2>
      <ul>
        <li>
          Custom orders and repairs require a deposit of{' '}
          <strong>at least {LEGAL_POLICY.minimumDeposit}</strong>.
        </li>
        <li>
          The completion time of a custom order depends on the order. Usually, the item is
          released as soon as it is fully paid.
        </li>
        <li>
          Repair and resizing work has a warranty and re-work period of{' '}
          <strong>{LEGAL_POLICY.repairReworkPeriod}</strong>.
          If there is a problem with the repair or resizing work within this period,
          please bring the item back so we can review it and re-work it where appropriate.
        </li>
        <li>
          If you cancel a custom order or repair, your deposit can be refunded or
          transferred to another item. Please contact us to arrange it.
        </li>
      </ul>

      <h2>9. Gold and scrap buying</h2>
      <p>
        When we buy gold or scrap jewelry from you, the buying price is determined based
        on our current daily 24-karat gold rate. There is no permanently fixed rate. The
        actual value we offer may depend on the applicable daily rate, the weight, the
        purity or karat, and our inspection and appraisal of the item, where applicable.
      </p>
      <p>A scrap-buying transaction becomes final when:</p>
      <ol>
        <li>you agree to the price we offer;</li>
        <li>payment is accepted or received; and</li>
        <li>the applicable receipt is issued or provided.</li>
      </ol>

      <h2>10. Cancellations, refunds, and defective items</h2>
      <p>
        Cancellations, refunds, and reports of defective or damaged items are handled
        under our <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
      </p>

      <h2>11. Your rights under Philippine law</h2>
      <p>
        We take reasonable care in handling your orders and items. Nothing in these terms
        removes or limits any right you have under Philippine law, including the Consumer
        Act of the Philippines (Republic Act No. 7394).
      </p>

      <h2>12. Other terms</h2>
      <p>
        The {LEGAL_BUSINESS.brand} name, logo, and the content of this website may not be
        copied without our permission. These terms are governed by the laws of the
        Republic of the Philippines. If you have a concern, please contact us first so we
        can try to resolve it; you may also seek assistance from the Department of Trade
        and Industry (DTI). We may update these terms from time to time; the Effective
        Date above shows when the current version took effect.
      </p>

      <h2>13. Contact us</h2>
      <LegalBusinessDetails />
    </LegalArticle>
  );
}
