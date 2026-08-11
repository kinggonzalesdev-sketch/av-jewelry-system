# MineFlow Capture (Android)

The installable Android app with the floating **Capture Mine** button used during
Facebook Live. It talks to the MineFlow backend endpoints already deployed at
`av-jewelry.vercel.app` (`/api/mobile/*`). See `docs/MOBILE-CAPTURE-API.md` in the
web repo for the API.

> **This project must be built in Android Studio** (or a CI with the Android SDK).
> It cannot be compiled or signed from the web app's environment. The source here
> is a complete, buildable scaffold — you produce the APK / App Bundle.

## What works

- Sign in with the existing MineFlow account (Supabase Auth); token in the Android
  Keystore (EncryptedSharedPreferences). No password stored.
- Draggable floating **Capture Mine** button over other apps, in a foreground
  service with the required persistent notification.
- One-tap **MediaProjection** still capture (button auto-hides during capture;
  never video, never audio, position remembered).
- Review screen: screenshot preview, customer name, **Active-Inventory search**,
  price/grams, then **Create Order** (For Invoice, idempotent) and **Create & Send**
  (screenshot upload + Pancake send), with safe status messages.

## Configure before building

Open `app/build.gradle.kts` → `defaultConfig` and set:

- `API_BASE_URL` — the MineFlow backend (default `https://av-jewelry.vercel.app`).
- `SUPABASE_URL` — already set to the project URL.
- `SUPABASE_ANON_KEY` — paste the **publishable anon key** (the web app's
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Required for sign-in.

Backend env for the Pancake send (on the web/Vercel side, not the app):
`PANCAKE_USER_ACCESS_TOKEN`, `PANCAKE_PAGE_ID`, optional `PANCAKE_SEND_BASE` /
`PANCAKE_SEND_PATH`.

## Permissions (requested at runtime in Setup)

- `SYSTEM_ALERT_WINDOW` — the floating button over Facebook.
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PROJECTION` — keep capture alive.
- `POST_NOTIFICATIONS` (Android 13+) — the capture notice.
- MediaProjection consent — shown per session on the first tap (never silent).

## Local build (debug APK)

```
cd mobile/mineflow-capture
# Generate the Gradle wrapper jar once (needs a local Gradle, or let Android Studio do it):
gradle wrapper
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Or just open `mobile/mineflow-capture` in **Android Studio** and press Run.

## Production build (signed)

1. Create a keystore:
   ```
   keytool -genkeypair -v -keystore mineflow-capture.jks -alias mineflow \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. In Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**,
   select the keystore, build the release `.aab` (for Play) or `.apk` (sideload).
   Do not commit the keystore or its passwords.

## Testing checklist (first pass)

1. Install, sign in (valid + invalid MineFlow account).
2. Grant overlay + notifications; Start Capture Mine.
3. Floating button appears over Facebook; drag to reposition (remembers place).
4. Tap → consent → button hidden during capture → pinned comment visible in shot.
5. Review: search inventory, select item, edit price/grams.
6. Create Order → For Invoice; tap again with the same capture → same order (no dup).
7. Create & Send with a real conversation id → screenshot + message in Pancake.
8. Airplane mode → clear error, order ret/send retry safe.
9. Session expiry → forced back to sign-in.

## Device notes

- **Android 14 (API 34):** starting a `mediaProjection` foreground service is
  tightened — if a device rejects capture with "Media projections require a
  foreground service of type mediaProjection", move the `startForeground(...)` call
  in `OverlayCaptureService` to run _after_ the consent result is delivered
  (`ACTION_DELIVER_PROJECTION`) instead of in `onCreate`. Works as-is on Android
  8–13; this is the one Android-14 timing tweak to verify on your target devices.

## Not yet included (deliberate next steps)

- On-device OCR suggestions (fields are manual/confirmed for now).
- Capture history screen + offline draft queue.
- Bluetooth label printing (the web print system is separate).
- Idempotent print via `/api/mobile/capture/dispatch` (endpoint is ready).
