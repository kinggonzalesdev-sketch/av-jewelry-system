import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter } from '@/components/shell/site-footer';

/**
 * Public landing page for A.V. Jewelry (the ONE public route — see PUBLIC_ROUTES
 * in the proxy). Marketing only: it exposes no data and makes no authorization
 * decision; the real app is behind "Staff Sign In". Dark premium theme via the
 * design tokens; a hero background video with a gradient fallback if it fails.
 */

export const metadata: Metadata = {
  description:
    'A.V. Jewelry — trusted gold jewelry and assessment services in Guiguinto, Bulacan. Quality gold jewelry, customization, repair, live selling, layaway, and honest gold buying.',
  robots: { index: true, follow: true },
};

const PRODUCTS: string[] = [
  '18K Saudi Gold — Subasta & Brand New',
  'K18 Japan Gold — Subasta & Brand New',
  'Electro Forms 18K',
  'Wedding Rings',
  'Nameplates',
  'Custom Jewelry',
];

const SERVICES: string[] = [
  'Jewelry Customization',
  'Jewelry Repair',
  'Ring Resize',
  'Live Selling',
  'Layaway',
  'Credit Card Payment',
  'Walk-In & Online Transactions',
  'Gold & Silver Scrap Buying',
  'Store Pick-Up Available',
];

const TRUST: string[] = [
  'DTI Registered',
  'BIR Registered',
  'AMLC Compliant',
  // Softened from "Best Price Gold Buyers" (Owner 2026-09-08): an unqualified superlative is an
  // unsubstantiated-claim risk under RA 7394. "Fair" matches the brand tagline and is defensible.
  'Fair Gold Buying Prices',
  'Store Pick-Up Available',
];

const CONTACTS: string[] = ['0917-203-5820', '0919-096-9617', '0919-097-5063'];

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold text-sm font-bold text-black">
      AV
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2.5">
          <BrandMark />
          <span className="min-w-0">
            <span className="block text-sm font-bold tracking-tight">A.V. Jewelry</span>
            <span className="block text-[10px] text-muted-foreground">
              Fine Jewelry. Fair Value.
            </span>
          </span>
        </span>
        <Link
          href="/sign-in"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gold/90"
        >
          Sign in
        </Link>
      </header>

      <main id="main-content">
        {/* Hero with background video + gradient fallback + dark overlay */}
        <section className="relative overflow-hidden">
          {/* Hero background: the A.V. Jewelry photo, stretched to cover the section. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/av-jewelry-hero.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
          {/* Dark overlay so the light hero text stays readable over the photo. */}
          <div aria-hidden="true" className="absolute inset-0 bg-black/55" />

          <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <span className="inline-flex items-center rounded-full border border-emerald-400/50 bg-black/30 px-3 py-1 text-xs font-medium text-emerald-300 backdrop-blur">
              Fine Jewelry. Fair Value.
            </span>
            <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-bold tracking-tight text-white drop-shadow sm:text-5xl">
              Trusted gold jewelry &amp; assessment in{' '}
              <span className="text-emerald-400">Guiguinto, Bulacan</span>.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-white/90 sm:text-lg">
              A.V. Jewelry offers quality gold jewelry, customization, repair, live
              selling, layaway, and trusted buying — through clear and honest
              transactions.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#offerings"
                className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-gold/90"
              >
                See our offerings
              </a>
              <Link
                href="/sign-in"
                className="rounded-md border border-white/40 bg-white/10 px-6 py-3 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        {/* Trust / credibility strip */}
        <section className="border-y border-border bg-card/40">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2 px-4 py-6 sm:px-6">
            {TRUST.map((t) => (
              <span
                key={t}
                className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold-strong"
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* Products & Services */}
        <section id="offerings" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold tracking-tight">Products</h2>
              <ul className="mt-4 space-y-2">
                {PRODUCTS.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm">
                    <span aria-hidden="true" className="mt-0.5 text-gold-strong">
                      ◆
                    </span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold tracking-tight">Services</h2>
              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SERVICES.map((s) => (
                  <li key={s} className="flex items-start gap-2 text-sm">
                    <span aria-hidden="true" className="mt-0.5 text-gold-strong">
                      ✦
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Address & contact */}
        <section className="border-t border-border">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-14 sm:grid-cols-2 sm:px-6">
            <div>
              <h2 className="text-lg font-bold tracking-tight">Visit us</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                #84 Violeta Ave., Violeta Village, Sta. Cruz, Guiguinto, Bulacan
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Store pick-up available.
              </p>
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Contact</h2>
              <ul className="mt-3 space-y-1.5">
                {CONTACTS.map((c) => (
                  <li key={c}>
                    <a
                      href={`tel:${c.replace(/-/g, '')}`}
                      className="text-sm font-medium text-gold-strong hover:underline"
                    >
                      {c}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
