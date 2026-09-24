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
| Footer links (unchanged)                        | `src/components/shell/site-footer.tsx`                                 |
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

Other confirmed rules used in the pages:

- Payment channels **may include** BDO, BPI, GCash, Remittance, Cash on Delivery, where applicable; not
  every method for every transaction; the business confirms the method before completion.
- Delivery: nationwide in the Philippines, may accommodate international; couriers may include own
  riders, LBC, FedEx, DHL; no fixed delivery fee; timelines depend on courier and destination; courier
  and tracking details provided when available.
- Item release: neutral wording only ("Applicable payment and release requirements will be confirmed
  before fulfillment.").
- Layaway required down payment: 20%.
- Custom orders / repairs: deposit at least ₱2,000; repair/resizing warranty or re-work period 2–3 weeks.
- Gold / scrap buying: based on the current daily 24-karat gold rate; final after (1) the seller agrees
  to the price, (2) payment is accepted/received, (3) the receipt is issued/provided.
- Defect reporting channels: phone call, Messenger, in-store (no phone number shown).
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

The Owner did not tick them on the 2026-09-25 form, so ask the Owner to re-confirm them (items 5 and 6).

## (b) Client confirmations still required

- [ ] 1. **AMLC status.** Nothing on the public site claims AMLC compliance or registration (the
      "AMLC Compliant" badge was removed from the home page). Add a claim only after the Owner confirms it.
- [ ] 2. **Official contact number.** No number appears on the legal pages. Note: the home page
      (`src/app/page.tsx`) and the footer (`src/components/shell/site-footer.tsx`) still show
      0917-203-5820, 0919-096-9617 and 0919-097-5063 from an earlier version. The Owner should confirm
      whether these are current.
- [ ] 3. **Item release after verified payment.** Pages use neutral wording only.
- [ ] 4. **Cash on Delivery**, if confirmation is needed beyond the supplied payment list.
- [ ] 5. **3-calendar-month layaway maximum**: retained (approved rule in the app; see above). Owner
      re-confirmation recommended.
- [ ] 6. **10-day layaway grace period**: retained (approved rule in the app; see above). Owner
      re-confirmation recommended.
- [ ] 7. **Cancelled / incomplete layaway payments**: whether refundable, non-refundable, or store
      credit. The pages only ask the customer to contact the business.
- [ ] 8. **Custom-order turnaround time.** No time is stated.
- [ ] 9. **Deposit cancellation / refund rule** after work begins. No rule is stated.
- [ ] 10. **Exact defect-reporting period.** Pages say "as soon as reasonably possible".
- [ ] 11. **Change-of-mind return rule.** Pages say only that other return requests will be reviewed.
- [ ] 12. **Refund method.** Pages say it will be communicated after review and approval.
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
