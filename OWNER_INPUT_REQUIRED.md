# Owner Input Required — Compliance Pass (2026-09-08)

These are the facts and decisions **only you (the business owner)** can supply. I did **not** invent
any of them. Each maps to a `[OWNER INPUT REQUIRED]` placeholder in the new legal pages or to a flag
in `LEGAL_COMPLIANCE_AUDIT.md`. Fill these in, then have a Philippine lawyer review the legal pages
before go-live.

## A. Verify the public claims on your landing page (do this first — highest risk)
Your homepage (`src/app/page.tsx`) shows these as credibility badges. Each must be **true and
provable**, or it should be removed:

- [ ] **"DTI Registered"** — true? Provide the DTI Business Name Registration number.
- [ ] **"BIR Registered"** — true? Provide the BIR registration / TIN (do not publish more than needed).
- [ ] **"AMLC Compliant"** — confirm whether you are a "covered person" (dealers in precious
      metals/stones can be) and are actually registered/compliant. If unsure, remove until confirmed.
- [ ] **"Best Price Gold Buyers"** — can you substantiate "Best Price"? An unqualified superlative is
      a deceptive-claim risk under RA 7394. **Decision:** keep (with proof), or let me soften it to
      something defensible (e.g. "Fair Gold Buying Prices" / "Competitive Gold Buying").

## B. Business identity (for the footer + legal pages + Internet Transactions Act)
- [ ] Registered/trade business name (exact).
- [ ] Business registration numbers (DTI and/or SEC; BIR).
- [ ] Official customer-facing **email address** (currently `[OWNER INPUT REQUIRED]` in the footer,
      Privacy, Terms, Refund).
- [ ] Confirm the public address `#84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan`.
- [ ] A complaint/redress contact or process (phone is shown; confirm email/hours).

## C. Data Privacy (Privacy Policy)
- [ ] **Data Protection Officer / privacy contact** name + email.
- [ ] Your **email/SMTP provider** (configured in the Supabase dashboard — not visible in code; e.g.
      Resend, SendGrid, Gmail SMTP). Needed for the "email provider" disclosure.
- [ ] **Retention periods** — how long you keep order/payment/layaway/accounting records (often tied
      to BIR record-keeping rules — confirm with your accountant).
- [ ] Confirm you are comfortable disclosing **international processing** (Supabase/Vercel may host in
      Singapore). Lawyer/DPO to confirm wording.
- [ ] Decision on a **storage-retention/erasure schedule** for stored images (proof-of-payment,
      capture screenshots, attendance selfies) — currently kept indefinitely (see audit "Privacy
      Risks").

## D. Terms & Conditions
- [ ] Quotation validity period and reservation rules.
- [ ] Accepted payment methods; when an item is released vs. fully paid.
- [ ] **Layaway terms:** down payment, schedule, interest/charges, and what happens to payments on
      cancellation (must be fair + clearly disclosed at sign-up).
- [ ] **Custom orders/repairs:** deposit amount/%, turnaround times, number of revisions.
- [ ] **Gold/scrap buying:** basis and finality of an assessed offer.
- [ ] **Delivery:** areas, fees, courier/COD terms, risk of loss.
- [ ] Any voluntary warranty (e.g. on repairs).
- [ ] Dispute venue / complaint contact.

## E. Refund & Cancellation Policy
- [ ] Defect/return reporting process, assessment, and timeframe.
- [ ] **Change-of-mind** policy: allowed? within how many days? item condition required?
- [ ] **Custom-order deposit** refundability (before/after work begins) — must reflect actual
      work/cost, not an arbitrary penalty.
- [ ] **Layaway cancellation:** refund / store credit / forfeiture terms (fairness matters legally).
- [ ] Service (repair/resize) warranty period and re-work terms.
- [ ] Gold/scrap buying finality terms.
- [ ] Refund **method and timeframe**.

## F. Image ownership (see IMAGE_ASSET_AUDIT.md)
- [ ] Confirm `av-jewelry-hero.png` is your own or properly licensed (replace if not).
- [ ] Confirm `av-jewelry-logo.png` ownership (and that any designer transferred rights).
- [ ] Confirm `av-jewelry-signinbg.png` is your own or properly licensed.

## G. Lawyer review (before go-live)
- [ ] Full review of `/privacy`, `/terms`, `/refund-policy`, `/cookie-policy`.
- [ ] Limitation-of-liability clause in Terms §12.
- [ ] Layaway forfeiture (Terms §5 / Refund §4) and custom-deposit forfeiture (Refund §3).
- [ ] Whether you are an AMLC "covered person" (dealers in precious metals/stones) and any
      registration/reporting duties that follow.
- [ ] Effective dates for all four documents.
