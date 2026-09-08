# Legal & Compliance Audit — A.V. Jewelry / MineFlow

Date: 2026-09-08 · Primary jurisdiction: Philippines · Auditor role: full-stack + privacy +
accessibility + security + PH compliance.

> This is a technical risk-reduction audit, not legal advice, and does not certify the site as
> "compliant" or "lawsuit-proof." Items needing a person are flagged **OWNER INPUT REQUIRED** or
> **LEGAL REVIEW REQUIRED**. Companion files: `OWNER_INPUT_REQUIRED.md`, `IMAGE_ASSET_AUDIT.md`.

## Executive Summary

**Overall risk: MODERATE.**

What this project actually is matters for scoping: it is **(1) one public, indexed marketing landing
page** for a physical gold-jewelry store in Guiguinto, Bulacan, plus **(2) a staff-only internal
operations system** (no public sign-up, no customer login, `noindex`). It is **not** a consumer
e-commerce website — there is **no public checkout, cart, subscription, or online payment**, and
**no third-party analytics, advertising, or tracking** of any kind (only `@supabase/*` dependencies).

Because of that, several classic e-commerce risks **do not apply** (cookie-consent banners, checkout
terms, form-consent checkboxes, fake reviews/scarcity) — they are documented as "not applicable"
rather than fake-implemented. The residual risk is concentrated in **(a) unverified regulatory/price
claims on the public page**, **(b) missing business + privacy facts only the owner can supply**, and
**(c) Data Privacy Act organizational obligations** over the substantial staff + customer personal
data the internal system processes. One genuine **security bug was found and fixed**.

## Critical Issues
None. No route exposes personal data to an unauthenticated/public caller; the storage bucket is
private; no secrets are shipped to the client.

## High Risk Issues

| # | Risk | Location | Reason | Fix | Status |
|---|---|---|---|---|---|
| H1 | Broken function-level authorization — full customer-PII CSV reachable by under-privileged staff | `src/app/api/inventory/completed/export/route.ts`, `src/app/api/layaway/export/route.ts` | Both export endpoints only relied on the RPC's coarse `is_active_staff()` check, **not** the page permission (`nav_inventory` / `nav_layaway`). Any active staff member who cannot open those pages could still GET the URL and download the entire dataset (names, invoices, amounts, balances, financers). | Added the same `canOpenPage(...)` gate the pages enforce → 403 otherwise. | **FIXED** |
| H2 | Unverified regulatory claims published to the public | `src/app/page.tsx:38-44` — "DTI Registered", "BIR Registered", "AMLC Compliant" | Publishing false/again-unverifiable government-registration claims is a serious consumer-protection (and potentially criminal misrepresentation) risk. Cannot be verified from code. | Owner must confirm each is true (ideally publish the reg number) or remove it. Not altered unilaterally (removing true claims would be wrong). | **OWNER INPUT REQUIRED** |

## Medium Risk Issues

| # | Risk | Location | Reason | Fix | Status |
|---|---|---|---|---|---|
| M1 | Unsubstantiated superlative price claim | `src/app/page.tsx:42` — "Best Price Gold Buyers" | Unqualified "Best Price" is a deceptive-claim risk under RA 7394 / DTI rules unless provable. | Flagged; offered a conservative rewrite ("Fair/Competitive Gold Buying"). Awaiting owner decision. | **OWNER INPUT REQUIRED** |
| M2 | No privacy notice / terms / refund policy existed for a business processing significant personal data | (whole site) | DPA expects a reachable privacy notice; the business runs consumer transactions (layaway, custom orders, gold buying). | Added accurate `/privacy` + `/cookie-policy`, and `/terms` + `/refund-policy` skeletons with owner placeholders; added a site footer linking them. | **PARTIALLY FIXED** (content drafted; owner facts + lawyer review pending) |
| M3 | Stored images retained indefinitely; deleting an attendance record orphans its selfie | `src/lib/hr/attendance.ts`; `supabase/migrations/20260716300000_attachments_storage.sql` | No storage retention/erasure schedule; a deleted attendance row leaves the facial selfie in the bucket. DPA data-minimization/retention concern (selfies are facial images). | Flagged; recommend a retention schedule + cascade selfie deletion. Not auto-implemented (data-affecting; owner policy needed). | **OWNER INPUT REQUIRED** |
| M4 | `/m/[token]` customer screenshot link may be unreachable (or its public intent unclear) | `src/app/m/[token]/page.tsx` vs `PUBLIC_ROUTES` in `src/lib/supabase/proxy.ts` | The page is documented as a public customer link but is **not** in `PUBLIC_ROUTES`, so an unauthenticated visitor is redirected to sign-in. Either a functional bug or the doc is stale. | Flagged for owner/dev to confirm intended behavior (do customers actually open these links unauthenticated?). Not changed blind. | **OWNER INPUT REQUIRED** |

## Low Risk Issues

| # | Risk | Location | Reason | Fix | Status |
|---|---|---|---|---|---|
| L1 | Non-constant-time secret comparison (cron/webhook) | `src/app/api/cron/*`, `src/app/api/webhooks/pancake/route.ts` | `!==` / `includes()` are not timing-safe (minor for high-entropy secrets over HTTPS). | Recommend `crypto.timingSafeEqual`. Not changed (low value; out of compliance scope). | **NOTED** |
| L2 | Webhook accepts secret via `?secret=` query param | `src/app/api/webhooks/pancake/route.ts` | Query-string secrets can leak into proxy/access logs. | Recommend header-only + HMAC body signature. | **NOTED** |

## Privacy Risks (RA 10173 — Data Privacy Act)
- **Applicable and real:** the internal system is a Personal Information Controller processing
  substantial **customer** data (name, contact, address, order/payment/layaway records, payment
  reference numbers, proof-of-payment + capture screenshots, Facebook page-scoped IDs + comment text)
  and **staff** data (name, email, role, payroll/salary, attendance times + **clock-in/out facial
  selfies**, device tokens). Full map in the PII data-flow audit (summarized in `/privacy`).
- **Processors/third parties:** Supabase (DB/auth/storage), Vercel (hosting), Pancake/pages.fm + Meta
  (messaging), email/SMTP provider **[OWNER INPUT]**. Disclosed truthfully in `/privacy` (we do **not**
  claim "we never share").
- **Retention:** only Facebook webhook events have a policy (30-day auto-prune). Everything else,
  including facial selfies and capture screenshots, is retained indefinitely — **M3**.
- **Sensitive data:** no government IDs/health data collected. Attendance **selfies are facial
  images** — treat with care (retention + access).
- **Data-subject rights:** exercisable via staff (no customer portal). Documented in `/privacy §10`.
- **OWNER INPUT:** DPO/privacy contact + email, retention periods, international-transfer wording,
  registration of the processing where required.

## Cookie / Tracking Risks
- **NOT CURRENTLY REQUIRED** to show a cookie-consent banner. The only cookies are strictly-necessary
  (Supabase auth session; attendance device token) and first-party functional local storage
  (theme, sidebar, print settings). **Zero** analytics/advertising/tracking exists in the codebase.
- Documented accurately in the new `/cookie-policy`. **No banner was added** (adding one would be
  misleading theater).

## Consumer Protection Risks (RA 7394 Consumer Act; RA 11967 Internet Transactions Act)
- No public online checkout, so website-checkout consumer rules mostly do not apply. **But** the
  business does consumer transactions (layaway, custom orders, gold buying, live selling, "online
  transactions" advertised) and likely qualifies as an online business under the ITA → needs
  business-identity disclosure + a redress path (added via footer + policy pages) and truthful claims.
- Refund/cancellation rules for the real transactions are **skeletoned** with owner placeholders and
  a statutory-rights-preserved stance (no improper "no refund" blanket). **Layaway/custom-deposit
  forfeiture must be fair** — flagged for lawyer review.

## Accessibility Issues (WCAG 2.2 AA)
Already good (verified): image alt text, icon-button accessible names, `prefers-reduced-motion`,
semantic landmarks + skip link + single `h1`, no global `outline:none`.

| # | Issue | Location | Fix | Status |
|---|---|---|---|---|
| A1 | Modal had no focus trap / initial focus / focus return | `src/components/ui/modal.tsx` | Added focus-into-dialog on open, Tab/Shift+Tab trap, and focus return to trigger on close. | **FIXED** |
| A2 | Weak focus indicator (border-color only) on shared Select + Search | `src/components/ui/select.tsx`, `src/components/ui/search-input.tsx` | Added `focus-visible:ring-2` matching Input/Button. | **FIXED** (shared components; ~30 raw feature inputs still border-only — follow-up) |
| A3 | Two `nav` landmarks both named "Primary" | `src/components/shell/app-sidebar.tsx` | Renamed the mobile bar to "Primary (mobile)". | **FIXED** |
| A4 | Color contrast of muted/tiny text + amber badges not computed | `src/app/globals.css` tokens | Needs a contrast tool pass (e.g. `--muted-foreground` on card, `text-[9px]/[10px]`). | **VERIFY** |
| A5 | Raw feature inputs may rely on placeholder-only labels in places | ~30 feature files | Spot-check that each has a `<label>`/`aria-label`, not just a placeholder. | **VERIFY** |

## Copyright / IP Risks
See `IMAGE_ASSET_AUDIT.md`. No web fonts, no external/hot-linked assets, no downloadables. Only three
self-hosted PNGs (`hero`, `logo`, `signinbg`) with **UNKNOWN** provenance → owner must confirm
ownership/license (hero is MEDIUM; replace anything unlicensed). **Status: OWNER INPUT REQUIRED.**

## Marketing Claim Risks
- H2 (DTI/BIR/AMLC) and M1 ("Best Price") above.
- "Trusted", "honest transactions", "Fine Jewelry. Fair Value." — acceptable puffery. **OK.**
- **No** fake reviews, testimonials, star ratings, customer counts, countdown timers, "people
  viewing", or fake scarcity exist anywhere. **Nothing to remove.**

## Security Risks
- **H1 fixed** (export authorization).
- Verified OK: storage bucket `public=false` + RLS-gated; no `dangerouslySetInnerHTML` on user input
  (only static theme/print CSS); service-role key server-only; only anon key + URL are `NEXT_PUBLIC`;
  password-reset logs redact email; all `api/mobile/*` verify a real Supabase JWT first; `api/cron/*`
  + webhook are secret-gated and fail closed; server actions validate via guards/RLS.
- **L1/L2** low-severity notes (timing-safe compare; webhook HMAC).

## Missing Business Information
Tracked in `OWNER_INPUT_REQUIRED.md` §B: registered name, DTI/SEC + BIR numbers, official email,
address confirmation, complaint/redress contact, DPO.

## Items Requiring Legal Review
Layaway + custom-deposit forfeiture terms; limitation-of-liability clause; AMLC covered-person status;
international data-transfer wording; effective dates; and a general review of all four legal pages
before go-live. See `OWNER_INPUT_REQUIRED.md` §G.

## Philippine law applicability (summary)
- **RA 10173 (Data Privacy Act)** — **LEGAL REQUIREMENT** (applies; org obligations + privacy notice).
- **RA 7394 (Consumer Act)** — **LEGAL REQUIREMENT** for the real consumer transactions (truthful
  claims, defect remedies, fair refund/forfeiture).
- **RA 11967 (Internet Transactions Act)** — **POSSIBLY APPLICABLE** (online/live-selling business) →
  business disclosure + redress; **LAWYER REVIEW** on exact obligations.
- **RA 8293 (IP Code)** — **BEST PRACTICE / applies** to image ownership (see IMAGE_ASSET_AUDIT.md).
- **AMLA (dealers in precious metals/stones)** — **POSSIBLY APPLICABLE / LAWYER REVIEW** (the page
  already claims "AMLC Compliant" — verify).
