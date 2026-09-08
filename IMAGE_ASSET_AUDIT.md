# Image & Asset Copyright Audit — A.V. Jewelry

Date: 2026-09-08 · Scope: every image, icon, video, font, and downloadable asset in the project.

## Method
- Enumerated `public/` and searched `src/` for image/video/font references and external asset URLs.
- Result: the site is **self-hosted and minimal**. There are **no web fonts** (system font stack only — no Google Fonts / `@font-face`, so no font-licensing exposure), **no external/hot-linked images or videos**, and **no downloadable files**. Icons are Unicode glyphs and an inline SVG generated from the logo.

## Assets

| Asset | Location | Likely source | License / ownership status | Risk | Recommended action |
|---|---|---|---|---|---|
| `av-jewelry-hero.png` | `public/av-jewelry-hero.png` — landing hero background | Named as the business's own | **UNKNOWN** — cannot confirm from the repo whether it is A.V. Jewelry's own photo or sourced elsewhere | **MEDIUM** | Owner to confirm it is an original/owned or properly licensed photo. If it came from the web/stock without a license, replace it. |
| `av-jewelry-logo.png` | `public/av-jewelry-logo.png` — sidebar, sign-in, PWA icons | Business logo | **UNKNOWN** (owned assumed) | **LOW** | Owner to confirm the logo is owned/commissioned and that any designer handed over rights. |
| `av-jewelry-signinbg.png` | `public/av-jewelry-signinbg.png` — sign-in background | Named as the business's own | **UNKNOWN** | **LOW–MEDIUM** | Same as hero — confirm original/licensed. |
| "AV" monogram tiles | Rendered as text in code (landing, sidebar, footer) | Original (text) | Owned (plain text) | **NONE** | None. |
| PWA icons | Generated on demand from `av-jewelry-logo.png` (`/pwa-icon/[variant]`) | Derived from the logo | Inherits the logo's status | **LOW** | Covered by the logo confirmation above. |
| Fonts | System font stack (`globals.css`) | OS-provided | No embedded font shipped | **NONE** | None. |
| "Powered by King GenZ Digital" | Footer credit | Developer credit | N/A | **NONE** | Keep or remove per preference. |

## Summary
- No high/critical copyright exposure detected in code. The only real items are the **three PNGs** (`hero`, `logo`, `signinbg`), whose provenance the repo cannot prove.
- **Do not assume they are free to use.** The Owner must confirm each is either the business's own work or properly licensed. Adding a "credits" line does **not** resolve copyright — replace anything that cannot be substantiated.
- These confirmations are tracked in `OWNER_INPUT_REQUIRED.md`.
