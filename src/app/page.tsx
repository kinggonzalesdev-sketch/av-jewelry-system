import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Public landing page (business requirement: "a simple landing page").
 *
 * This is the ONE public route (see PUBLIC_ROUTES in the proxy). It is marketing
 * only — it exposes no data and makes no authorization decision. The real app is
 * behind "Staff Sign In". Self-contained: no external image assets, so it renders
 * anywhere without a CDN, styled in the emerald brand via the design tokens.
 */

export const metadata: Metadata = {
  title: 'A.V. Jewelry — Operations, from mine to delivery',
  description:
    'A.V. Jewelry Operations System (MineFlow): one platform for Facebook Live selling, invoicing, payments, layaway, fulfillment, inventory, and reporting.',
  // Public marketing page — override the app-wide noindex.
  robots: { index: true, follow: true },
};

const FEATURES: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: '◉',
    title: 'Live Selling & Mining',
    body: 'Capture every mined item with the buyer, price, and a photo — proof that beats the paper-and-plastic-bag method.',
  },
  {
    icon: '▤',
    title: 'Instant Invoicing',
    body: 'Turn confirmed claims into Official Orders fast — before a scammer messages your buyer first.',
  },
  {
    icon: '₱',
    title: 'Payments, verified',
    body: 'Record GCash/BPI/BDO/cash per invoice, verify once, and every verified peso reduces the balance. No double-postings.',
  },
  {
    icon: '◔',
    title: 'Layaway / Hulugan',
    body: '20% deposit, PHP 150 per gram each month, up to three months — computed, tracked, and never re-invented after activation.',
  },
  {
    icon: '➤',
    title: 'Fulfillment & Delivery',
    body: 'Own rider, LBC, FedEx, DHL, or pickup — with tracking, COD, and money-in-transit visibility.',
  },
  {
    icon: '◈',
    title: 'Inventory & Custody',
    body: 'Unique item codes, availability derived (never a stale counter), and custody: on-hand vs financer.',
  },
  {
    icon: '▥',
    title: 'Dashboard & Reports',
    body: 'Sales today / week / month / any range, order-status and collection charts, and scrap income — real numbers, honest zeros.',
  },
  {
    icon: '⏱',
    title: 'Attendance & Payroll',
    body: 'A tamper-evident digital time clock with hours, overtime, and salary — replacing the unreliable biometric.',
  },
];

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
              MineFlow Operations
            </span>
          </span>
        </span>
        <Link
          href="/sign-in"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-gold/90"
        >
          Staff Sign In
        </Link>
      </header>

      <main id="main-content">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gold/10 to-transparent"
          />
          <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold-strong">
              Jewelry retail · Facebook Live selling · since 2021
            </span>
            <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">
              One system, from <span className="text-gold-strong">mine to delivery</span>.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              MineFlow replaces the paper index cards, notebooks, and scattered
              spreadsheets with a single, honest workflow — every item tracked from a
              live-sale mine through payment, layaway, and delivery.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sign-in"
                className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-gold/90"
              >
                Staff Sign In
              </Link>
              <a
                href="#features"
                className="rounded-md border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                See what it does
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Internal staff platform. Accounts are issued by the Owner — there is no
              public registration.
            </p>
          </div>
        </section>

        {/* Trust row */}
        <section className="border-y border-border bg-card/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-8 text-center sm:grid-cols-4 sm:px-6">
            {[
              ['Since 2021', 'Jewelry retail'],
              ['Facebook Live', 'Subasta · Brand New · Factory · HK'],
              ['Nationwide', 'LBC · FedEx · DHL · own riders'],
              ['COD & Layaway', 'Bulacan · Metro Manila'],
            ].map(([big, small]) => (
              <div key={big}>
                <p className="text-lg font-bold text-foreground">{big}</p>
                <p className="text-xs text-muted-foreground">{small}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Everything the operation needs, in one place
            </h2>
            <p className="mt-3 text-muted-foreground">
              Built around how A.V. Jewelry actually sells — with the money rules enforced
              by the system, not by memory.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-gold/40"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold/15 text-lg text-gold-strong"
                >
                  {f.icon}
                </span>
                <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA band */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6">
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              Ready to run the shop from one screen?
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              Sign in with your staff account to open the dashboard.
            </p>
            <Link
              href="/sign-in"
              className="mt-6 inline-flex rounded-md bg-gold px-6 py-3 text-sm font-semibold text-black transition-colors hover:bg-gold/90"
            >
              Staff Sign In
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <span className="flex items-center gap-2">
            <BrandMark />
            A.V. Jewelry Operations — MineFlow
          </span>
          <span>Powered by King GenZ Digital</span>
        </div>
      </footer>
    </div>
  );
}
