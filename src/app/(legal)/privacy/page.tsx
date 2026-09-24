import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';
import { LegalBusinessDetails } from '@/components/legal/legal-business-details';
import { LEGAL_BUSINESS } from '@/lib/legal/legal-info';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How A.V. Jewelry collects, uses, shares, and protects personal information, and your rights under the Philippine Data Privacy Act.',
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalArticle title="Privacy Policy">
      <p>
        This Privacy Policy explains how <strong>{LEGAL_BUSINESS.brand}</strong>, the
        trading name of <strong>{LEGAL_BUSINESS.registeredName}</strong> (&quot;we&quot;,
        &quot;us&quot;), handles personal information when you buy from us, use our
        services, or contact us. We handle personal information in line with the
        Philippine <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>, its
        Implementing Rules and Regulations, and the issuances of the National Privacy
        Commission (NPC).
      </p>

      <h2>1. Who we are</h2>
      <p>
        {LEGAL_BUSINESS.registeredName}, trading as {LEGAL_BUSINESS.brand}, is responsible
        for the personal information described in this policy. Our full business details
        are listed in Section 13 (Contact us).
      </p>

      <h2>2. Scope</h2>
      <p>
        This policy covers our public website pages and the internal system our authorized
        staff use to run the business. Customers do not create accounts or sign in on this
        website; customer information is recorded by our staff while serving your
        transaction.
      </p>

      <h2>3. Personal information we handle</h2>
      <p>Depending on your transaction, we may handle the following:</p>
      <ul>
        <li>
          Your name and contact details, such as your contact number and delivery address.
        </li>
        <li>
          Facebook and Messenger identity information, such as your Facebook name and the
          identifiers Facebook provides when you comment on or message our page.
        </li>
        <li>Order records, such as the items you ordered, prices, and order status.</li>
        <li>
          Payment records and payment references, such as amounts, channels, and reference
          numbers.
        </li>
        <li>Proof-of-payment images you send or upload.</li>
        <li>Delivery, shipping, and tracking information.</li>
        <li>
          Layaway records, such as down payments, installments, balances, and due dates.
        </li>
        <li>
          Customer service conversations with us, including messages sent through
          Messenger.
        </li>
        <li>
          Where applicable, captures and screenshots taken during our live selling, which
          may show your Facebook name or comment.
        </li>
        <li>Notes our staff record to serve your order.</li>
      </ul>
      <p>
        We aim to collect only the information that is reasonably necessary for your
        transaction. Our system also holds records about our own staff (for example,
        sign-in accounts, attendance, and payroll), which are used for employment and
        business administration.
      </p>

      <h2>4. How we collect it</h2>
      <ul>
        <li>
          Directly from you — in our store, through Messenger, by phone, or during live
          selling.
        </li>
        <li>From Facebook, when you comment on our live selling or message our page.</li>
        <li>
          From our staff, who record order, payment, delivery, and layaway details as they
          serve you.
        </li>
      </ul>

      <h2>5. Why we use it</h2>
      <ul>
        <li>To take, confirm, and fulfil your orders, and to keep records of them.</li>
        <li>To review and record your payments.</li>
        <li>
          To arrange delivery or pick-up and to share courier and tracking details with
          you.
        </li>
        <li>
          To manage layaway accounts, custom orders, repairs, and gold or scrap buying.
        </li>
        <li>
          To communicate with you about your transaction, including sending your order
          screenshot or invoice through Messenger.
        </li>
        <li>To provide customer service and handle concerns, returns, and disputes.</li>
        <li>
          To keep business, accounting, and tax records, and to keep our systems secure.
        </li>
      </ul>
      <p>
        We process personal information when it is needed to carry out the transaction you
        asked for, to comply with our legal obligations, or for our legitimate business
        interests, and with your consent where the law requires it.
      </p>

      <h2>6. Sharing and third-party processing</h2>
      <p>
        Authorized third-party technology and service providers may process or host
        information on our behalf for:
      </p>
      <ul>
        <li>website and application hosting;</li>
        <li>database and file storage;</li>
        <li>messaging and customer communication; and</li>
        <li>payment- and delivery-related operations.</li>
      </ul>
      <p>
        We share only the information reasonably needed for each purpose. We may also
        disclose information when required by law or by a lawful order of a government
        authority. We do not sell your personal information.
      </p>

      <h2>7. Where information is processed</h2>
      <p>
        Because we use third-party providers, some information may be stored or processed
        on servers located outside the Philippines.
      </p>

      <h2>8. How long we keep it</h2>
      <p>
        Personal and transactional information is retained only for as long as reasonably
        necessary for business operations, legal and accounting requirements, dispute
        handling, security, and other legitimate purposes, after which it may be securely
        deleted or anonymized where appropriate.
      </p>

      <h2>9. How we protect it</h2>
      <p>
        We use reasonable organizational, physical, and technical measures to protect
        personal information, including limiting access to authorized staff. No method of
        storage or transmission is completely secure, so please contact us right away if
        you believe your information has been misused.
      </p>

      <h2>10. Cookies</h2>
      <p>
        Our website does not use advertising or analytics tracking. The cookies and
        browser storage it does use are described in our{' '}
        <Link href="/cookie-policy">Cookie Policy</Link>.
      </p>

      <h2>11. Your rights</h2>
      <p>
        Under the Data Privacy Act, you have the right to be informed, to access, to
        object, to correct, to erasure or blocking, to data portability, and to damages,
        and the right to file a complaint with the National Privacy Commission
        (privacy.gov.ph). To make a request, email us at the address in Section 13. We may
        need to confirm your identity before acting on a request.
      </p>

      <h2>12. Other matters</h2>
      <p>
        Our services are not directed at children, and we do not knowingly collect their
        information. Facebook, Messenger, and other services we use operate under their
        own privacy policies, which this policy does not cover. We may update this policy
        from time to time; the Effective Date above shows when the current version took
        effect.
      </p>

      <h2>13. Contact us</h2>
      <p>For privacy questions or requests, email us or visit our store:</p>
      <LegalBusinessDetails />
    </LegalArticle>
  );
}
