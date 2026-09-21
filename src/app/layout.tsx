import type { Metadata, Viewport } from 'next';

import { PwaProvider } from '@/components/pwa/pwa-provider';
import { UnsavedChangesProvider } from '@/components/pwa/unsaved-changes';
import { UpdateToast } from '@/components/pwa/update-toast';
import { THEME_INIT_SCRIPT } from '@/components/shell/theme';
import { StackedTableLabels } from '@/components/ui/stacked-table-labels';

import './globals.css';

export const metadata: Metadata = {
  // FIXED browser-tab title for the ENTIRE app. Child routes no longer set their
  // own metadata.title (Owner request 2026-07-24), so every page inherits this —
  // the tab never changes on navigation, refresh, direct URL, or sign in/out.
  title: 'A.V. Jewelry',
  description: 'Internal staff operations system. Not for public or customer use.',
  // Internal tool: never index it.
  robots: { index: false, follow: false },
  // Installed-app identity (PWA, Owner 2026-09-05; renamed to the brand 2026-09-08). `appleWebApp`
  // is what makes iOS "Add to Home Screen" open A.V. Jewelry as a standalone app with the right
  // title and status bar. All icons are generated from public/av-jewelry-logo.png.
  applicationName: 'A.V. Jewelry',
  appleWebApp: {
    capable: true,
    title: 'A.V. Jewelry',
    statusBarStyle: 'black-translucent',
  },
  // Next auto-links app/favicon.ico; metadata adds the named PNG alternatives.
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom is deliberately NOT disabled — pinch-zoom is an accessibility requirement.
  maximumScale: 5,
  // `env(safe-area-inset-*)` resolves to 0 unless the viewport is fit to cover, so without
  // this the safe-area padding already on the mobile nav/header/modals was inert. With it,
  // iOS reports the real notch / home-indicator insets. No effect on Android or desktop.
  viewportFit: 'cover',
  // Colours the browser/OS chrome to match the app surface (also used when installed).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0f0d' },
  ],
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
        {/* PWA runtime (Owner 2026-09-05): one service-worker registration + update/install state,
            the unsaved-work registry the update flow respects, the mobile card-table labeller, and
            the "Update available" toast. All render nothing until they have something to say. */}
        <UnsavedChangesProvider>
          <PwaProvider>
            {children}
            <UpdateToast />
            <StackedTableLabels />
          </PwaProvider>
        </UnsavedChangesProvider>
      </body>
    </html>
  );
}
