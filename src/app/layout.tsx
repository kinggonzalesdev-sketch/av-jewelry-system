import type { Metadata, Viewport } from 'next';

import { THEME_INIT_SCRIPT } from '@/components/shell/theme';

import './globals.css';

export const metadata: Metadata = {
  // FIXED browser-tab title for the ENTIRE app. Child routes no longer set their
  // own metadata.title (Owner request 2026-07-24), so every page inherits this —
  // the tab never changes on navigation, refresh, direct URL, or sign in/out.
  title: 'A.V. Jewelry',
  description: 'Internal staff operations system. Not for public or customer use.',
  // Internal tool: never index it.
  robots: { index: false, follow: false },
  // Favicon: app/icon.svg is auto-served by Next on every route (no per-page
  // override), so the tab icon is fixed everywhere too.
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is deliberately NOT disabled — pinch-zoom is an accessibility requirement.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the theme init script below sets data-theme on
    // <html> before React hydrates, so the server markup (no attribute) and the
    // client DOM (attribute applied) intentionally differ on this element only.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Apply the persisted manual theme BEFORE first paint so a refresh never
          flashes the wrong theme. No stored choice → the attribute is not set and
          the OS preference (prefers-color-scheme) governs. See components/shell/theme.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
