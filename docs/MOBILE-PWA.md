# MineFlow on phones, tablets and as an installed app (PWA)

**Scope:** the main MineFlow web system at `https://avjewelry.online`. The separate native
**MineFlow Capture** Android app (Facebook Live capture, OCR, Capture Box, Bluetooth sticker
printer) is unchanged and is _not_ part of the PWA — see the last section.

MineFlow is an **online** operational system. Installing it changes how it launches, never what it
stores: **no customer, order, payment, inventory, payroll, attendance, report, capture or Messenger
data is ever kept in a service-worker cache**, and there is no offline data entry.

---

## 1. Installing MineFlow

### Android (Chrome)

1. Open `https://avjewelry.online` in **Chrome** and sign in.
2. Go to **Settings → Install MineFlow** and tap **Install MineFlow**. (Chrome may also show its
   own _Install app_ prompt or a ⋮ menu entry — either works.)
3. Confirm **Install**. MineFlow appears on the home screen and opens full-screen.

If the button is not offered (older Chrome, or Chrome has decided the site was "already dismissed"),
use **⋮ → Install app / Add to Home screen**.

### iPhone (Safari)

Safari never shows an automatic install prompt; this is the only way and it is normal:

1. Open MineFlow in **Safari** (not Chrome, not the Facebook in-app browser).
2. Tap **Share** (the square with an arrow).
3. Tap **Add to Home Screen**.
4. If shown, keep **Open as Web App** enabled.
5. Tap **Add**.

### iPad (Safari)

Same as iPhone. In landscape the sidebar/bottom-nav behave like a tablet (≥1024px shows the
desktop sidebar; below that the mobile header + bottom nav + ☰ drawer).

The **Install MineFlow** card in Settings shows the right instructions for the device it is on,
and says "✓ MineFlow is installed on this device" once running as an app.

---

## 2. Browser vs installed ("standalone") mode

|                          | Browser tab                          | Installed app                                                  |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| URL bar / browser chrome | shown                                | hidden (`display: standalone`)                                 |
| Launch                   | bookmark / typing the URL            | home-screen icon → `/dashboard`                                |
| Sign-in                  | same                                 | same — an installed app that is not signed in lands on Sign in |
| Data                     | live from the server                 | live from the server (identical)                               |
| Updates                  | every page load is the latest deploy | see §3                                                         |

The manifest's `start_url` is `/dashboard`; the normal session proxy still applies, so the
manifest never bypasses authentication.

**Settings → Install MineFlow → App Information** shows Mode (Installed app / Browser),
Connection, Version (public short build id) and update status.

---

## 3. Updates after a Vercel deployment

Users **never reinstall**. A normal `vercel --prod` deploy is all it takes:

1. The page registers the worker as `/sw.js?v=<build commit>`. A new deploy → new URL → the
   browser installs it as a _new_ worker next to the running one.
2. When the new worker is installed and waiting, MineFlow shows **Update available — Update now /
   Later** (bottom of the screen, above the mobile nav).
3. **Update now** asks the new worker to take over and reloads **once**. The worker never activates
   itself and never reloads on its own, so there is no update loop.
4. **Unsaved-work guard:** while any _critical_ dialog is open (Add Payment, invoice/order entry,
   inventory edit, walk-in sale…) or a capture edit is unsaved, **Update now** first warns
   _"You have an entry in progress…"_ and requires **Update anyway**. It will not discard work
   silently. The browser's own _Leave site?_ prompt is also armed while work is unsaved.
5. Stations left open all day check for a new version hourly and whenever the tab becomes visible.

The worker's cache is keyed by that version; old versions' caches are deleted on activation, so
there is no stale-asset mismatch.

---

## 4. Offline behaviour

If the device loses its connection:

- A page navigation shows the branded **You're offline** screen with **Retry** (reloads).
- That screen contains **no business data**. Previously viewed customers/orders/payments are
  **not** served from any cache — the worker never stored them.
- Whatever is already rendered in the open tab stays on screen (browser memory, not a cache) until
  the next navigation; buttons that need the server will fail until the connection returns.

There is deliberately **no offline queue** for Orders, Payments or Inventory. Replaying those
later needs a conflict-resolution design of its own.

What the worker _does_ cache (public, data-free only): hashed `/_next/static/*` build assets, the
brand images, the icons, the manifest and the `/offline` page. The exact allowlist lives in
`src/lib/pwa/cache-policy.ts`, is mirrored in `public/sw.js`, and a unit test fails the build if
the two drift. Cross-origin requests (Supabase REST/Auth/Storage/Realtime, Pancake), `/api/*`,
server actions, `/m/*` share pages and every non-GET request are never touched by the worker.

---

## 5. Logout and privacy

- **Logout** ends the Supabase session (global sign-out) and the session cookie; the next
  navigation to any app page redirects to Sign in.
- **Back** after logout re-requests the page from the server (pages are `force-dynamic` and not
  cached by the worker), so it lands on Sign in — nothing private is replayed from a cache.
- MineFlow keeps only non-sensitive conveniences in `localStorage` (theme, privacy toggle, the
  printed-capture id list, the install-suggestion dismissal timestamp). No records, no tokens.
- The service-worker cache holds only the public assets listed above; nothing is user-specific,
  so there is nothing to clear on logout.

---

## 6. Reinstalling / removing

Remove the icon like any app (long-press → Uninstall / Remove). Reinstall via §1. Nothing is lost —
all data lives on the server.

---

## 7. Icons and versioning

- All launcher icons are rasterised **from the one official logo** (`public/av-jewelry-logo.png`,
  500×500) by `src/app/pwa-icon/[variant]/route.tsx`: `/pwa-icon/192`, `/pwa-icon/512`,
  `/pwa-icon/maskable-512` (logo at 80% on the brand background, inside Android's safe zone) and
  `/pwa-icon/apple-180` (opaque background — iOS ignores transparency). The browser-tab icon is
  `src/app/icon.svg`.
- **To change the icon:** replace `public/av-jewelry-logo.png` (square, ≥512px recommended) and
  regenerate `src/lib/pwa/logo-data.ts` with `base64 -w0 public/av-jewelry-logo.png` (the header
  comment in that file shows the exact line). Deploy. Installed users see the new icon after the
  OS refreshes it (Android usually on next launch; iOS on reinstall).
- **Versioning:** the public build id is the short commit (`APP_COMMIT`, set at build). It is what
  App Information shows and what versions the service worker. Nothing else needs bumping.

---

## 8. Safe areas (iPhone notch / home indicator)

`viewport-fit=cover` is on, so `env(safe-area-inset-*)` is real on iOS. The mobile header pads the
top, the bottom nav and every bottom-sheet dialog pad the bottom, and the ☰ drawer pads top/left.
On Android and desktop these resolve to 0 and change nothing. **Physical verification on a
notched iPhone is still required** — emulation cannot prove it.

---

## 9. Future Android / iOS wrapper (not built)

The intended architecture stays _one_ Next.js application:

```
MineFlow Web  →  Responsive UI  →  Installed PWA  →  (later) Android/iOS shell
```

If a store-distributed app is wanted later, **Capacitor** wrapping the deployed URL is the
appropriate approach (no second codebase). Things to plan for at that point, none of which block
the PWA today:

- **Authentication:** cookie-based Supabase sessions work in a WebView; a native shell must keep
  the same origin (`avjewelry.online`) so cookies and the proxy behave identically.
- **External links** (Open FB Chat, Messenger) should open the system browser/app, not the shell.
- **File upload / camera:** the web file input already works in a WebView; native camera access is
  optional. **MineFlow Capture remains the capture tool** — it is not replaced by this.
- **Notifications:** none today; would be a separate design.
- **Deep links:** `/orders`, `/orders/payments`, `/m/<token>` should map to the shell.
- **Keyboard / safe area:** already handled by the responsive CSS.

---

## 10. What is where (for maintainers)

| Concern                               | File                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Manifest                              | `src/app/manifest.ts`                                                               |
| Icons (generated)                     | `src/app/pwa-icon/[variant]/route.tsx`, `src/lib/pwa/logo-data.ts`                  |
| Service worker                        | `public/sw.js` (policy mirror: `src/lib/pwa/cache-policy.ts`)                       |
| Registration / install / update state | `src/components/pwa/pwa-provider.tsx`                                               |
| Update toast · unsaved guard          | `src/components/pwa/update-toast.tsx`, `src/components/pwa/unsaved-changes.tsx`     |
| Install UI · App information          | `src/components/pwa/install-mineflow.tsx`, `src/components/pwa/app-information.tsx` |
| Offline page                          | `src/app/offline/page.tsx`                                                          |
| Public-path exclusions                | `src/proxy.ts` (matcher), `src/lib/supabase/proxy.ts` (`PUBLIC_ROUTES`)             |
| Mobile card tables                    | `globals.css` `.data-table--stack`, `src/components/ui/stacked-table.ts`            |
| Mobile nav (bottom nav + ☰ drawer)   | `src/components/shell/app-sidebar.tsx`, `navigation.ts` (`mobilePrimary`)           |
| Bottom-sheet dialogs                  | `src/components/ui/modal.tsx`                                                       |
