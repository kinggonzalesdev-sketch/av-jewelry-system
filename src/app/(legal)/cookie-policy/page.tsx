import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalArticle } from '@/components/legal/legal-article';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'A.V. Jewelry uses only strictly-necessary cookies and no advertising or analytics trackers.',
  robots: { index: true, follow: true },
};

export default function CookiePolicyPage() {
  return (
    <LegalArticle title="Cookie Policy">
      <p>
        This page explains the cookies and similar technologies this website uses. In short: we use
        only what is <strong>strictly necessary</strong> to sign staff in and keep the app working.
        We do <strong>not</strong> use advertising or analytics cookies, and there is no third-party
        tracking — so no cookie-consent banner is required.
      </p>

      <h2>What we use</h2>
      <h3>Strictly necessary</h3>
      <ul>
        <li>
          <strong>Authentication session</strong> (set by our provider, Supabase) — keeps a signed-in
          staff member signed in. Without it, the internal app cannot work. It is not used for
          advertising.
        </li>
        <li>
          <strong>Attendance device token</strong> — identifies the registered shop device so staff
          attendance can be recorded securely.
        </li>
      </ul>
      <h3>Functional (stored on your own device, not shared)</h3>
      <ul>
        <li>
          Small preferences saved in your browser&apos;s local storage — for example your light/dark
          theme, whether the sidebar is collapsed, and cached print settings. These stay on your
          device and are not sent to us or anyone else.
        </li>
      </ul>

      <h2>What we do NOT use</h2>
      <ul>
        <li>No Google Analytics, Meta/Facebook Pixel, TikTok, Hotjar, or similar analytics.</li>
        <li>No advertising or retargeting cookies.</li>
        <li>No cross-site trackers or data brokers.</li>
      </ul>

      <h2>Managing cookies</h2>
      <p>
        Because we use only strictly-necessary and first-party functional storage, there is nothing
        optional to switch off, and no consent banner is shown. You can still clear cookies and site
        data from your browser settings at any time; note that clearing the authentication cookie
        will sign staff out.
      </p>

      <h2>More information</h2>
      <p>
        See our <Link href="/privacy">Privacy Policy</Link> for how we handle personal information
        overall.
      </p>
    </LegalArticle>
  );
}
