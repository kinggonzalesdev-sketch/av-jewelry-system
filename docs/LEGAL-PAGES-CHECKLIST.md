# Legal pages — developer checklist

The four public legal pages (Privacy Policy, Terms & Conditions, Refund & Cancellation Policy, Cookie
Policy) were rewritten on 2026-09-25 from the Owner's written specification. This note lists the
confirmed details they use, what the Owner still has to confirm, and what to do at go-live. It is for
developers, not customers.

Final Philippine legal review is recommended before relying on these policies as final legal documents.

## Where things are

| What                                            | File                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Business identity + Effective Date (one source) | `src/lib/legal/legal-info.ts`                                          |
| Business-details block shown on every page      | `src/components/legal/legal-business-details.tsx`                      |
| Shared page wrapper (title, Effective Date)     | `src/components/legal/legal-article.tsx`                               |
| Pages                                           | `src/app/(legal)/{privacy,terms,refund-policy,cookie-policy}/page.tsx` |
| Footer (links, contact numbers, official email) | `src/components/shell/site-footer.tsx`                                 |
| Tests                                           | `tests/unit/legal-pages.test.tsx`                                      |

## (a) Confirmed business details used

| Field                    | Value                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| Registered business name | A.V DE ASIS JEWELRY SHOP                                         |
| Trading / website brand  | A.V. Jewelry                                                     |
| DTI Registration Number  | 3510095                                                          |
| BIR / TIN                | 717-116-304-00000                                                |
| Official email           | aprilvergeldeasis1980@yahoo.com.ph                               |
| Business address         | #84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan |
| Business / support hours | 8:00 AM – 5:00 PM                                                |
| Contact numbers          | 0917-203-5820, 0919-096-9617, 0919-097-5063 (confirmed current)  |
| AMLC                     | Compliant (Owner confirmed 2026-09-25)                           |

Other confirmed rules used in the pages:

- Payment channels **may include** BDO, BPI, GCash, Credit Card, Remittance, Cash on Delivery, where applicable; not
  every method for every transaction; the business confirms the method before completion.
- Delivery: nationwide in the Philippines, may accommodate international; couriers may include own
  riders, LBC, FedEx, DHL; no fixed delivery fee; timelines depend on courier and destination; courier
  and tracking details provided when available.
- Item release: after the payment is verified; Cash on Delivery needs a down payment of at least ₱1,000
  first, and the balance is paid on delivery.
- Layaway required down payment: 20%.
- Custom orders / repairs: deposit at least ₱2,000; repair/resizing warranty or re-work period 2–3 weeks.
- Gold / scrap buying: based on the current daily 24-karat gold rate; final after (1) the seller agrees
  to the price, (2) payment is accepted/received, (3) the receipt is issued/provided.
- Defect reporting channels: phone call, Messenger, in-store. The shop discusses the problem with the
  customer and resolves it as both agree (no fixed reporting period).
- Refund processing: generally 2–3 business days, subject to the payment channel and financial
  institution.

### Layaway 3-month maximum and 10-day grace period

Both are **retained** in the Terms because they are already the approved business rules the app enforces:

- `docs/PHASE-6-APPROVED-DECISIONS.md` §6 — "Maximum duration: 3 months. Maximum grace: 10 calendar days
  after the final due date" (approved by the Owner on 2026-07-15).
- `src/lib/validation/payments.ts` — `LAYAWAY_MAX_MONTHS = 3`, `LAYAWAY_MAX_GRACE_DAYS = 10`,
  `LAYAWAY_DEPOSIT_PERCENT = 20`.
- Database (migration files): `layaway_arrangements.grace_period_days` is limited to 0–10 (default 10)
  and `layaway_arrangements.months` to 1–3.

The Owner re-confirmed both on 2026-09-25 (answers 5 and 6 below).

## (b) Owner answers (2026-09-25) — applied to the pages

| #   | Question                                        | Owner answer (summary)                                            | Where it is used                 |
| --- | ----------------------------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| 1   | AMLC status                                     | Compliant                                                         | Terms §1, Privacy §5, home badge |
| 2   | Contact numbers                                 | The three numbers on the site are current                         | Every legal page, footer, home   |
| 3   | Item release                                    | After payment is verified; COD needs at least ₱1,000 down payment | Terms §4 and §6                  |
| 4   | Cash on Delivery                                | Accepted, with the ₱1,000 deposit                                 | Terms §4 and §6                  |
| 5   | 3-month layaway maximum                         | Confirmed                                                         | Terms §7                         |
| 6   | 10-day grace period                             | Confirmed                                                         | Terms §7                         |
| 7   | Cancelled / incomplete layaway payments         | Forfeited, not refunded                                           | Terms §7, Refund §4              |
| 8   | Custom-order turnaround                         | Depends; usually released as soon as fully paid                   | Terms §8                         |
| 9   | Deposit when a custom order/repair is cancelled | Can be refunded or transferred to another item                    | Terms §8, Refund §3              |
| 10  | Defect-reporting period                         | Contact the shop; resolved as both agree                          | Refund §1                        |
| 11  | Change-of-mind returns                          | Not accepted (item may be used); the customer may sell it instead | Refund §2                        |
| 12  | Refund method                                   | GCash or cash, as the customer prefers                            | Refund §7                        |
| —   | Credit card                                     | Accepted                                                          | Terms §4, home page              |
| —   | Footer email                                    | The confirmed official email replaces the old placeholder         | Footer                           |

Answer 11 wording: "you may sell it instead, including to us under our gold and scrap buying terms" reads the
Owner's "pwede niyang ibenta" as selling it, including back to the shop. Confirm or adjust.

## (c) Still open

- [ ] **Data-retention schedule** (internal policy item). The Privacy Policy uses general retention
      wording with no durations; an exact schedule still needs to be set.
- [ ] **Effective Date at go-live.** `LEGAL_EFFECTIVE_DATE_ISO` in `src/lib/legal/legal-info.ts` is
      set to `2026-09-25` because the pages are not yet published. Change it to the actual go-live date
      when they are published. Never back-date it.

## Cookie and browser-storage audit (2026-09-25)

The Cookie Policy describes only what the code uses. Re-run this audit before changing the page.

- **Sign-in cookies**: Supabase `sb-*` auth cookies via `@supabase/ssr` (`src/lib/supabase/server.ts`,
  `src/lib/supabase/proxy.ts`, `src/lib/supabase/client.ts`; lifetime and `Secure` flag in
  `src/lib/supabase/cookies.ts`; removed on sign-out in `src/lib/auth/actions.ts`).
- **Attendance device cookie**: `av_att_device`, httpOnly, set only when the Owner registers a device
  (`src/lib/hr/devices.ts`).
- **localStorage preferences**: `av-theme` (`src/components/shell/theme.ts`), `av-privacy-mode`
  (`src/components/shell/privacy.tsx`), `mineflow.sidebarCollapsed`
  (`src/components/shell/app-sidebar.tsx`), `mineflow.installDismissedAt`
  (`src/components/pwa/install-mineflow.tsx`), `mineflow-sticker-fields-v2` and
  `mineflow-sticker-price-per-gram` (`src/lib/print/sticker-fields.ts`), `mineflow.captureAutoPrint`
  (`src/components/print/sticker-print-panel.tsx`), `mineflow.capturePrinted`
  (`src/components/capture/incoming-captures-strip.tsx`).
- **Service worker cache**: `public/sw.js`, registered in production by
  `src/components/pwa/pwa-provider.tsx`; caches static files and the `/offline` page only.
- **Not used**: `document.cookie`, sessionStorage, IndexedDB, and any analytics, advertising pixel, or
  third-party tracking script (none in `package.json`; the only inline script in `src/app/layout.tsx` is
  the theme initializer).
