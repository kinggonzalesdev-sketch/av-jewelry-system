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
 * Public legal pages (Owner specification 2026-09-25, plus the Owner's answers to the 12 open
 * questions the same day). Guards the confirmed business identity, contact numbers and AMLC
 * statement, the Effective Date, the confirmed layaway / deposit / return / refund terms, and the
 * things the pages must NOT say (no store credit, no guarantee, no leftover placeholders).
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

/** The three contact numbers the Owner confirmed as current (2026-09-25). */
const PHONES = ['0917-203-5820', '0919-096-9617', '0919-097-5063'];

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

  it.each(PAGES)(
    '$name shows the three confirmed contact numbers as call links',
    ({ element }) => {
      const { text, container } = textOf(element());
      for (const phone of PHONES) {
        expect(text).toContain(phone);
        const digits = phone.replace(/-/g, '');
        expect(container.querySelector(`a[href="tel:${digits}"]`)?.textContent).toBe(
          phone,
        );
      }
    },
  );

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
      phones: PHONES,
    });
    expect(LEGAL_POLICY).toEqual({
      minimumDeposit: '₱2,000',
      repairReworkPeriod: '2–3 weeks',
      codDownPayment: '₱1,000',
    });
  });
});

describe('legal pages — AMLC (Owner confirmed compliance, 2026-09-25)', () => {
  it('Terms states compliance with the AMLA and the AMLC rules', () => {
    const { text } = textOf(<TermsPage />);
    expect(text).toContain(
      'We comply with the Anti-Money Laundering Act of 2001 (Republic Act No. 9160), as amended, and the rules of the Anti-Money Laundering Council (AMLC).',
    );
  });

  it('Privacy Policy names anti-money-laundering compliance as a legal purpose', () => {
    const { text } = textOf(<PrivacyPolicyPage />);
    expect(text).toContain(
      'To comply with our legal obligations, including the Anti-Money Laundering Act',
    );
  });

  it('the public home page shows the AMLC Compliant badge again', () => {
    const { text } = textOf(<LandingPage />);
    expect(text).toContain('AMLC Compliant');
  });
});

describe('legal pages — what they must not say', () => {
  it.each(PAGES)('$name promises no store credit and no guarantee', ({ element }) => {
    const { text } = textOf(element());
    // Cancelled layaway payments are forfeited (Owner), never store credit.
    expect(text).not.toMatch(/store credit/i);
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
  it('Terms lists the payment channels, including Credit Card and Remittance, without promising all of them', () => {
    const { text } = textOf(<TermsPage />);
    for (const method of [
      'BDO',
      'BPI',
      'GCash',
      'Credit Card',
      'Remittance',
      'Cash on Delivery',
    ]) {
      expect(text).toContain(method);
    }
    expect(text).toContain(
      'Not every payment method is available for every transaction, destination, or order.',
    );
    expect(text).toContain(
      'Cash on Delivery requires a down payment of at least ₱1,000 before the item is released for delivery.',
    );
  });

  it('Terms states delivery, release, layaway, custom-order, and scrap-buying terms', () => {
    const { text } = textOf(<TermsPage />);
    expect(text).toContain(
      'A.V. Jewelry serves customers nationwide in the Philippines and may also accommodate international deliveries.',
    );
    for (const courier of ['LBC', 'FedEx', 'DHL']) expect(text).toContain(courier);
    expect(text).toContain('Items are released after your payment has been verified.');
    expect(text).toContain('20% of the total layaway amount payable');
    expect(text).toContain('3 calendar months');
    expect(text).toContain('up to 10 calendar days after the final due date');
    expect(text).toContain(
      'If you cancel a layaway, or it is not fully paid by the end of the layaway period and grace period, the payments you have made are forfeited and will not be refunded.',
    );
    expect(text).toContain('at least ₱2,000');
    expect(text).toContain('Usually, the item is released as soon as it is fully paid.');
    expect(text).toContain(
      'If you cancel a custom order or repair, your deposit can be refunded or transferred to another item.',
    );
    expect(text).toContain('2–3 weeks');
    expect(text).toContain('24-karat gold rate');
  });

  it('Refund Policy uses the confirmed defect, return, deposit, layaway, method, and timing wording', () => {
    const { text } = textOf(<RefundPolicyPage />);
    expect(text).toContain(
      'If an item has a defect, damage, or other problem, please contact the shop through any of these channels:',
    );
    expect(text).toContain(
      'We will discuss it with you, and the problem will be resolved in the way we agree on together.',
    );
    for (const channel of ['Phone call', 'Messenger', 'In person at our store']) {
      expect(text).toContain(channel);
    }
    expect(text).toContain(
      'We do not accept returns or exchanges because you changed your mind, since the item may already have been worn or used.',
    );
    // A change-of-mind rule never takes away the defect route.
    expect(text).toContain(
      'This does not apply to items with a defect, damage, or other problem',
    );
    expect(text).toContain('at least ₱2,000');
    expect(text).toContain('your deposit can be refunded or transferred to another item');
    expect(text).toContain(
      'the payments you have made are forfeited and will not be refunded',
    );
    expect(text).toContain('2–3 weeks');
    expect(text).toContain(
      'Approved refunds are paid through GCash or in cash, depending on what you prefer.',
    );
    expect(text).toContain(
      'Approved refunds are generally processed within 2–3 business days, subject to the applicable payment channel and financial institution processing time.',
    );
    // Philippine consumer rights are kept.
    expect(text).toContain('Consumer Act of the Philippines (Republic Act No. 7394)');
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

describe('site footer — business details', () => {
  it('shows the confirmed official email instead of the old placeholder', () => {
    const { container } = render(<SiteFooter />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/OWNER INPUT REQUIRED/i);
    expect(
      container.querySelector('a[href="mailto:aprilvergeldeasis1980@yahoo.com.ph"]')
        ?.textContent,
    ).toBe('aprilvergeldeasis1980@yahoo.com.ph');
    for (const phone of PHONES) expect(text).toContain(phone);
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
