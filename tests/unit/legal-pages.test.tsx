import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import CookiePolicyPage, {
  metadata as cookieMeta,
} from '@/app/(legal)/cookie-policy/page';
import PrivacyPolicyPage, { metadata as privacyMeta } from '@/app/(legal)/privacy/page';
import RefundPolicyPage, {
  metadata as refundMeta,
} from '@/app/(legal)/refund-policy/page';
import TermsPage, { metadata as termsMeta } from '@/app/(legal)/terms/page';
import LandingPage from '@/app/page';
import { SiteFooter } from '@/components/shell/site-footer';
import {
  LEGAL_BUSINESS,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_EFFECTIVE_DATE_ISO,
  LEGAL_POLICY,
  formatLegalDate,
} from '@/lib/legal/legal-info';

/**
 * Public legal pages (Owner specification 2026-09-25). Guards the confirmed business identity,
 * the Effective Date, and the things the pages must NOT say: no AMLC claim, no contact number
 * (none confirmed yet), and no refund promise the Owner has not confirmed.
 */

const PAGES: Array<{ name: string; element: () => ReactElement; meta: unknown }> = [
  { name: 'Privacy Policy', element: () => <PrivacyPolicyPage />, meta: privacyMeta },
  { name: 'Terms & Conditions', element: () => <TermsPage />, meta: termsMeta },
  {
    name: 'Refund & Cancellation Policy',
    element: () => <RefundPolicyPage />,
    meta: refundMeta,
  },
  { name: 'Cookie Policy', element: () => <CookiePolicyPage />, meta: cookieMeta },
];

function textOf(element: ReactElement): { text: string; container: HTMLElement } {
  const { container } = render(element);
  // Collapse whitespace so assertions do not depend on JSX line wrapping.
  return { text: (container.textContent ?? '').replace(/\s+/g, ' '), container };
}

/** Philippine mobile (09xx / +639xx) and landline ((02) 8xxx-xxxx) number shapes. */
const PHONE_PATTERNS = [
  /(?:\+?63|\b0)[\s-]?9\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/,
  /\(0\d{1,2}\)\s?\d{3,4}[\s-]?\d{4}/,
];

describe('legal pages — shared details', () => {
  it.each(PAGES)('$name shows the confirmed business identity', ({ element }) => {
    const { text, container } = textOf(element());
    expect(text).toContain('A.V DE ASIS JEWELRY SHOP');
    expect(text).toContain('3510095');
    expect(text).toContain('717-116-304-00000');
    expect(text).toContain('aprilvergeldeasis1980@yahoo.com.ph');
    expect(text).toContain(
      '#84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan',
    );
    expect(text).toContain('8:00 AM – 5:00 PM');
    expect(
      container.querySelector('a[href="mailto:aprilvergeldeasis1980@yahoo.com.ph"]'),
    ).not.toBeNull();
  });

  it.each(PAGES)('$name shows the shared Effective Date', ({ element }) => {
    const { container } = textOf(element());
    const line = container.querySelector('[data-testid="legal-effective-date"]');
    expect(line?.textContent).toMatch(/Effective Date:\s*September 25, 2026/);
    expect(line?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-25');
  });

  it('formats the Effective Date from one ISO constant', () => {
    expect(LEGAL_EFFECTIVE_DATE_ISO).toBe('2026-09-25');
    expect(LEGAL_EFFECTIVE_DATE).toBe('September 25, 2026');
    expect(formatLegalDate('2027-01-05')).toBe('January 5, 2027');
    expect(() => formatLegalDate('2026-13-01')).toThrow();
  });

  it('keeps the business identity constants exactly as confirmed', () => {
    expect(LEGAL_BUSINESS).toEqual({
      registeredName: 'A.V DE ASIS JEWELRY SHOP',
      brand: 'A.V. Jewelry',
      dtiRegistrationNumber: '3510095',
      tin: '717-116-304-00000',
      email: 'aprilvergeldeasis1980@yahoo.com.ph',
      address: '#84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan',
      hours: '8:00 AM – 5:00 PM',
    });
    expect(LEGAL_POLICY).toEqual({
      minimumDeposit: '₱2,000',
      repairReworkPeriod: '2–3 weeks',
    });
  });
});

describe('legal pages — what they must not say', () => {
  it.each(PAGES)('$name makes no AMLC claim', ({ element, meta }) => {
    const { text } = textOf(element());
    expect(text).not.toMatch(/AMLC|anti-money/i);
    expect(JSON.stringify(meta)).not.toMatch(/AMLC/i);
  });

  it('the public home page makes no AMLC claim', () => {
    const { text } = textOf(<LandingPage />);
    expect(text).not.toMatch(/AMLC/i);
  });

  it.each(PAGES)('$name shows no contact number (none confirmed)', ({ element }) => {
    const { text, container } = textOf(element());
    for (const pattern of PHONE_PATTERNS) expect(text).not.toMatch(pattern);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it.each(PAGES)('$name makes no unconfirmed refund promise', ({ element }) => {
    const { text } = textOf(element());
    expect(text).not.toMatch(/non[- ]?refundable/i);
    expect(text).not.toMatch(/store credit/i);
    expect(text).not.toMatch(/change[- ]of[- ]mind/i);
    expect(text).not.toMatch(/no refunds?\b/i);
    expect(text).not.toMatch(/guarantee/i);
  });

  it.each(PAGES)('$name has no leftover draft placeholders', ({ element }) => {
    const { text } = textOf(element());
    expect(text).not.toMatch(
      /OWNER INPUT REQUIRED|LAWYER REVIEW REQUIRED|Draft pending review/i,
    );
  });
});

describe('legal pages — Owner-specified wording', () => {
  it('Terms lists the payment channels, including Remittance, without promising all of them', () => {
    const { text } = textOf(<TermsPage />);
    for (const method of ['BDO', 'BPI', 'GCash', 'Remittance', 'Cash on Delivery']) {
      expect(text).toContain(method);
    }
    expect(text).toContain(
      'Not every payment method is available for every transaction, destination, or order.',
    );
  });

  it('Terms states delivery, release, layaway, custom-order, and scrap-buying terms', () => {
    const { text } = textOf(<TermsPage />);
    expect(text).toContain(
      'A.V. Jewelry serves customers nationwide in the Philippines and may also accommodate international deliveries.',
    );
    for (const courier of ['LBC', 'FedEx', 'DHL']) expect(text).toContain(courier);
    expect(text).toContain(
      'Applicable payment and release requirements will be confirmed before fulfillment.',
    );
    expect(text).toContain('20% of the total layaway amount payable');
    expect(text).toContain('at least ₱2,000');
    expect(text).toContain('2–3 weeks');
    expect(text).toContain('24-karat gold rate');
  });

  it('Refund Policy uses the confirmed reporting, method, and timing wording', () => {
    const { text } = textOf(<RefundPolicyPage />);
    expect(text).toContain(
      'Customers should report any defect, damage, or problem as soon as reasonably possible after receiving the item.',
    );
    expect(text).toContain('at least ₱2,000');
    expect(text).toContain('2–3 weeks');
    for (const channel of ['Phone call', 'Messenger', 'In person at our store']) {
      expect(text).toContain(channel);
    }
    expect(text).toContain(
      'The applicable refund method will be communicated after the request is reviewed and approved.',
    );
    expect(text).toContain(
      'Approved refunds are generally processed within 2–3 business days, subject to the applicable payment channel and financial institution processing time.',
    );
  });

  it('Privacy Policy uses the confirmed retention wording', () => {
    const { text } = textOf(<PrivacyPolicyPage />);
    expect(text).toContain(
      'Personal and transactional information is retained only for as long as reasonably necessary',
    );
  });

  it('Cookie Policy describes no analytics or advertising tracking', () => {
    const { text } = textOf(<CookiePolicyPage />);
    expect(text).toContain(
      'We do not currently use analytics cookies or analytics tools',
    );
    expect(text).toContain(
      'We do not use advertising, marketing, or third-party tracking cookies',
    );
  });
});

describe('site footer — legal links', () => {
  it('links all four legal pages to routes that exist', () => {
    const { container } = render(<SiteFooter />);
    const nav = container.querySelector('nav[aria-label="Legal"]');
    const links = [...(nav?.querySelectorAll('a') ?? [])].map((a) => ({
      label: a.textContent,
      href: a.getAttribute('href') ?? '',
    }));
    expect(links).toEqual([
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms & Conditions', href: '/terms' },
      { label: 'Refund & Cancellation Policy', href: '/refund-policy' },
      { label: 'Cookie Policy', href: '/cookie-policy' },
    ]);
    for (const { href } of links) {
      const page = join(
        process.cwd(),
        'src',
        'app',
        '(legal)',
        href.slice(1),
        'page.tsx',
      );
      expect(existsSync(page), `${href} → ${page}`).toBe(true);
    }
  });
});
