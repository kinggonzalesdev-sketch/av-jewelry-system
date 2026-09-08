import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';

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
        This Privacy Policy explains how <strong>A.V. Jewelry</strong> (&quot;we&quot;,
        &quot;us&quot;) handles personal information, consistent with the Philippine{' '}
        <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>, its Implementing Rules
        and Regulations, and issuances of the National Privacy Commission (NPC).
      </p>

      <h2>1. Who we are (Personal Information Controller)</h2>
      <p>
        A.V. Jewelry, #84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan,
        Philippines. Phone: 0917-203-5820 / 0919-096-9617 / 0919-097-5063.
      </p>
      <p>
        Registered business name and registration details:{' '}
        <strong>[OWNER INPUT REQUIRED]</strong>. Data Protection Officer / privacy contact and
        email address for privacy requests: <strong>[OWNER INPUT REQUIRED]</strong>.
      </p>

      <h2>2. Scope</h2>
      <p>
        This system has two parts: a <strong>public information page</strong> (this website&apos;s
        landing page), which collects no personal information and sets no tracking; and an{' '}
        <strong>internal staff system</strong> used by our authorized staff to run the business.
        There is no public account sign-up and no customer login — customers do not create accounts
        here. Personal information about customers is entered and processed by our staff.
      </p>

      <h2>3. Personal information we process</h2>
      <h3>About customers</h3>
      <ul>
        <li>Name (and Facebook name/nickname where a live-selling purchase is involved).</li>
        <li>Contact number and, where provided, delivery address.</li>
        <li>Order, payment, and layaway records, including balances and account numbers.</li>
        <li>
          Payment reference numbers and proof-of-payment images, and item/&quot;capture&quot;
          screenshots taken during live selling.
        </li>
        <li>
          Facebook page-scoped identifiers and public comment text received when you comment on our
          live selling, via our messaging provider (see Section 6).
        </li>
        <li>Notes our staff add to serve your order.</li>
      </ul>
      <h3>About staff</h3>
      <ul>
        <li>Name, email, role, and account credentials (passwords are stored hashed by our provider).</li>
        <li>Attendance times and clock-in/clock-out selfie photos, and payroll/salary information.</li>
        <li>Device identifiers used to secure attendance on the shop device.</li>
      </ul>
      <p>
        We do <strong>not</strong> knowingly collect government ID numbers, health information, or
        other sensitive personal information through this system. We apply data minimization — we
        collect only what is reasonably necessary to serve the transaction.
      </p>

      <h2>4. How we collect it</h2>
      <ul>
        <li>Directly from you in-store, by phone, or during an online/live-selling transaction.</li>
        <li>Entered by our staff into the system while serving your order.</li>
        <li>
          From Facebook comments on our live selling, received through our messaging provider.
        </li>
      </ul>

      <h2>5. Why we process it, and our lawful basis</h2>
      <ul>
        <li>To take, fulfil, deliver, and keep records of your orders, payments, and layaway — <em>necessary to perform the transaction you asked for</em>.</li>
        <li>To contact you about your order and provide customer service — <em>transaction and our legitimate interest in serving you</em>.</li>
        <li>To send you your order&apos;s screenshot or invoice over Facebook Messenger — <em>with your engagement/consent through that channel</em>.</li>
        <li>To run attendance and payroll for staff — <em>employment and legal obligation</em>.</li>
        <li>To keep security, audit, tax, and accounting records — <em>legal obligation and legitimate interest</em>.</li>
      </ul>

      <h2>6. Analytics, cookies, and third parties we share with</h2>
      <p>
        We do <strong>not</strong> use Google Analytics, advertising pixels, or any third-party
        tracking on this website. The site uses only strictly-necessary cookies — see our{' '}
        <Link href="/cookie-policy">Cookie Policy</Link>.
      </p>
      <p>
        We do use trusted service providers (processors) to run the system. To be clear, we do{' '}
        <strong>not</strong> claim &quot;we never share your information&quot; — running the system
        necessarily involves these providers:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — database, authentication, and encrypted file storage (holds
          the records above).
        </li>
        <li>
          <strong>Vercel</strong> — website and application hosting; processes requests in transit.
        </li>
        <li>
          <strong>Pancake / pages.fm and Meta (Facebook Messenger)</strong> — used to receive live
          comments and to send your order screenshot/invoice to your Facebook conversation.
        </li>
        <li>
          <strong>Our email provider</strong> — sends account and password-reset emails to staff
          only. Provider: <strong>[OWNER INPUT REQUIRED]</strong>.
        </li>
      </ul>
      <p>
        We do not sell your personal information, and we do not share it for third-party
        advertising.
      </p>

      <h2>7. International processing</h2>
      <p>
        Some of these providers process data on servers that may be located outside the Philippines
        (for example, in Singapore). We rely on the provider&apos;s contractual and security
        commitments to protect it. <strong>[OWNER INPUT REQUIRED — confirm with counsel/DPO.]</strong>
      </p>

      <h2>8. How long we keep it</h2>
      <ul>
        <li>Facebook live-comment webhook data is automatically deleted after about 30 days.</li>
        <li>
          Order, payment, layaway, and accounting records are kept as long as needed to serve you
          and to meet tax, accounting, and legal requirements.{' '}
          <strong>[OWNER INPUT REQUIRED — specific retention periods.]</strong>
        </li>
        <li>
          Stored images (proof-of-payment, capture screenshots, attendance selfies) are retained
          until no longer needed; a formal storage-retention/erasure schedule is{' '}
          <strong>[OWNER INPUT REQUIRED]</strong>.
        </li>
      </ul>

      <h2>9. How we protect it</h2>
      <p>
        Access is restricted to authenticated, authorized staff; the database enforces row-level
        access rules; files are kept in a private store reachable only through short-lived signed
        links; traffic is encrypted in transit; and staff actions are recorded in an audit log.
      </p>

      <h2>10. Your rights</h2>
      <p>Under the Data Privacy Act, you have the right to be informed, to object, to access, to
        correct, to erasure or blocking, to data portability, to damages, and to complain to the
        NPC. Because customers do not have accounts here, you may exercise these rights by
        contacting us using the details in Section 1; our staff will act on your request.
      </p>

      <h2>11. Marketing</h2>
      <p>
        We contact you about your own orders. We do not run automated marketing tracking on this
        site. Any marketing messages would be sent only through channels you engaged with, and you
        may ask us to stop at any time.
      </p>

      <h2>12. Children</h2>
      <p>This system is not directed at children, and we do not knowingly collect their
        information.</p>

      <h2>13. External links</h2>
      <p>Facebook and our providers operate their own services under their own privacy policies;
        this policy does not cover them.</p>

      <h2>14. Changes</h2>
      <p>We may update this policy; the effective date above will change accordingly.</p>

      <h2>15. Contact for privacy requests</h2>
      <p>
        Privacy requests and questions: <strong>[OWNER INPUT REQUIRED — email/DPO contact]</strong>,
        or by phone using the numbers in Section 1. You may also complain to the National Privacy
        Commission (privacy.gov.ph).
      </p>
    </LegalArticle>
  );
}
