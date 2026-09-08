import Link from 'next/link';

/**
 * Public site footer (Owner 2026-09-08 compliance pass). Shown on the marketing landing page and
 * every legal page, so business information + policy links are reachable from any public surface
 * (aligns with Philippine Internet Transactions Act business-disclosure expectations and the Data
 * Privacy Act "reachable privacy notice" principle).
 *
 * ⚠️ Business identity fields marked [OWNER INPUT REQUIRED] are intentionally NOT invented — the
 * registered name, email, and registration numbers must be supplied/verified by the Owner. See
 * OWNER_INPUT_REQUIRED.md.
 */
export function SiteFooter() {
  const year = 2026; // Static: builds must be deterministic; update on the yearly review.
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div>
          <p className="text-sm font-bold tracking-tight">A.V. Jewelry</p>
          <p className="mt-1 text-xs text-muted-foreground">Fine Jewelry. Fair Value.</p>
          <address className="mt-3 not-italic text-xs leading-relaxed text-muted-foreground">
            #84 Violeta Ave., Violeta Village,
            <br />
            Sta. Cruz, Guiguinto, Bulacan, Philippines
          </address>
          <p className="mt-2 text-xs text-muted-foreground">
            Phone:{' '}
            <a className="hover:underline" href="tel:09172035820">
              0917-203-5820
            </a>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Email: <span className="font-medium">[OWNER INPUT REQUIRED]</span>
          </p>
        </div>

        <nav aria-label="Legal" className="text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Legal
          </p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link className="hover:underline" href="/privacy">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/terms">
                Terms &amp; Conditions
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/refund-policy">
                Refund &amp; Cancellation Policy
              </Link>
            </li>
            <li>
              <Link className="hover:underline" href="/cookie-policy">
                Cookie Policy
              </Link>
            </li>
          </ul>
        </nav>

        <div className="text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Get in touch
          </p>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            <li>
              <a className="hover:underline" href="tel:09172035820">
                0917-203-5820
              </a>
            </li>
            <li>
              <a className="hover:underline" href="tel:09190969617">
                0919-096-9617
              </a>
            </li>
            <li>
              <a className="hover:underline" href="tel:09190975063">
                0919-097-5063
              </a>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">Store pick-up available.</p>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <span>© {year} A.V. Jewelry. All rights reserved.</span>
          <span>Powered by King GenZ Digital</span>
        </div>
      </div>
    </footer>
  );
}
