import type { ReactNode } from 'react';
import Link from 'next/link';

import { SiteFooter } from '@/components/shell/site-footer';

/**
 * Shell for the PUBLIC legal pages (Privacy, Terms, Refund, Cookie). Reachable without a session
 * (added to PUBLIC_ROUTES in the proxy). Data-free, theme-aware via the design tokens, with a skip
 * link + one <main> landmark so the pages are keyboard- and screen-reader-friendly.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#legal-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-gold focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 rounded-md">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold text-sm font-bold text-black">
              AV
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">A.V. Jewelry</span>
              <span className="block text-[10px] text-muted-foreground">
                Fine Jewelry. Fair Value.
              </span>
            </span>
          </Link>
          <Link
            href="/"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      <main id="legal-content" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
