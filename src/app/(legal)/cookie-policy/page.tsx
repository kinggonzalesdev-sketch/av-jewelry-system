import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';
import { LegalBusinessDetails } from '@/components/legal/legal-business-details';
import { LEGAL_BUSINESS } from '@/lib/legal/legal-info';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'The cookies and browser storage the A.V. Jewelry website uses. No advertising or analytics tracking.',
  robots: { index: true, follow: true },
};

/*
 * Every item below is backed by the code (audit 2026-09-25, see docs/LEGAL-PAGES-CHECKLIST.md):
 * Supabase `sb-*` sign-in cookies, the `av_att_device` attendance-device cookie, a handful of
 * localStorage preference keys, and the PWA service worker's static-file cache. There is no
 * analytics, advertising pixel, or third-party tracking script. Update this page if that changes.
 */
export default function CookiePolicyPage() {
  return (
    <LegalArticle title="Cookie Policy">
      <p>
        This Cookie Policy explains the cookies and similar technologies, such as browser
        storage, that the <strong>{LEGAL_BUSINESS.brand}</strong> website uses. It
        describes only the technologies the website actually uses.
      </p>

      <h2>1. Essential sign-in and session cookies</h2>
      <p>
        These cookies are needed for our staff system to work. They are used only when an
        authorized staff member signs in; customers do not sign in on this website.
      </p>
      <ul>
        <li>
          <strong>Sign-in session cookies</strong> — keep a staff member securely signed
          in. They are refreshed while in use and removed when the staff member signs out.
        </li>
        <li>
          <strong>Shop device cookie</strong> — identifies the shop device registered for
          staff attendance. It is set only on a device that our owner registers.
        </li>
      </ul>

      <h2>2. Security and preferences (browser storage)</h2>
      <p>
        The website saves a few settings in your browser&apos;s local storage so it works
        the way you set it. These settings stay on that device and are not used for
        tracking or advertising. They include:
      </p>
      <ul>
        <li>your light or dark display theme, if you have chosen one;</li>
        <li>
          remembered screen settings in the staff system, such as whether the side menu is
          collapsed, whether sensitive values are hidden on screen, and whether the
          install-app prompt was dismissed; and
        </li>
        <li>
          printing settings on staff devices, such as sticker settings, the
          automatic-printing setting, and a record of recently printed stickers so the
          same sticker is not printed twice.
        </li>
      </ul>

      <h2>3. Offline and app files</h2>
      <p>
        In supported browsers, the website may install a small background script (a
        service worker) that keeps copies of its static files — such as program files,
        icons, brand images, and a simple offline page — in your browser&apos;s cache.
        This helps the website load faster and show an offline notice when there is no
        connection. It is designed not to store pages containing customer, order, or
        payment information.
      </p>

      <h2>4. Analytics</h2>
      <p>We do not currently use analytics cookies or analytics tools on this website.</p>

      <h2>5. Advertising and tracking</h2>
      <p>
        We do not use advertising, marketing, or third-party tracking cookies, such as
        advertising pixels. If you follow a link to another website, that website&apos;s
        own cookie policy applies.
      </p>

      <h2>6. Managing cookies and storage</h2>
      <p>
        You can clear cookies and site data at any time in your browser settings. Clearing
        them signs staff out of the staff system and resets any saved settings on that
        device.
      </p>

      <h2>7. Changes and contact</h2>
      <p>
        We may update this policy if the technologies we use change; the Effective Date
        above shows when the current version took effect. See our{' '}
        <Link href="/privacy">Privacy Policy</Link> for how we handle personal
        information.
      </p>
      <LegalBusinessDetails />
    </LegalArticle>
  );
}
