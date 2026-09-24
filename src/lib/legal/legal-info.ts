/**
 * Single source of truth for the four public legal pages (Privacy, Terms, Refund & Cancellation,
 * Cookie). Owner specification 2026-09-25 — every value below was supplied and confirmed by the
 * Owner. Do not add a value here that the Owner has not confirmed (for example a contact number):
 * see docs/LEGAL-PAGES-CHECKLIST.md for the items still awaiting confirmation.
 */

/**
 * Effective date shown on every legal page (ISO, YYYY-MM-DD).
 *
 * ⚠️ The pages are not yet published. When they go live, set this to the actual go-live date
 * (see docs/LEGAL-PAGES-CHECKLIST.md). Never back-date it.
 */
export const LEGAL_EFFECTIVE_DATE_ISO = '2026-09-25';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * "2026-09-25" → "September 25, 2026". Parsed by hand (not `Date`/`Intl`) so the rendered text
 * never shifts with the server's or the visitor's timezone.
 */
export function formatLegalDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) throw new Error(`Invalid legal date: ${iso}`);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/** The Effective Date as displayed, e.g. "September 25, 2026". */
export const LEGAL_EFFECTIVE_DATE = formatLegalDate(LEGAL_EFFECTIVE_DATE_ISO);

/** Business identity confirmed by the Owner (2026-09-25). No contact number: not yet confirmed. */
export const LEGAL_BUSINESS = {
  registeredName: 'A.V DE ASIS JEWELRY SHOP',
  brand: 'A.V. Jewelry',
  dtiRegistrationNumber: '3510095',
  tin: '717-116-304-00000',
  email: 'aprilvergeldeasis1980@yahoo.com.ph',
  address: '#84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan',
  hours: '8:00 AM – 5:00 PM',
} as const;

/**
 * Policy values confirmed by the Owner (2026-09-25) that appear on more than one legal page, kept
 * here so the Terms and the Refund Policy always agree (and so route files hold no hard-coded peso
 * amounts — see tests/unit/placeholder-pages.test.tsx).
 */
export const LEGAL_POLICY = {
  /** Required deposit for custom orders and repairs. */
  minimumDeposit: '₱2,000',
  /** Repair / resizing warranty or re-work period. NOT the custom-order turnaround (unconfirmed). */
  repairReworkPeriod: '2–3 weeks',
} as const;
