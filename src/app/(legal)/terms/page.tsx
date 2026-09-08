import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';

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
        <strong>A.V. Jewelry</strong>. This website&apos;s public page is informational — orders and
        payments are handled in-store, by phone, or through our live selling. Please read these
        together with our <Link href="/privacy">Privacy Policy</Link> and{' '}
        <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>.
      </p>

      <h2>1. Who we are</h2>
      <p>
        A.V. Jewelry, #84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan. Registered
        business details: <strong>[OWNER INPUT REQUIRED]</strong>.
      </p>

      <h2>2. Products and services</h2>
      <p>
        We offer gold jewelry (including 18K Saudi and K18 Japan gold, electro-forms, wedding rings,
        nameplates, and custom pieces) and services such as customization, repair, ring resizing,
        live selling, layaway, and gold/silver scrap buying.
      </p>

      <h2>3. Orders and quotations</h2>
      <p>
        Prices for gold items depend on weight and the prevailing gold price and may change over
        time; a quotation is valid only for the period we state at the time.{' '}
        <strong>[OWNER INPUT REQUIRED — quotation validity, reservation rules.]</strong>
      </p>

      <h2>4. Payment</h2>
      <p>
        We accept the payment methods we offer in-store and during live selling (including cash,
        credit card, and the digital methods we announce). Ownership passes and items are released
        according to our payment and layaway terms.{' '}
        <strong>[OWNER INPUT REQUIRED — accepted methods, when an item is released.]</strong>
      </p>

      <h2>5. Layaway</h2>
      <p>
        Layaway lets you reserve an item and pay in instalments. The down payment, instalment
        schedule, interest or charges (if any), what happens to payments if an account is
        cancelled, and any forfeiture rules are:{' '}
        <strong>[OWNER INPUT REQUIRED — must be fair and consistent with the Consumer Act; lawyer
        review required.]</strong>
      </p>

      <h2>6. Custom orders and repairs</h2>
      <p>
        Custom pieces and repairs may require a deposit and a production/turnaround time we agree
        with you. Because these are made or worked to your specifications, cancellation and refund
        rules differ (see the Refund Policy).{' '}
        <strong>[OWNER INPUT REQUIRED — deposit amount/percentage, timelines, number of revisions.]</strong>
      </p>

      <h2>7. Gold and scrap buying</h2>
      <p>
        When we buy gold or silver, the price is based on our assessment of weight and purity at the
        time. The basis and finality of an assessed offer are:{' '}
        <strong>[OWNER INPUT REQUIRED.]</strong>
      </p>

      <h2>8. Delivery and pick-up</h2>
      <p>
        Store pick-up is available. Where we arrange delivery, timelines and any courier/COD terms
        are as advised at the time of the order.{' '}
        <strong>[OWNER INPUT REQUIRED — delivery areas, fees, risk of loss.]</strong>
      </p>

      <h2>9. Cancellations and refunds</h2>
      <p>
        Cancellations and refunds are governed by our{' '}
        <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>, which preserves your
        rights under Philippine consumer law.
      </p>

      <h2>10. Warranties and defective items</h2>
      <p>
        Nothing in these terms removes the warranties and remedies the law gives you for defective
        or misrepresented goods and services under the Consumer Act (RA 7394).{' '}
        <strong>[OWNER INPUT REQUIRED — any additional voluntary warranty, e.g. on repairs.]</strong>
      </p>

      <h2>11. Intellectual property</h2>
      <p>
        The A.V. Jewelry name, logo, and the content of this website are ours or used with
        permission and may not be copied without our consent.
      </p>

      <h2>12. Limitation of liability</h2>
      <p>
        We take reasonable care in our work. To the extent allowed by law — and{' '}
        <strong>without limiting your statutory consumer rights, which we do not waive</strong> — our
        liability is limited as described here. <strong>[LAWYER REVIEW REQUIRED.]</strong>
      </p>

      <h2>13. Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of the Republic of the Philippines. We aim to resolve
        concerns directly first; you may also seek help from the DTI or the appropriate authority.{' '}
        <strong>[OWNER INPUT REQUIRED — venue/complaint contact.]</strong>
      </p>

      <h2>14. Changes and contact</h2>
      <p>
        We may update these terms; the effective date above will change accordingly. Questions:
        0917-203-5820 / 0919-096-9617 / 0919-097-5063, or{' '}
        <strong>[OWNER INPUT REQUIRED — email]</strong>.
      </p>
    </LegalArticle>
  );
}
