# MineFlow Capture — Backend API

Backend endpoints for the **MineFlow Capture** Android app (live-selling screenshot
→ order). The Android project itself lives in a separate repo; this document covers
only the server side that ships with MineFlow.

## Authentication

The app signs in with the **same MineFlow account** (Supabase Auth) and sends the
Supabase **access token** on every request:

```
Authorization: Bearer <supabase_access_token>
```

The server verifies the JWT with Supabase and loads the staff profile through an
**RLS-scoped** client. It never trusts a client-supplied role or id. All privileged
work happens in `SECURITY DEFINER` database functions that re-check permissions.

**No secrets on the device:** no Pancake token, no Supabase service-role key. RLS +
the server boundary are the authority.

## Endpoints

| Method | Path                                          | Purpose                                                                  |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------ |
| `GET`  | `/api/mobile/session`                         | Verify session → `{ staff: { name, role }, connection }`.                |
| `GET`  | `/api/mobile/inventory/search?q=`             | Active-Inventory search for the item picker.                             |
| `POST` | `/api/mobile/capture/order`                   | Create the order for a confirmed capture (idempotent).                   |
| `POST` | `/api/mobile/capture/upload`                  | Store a screenshot in the private `attachments` bucket → returns `path`. |
| `POST` | `/api/mobile/capture/send`                    | Send screenshot + message to the customer's Pancake conversation.        |
| `POST` | `/api/mobile/capture/dispatch`                | Record send/print outcome + attach screenshot (safe Retry Send/Print).   |
| `GET`  | `/api/mobile/capture/status?device=&capture=` | Order / message / print status for retry screens.                        |

All responses are JSON `{ ok: boolean, ... }`. `401` = invalid/expired session.

### `POST /api/mobile/capture/order`

Body:

```json
{
  "deviceInstallationId": "…",
  "captureId": "…",
  "customerName": "…",
  "inventoryItemId": "<uuid>",
  "price": "1500.00",
  "grams": "1.80",
  "screenshotPath": "attachments/…",
  "ocr": { "…": "suggestions only" },
  "pancakeConversationId": null,
  "pancakeCustomerId": null
}
```

- Creates a **single-item order in For Invoice**, reserving the inventory item the
  same way the Walk-In flow does.
- **Idempotency key:** `capture:{deviceInstallationId}:{captureId}` (enforced by a
  unique constraint in the database). A retried tap or re-send returns the **same**
  order (`"idempotent": true`) — never a duplicate.
- Requires the `claim_capture` permission (re-checked in the DB function).

## Database

- `public.capture_records` — idempotency + audit spine (device, capture, order,
  screenshot path, OCR suggestions, confirmed values, message/print status, source).
- `public.create_capture_order(...)` — `SECURITY DEFINER`, idempotent order creation.

Migration: `supabase/migrations/20260731160000_capture_mine_backend.sql`.

## Environment

No new secrets are required for these endpoints. They reuse the existing:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Screenshots upload to the existing **private** `attachments` storage bucket (signed
access only). Pancake sending reuses the server-side `PANCAKE_USER_ACCESS_TOKEN`
(already documented in the Integrations screen) — the token never reaches the app.

## Not yet wired (honest scaffolding)

- **Screenshot upload** — DONE. `POST /api/mobile/capture/upload` stores the image
  (base64; PNG/JPEG/WebP, ≤12 MB) in the private `attachments` bucket and returns
  the path; `POST /api/mobile/capture/dispatch` attaches it and records send/print
  outcomes for safe retry.
- **Pancake message send** — WIRED via `POST /api/mobile/capture/send`
  (`sendPancakeConversationMessage`). Server-side only; sends to ONE explicit
  conversation id; idempotent (won't resend); attaches the screenshot as a
  short-lived signed URL; records the result for safe Retry.
  **Verify once against a real conversation** — the pages.fm request path is
  env-configurable so it can be corrected without a code change:
  - `PANCAKE_USER_ACCESS_TOKEN` — the user access token (already set).
  - `PANCAKE_PAGE_ID` — the selected Page id (from Save Selected Page).
  - `PANCAKE_SEND_BASE` — default `https://pages.fm/api/public_api/v1`.
  - `PANCAKE_SEND_PATH` — default
    `/pages/{page_id}/conversations/{conversation_id}/messages`.
    If your Pancake plan uses a different send path/body, set `PANCAKE_SEND_BASE` /
    `PANCAKE_SEND_PATH` accordingly and redeploy.
- **Print payload** — reuses the existing label/print system on the device; result
  recorded via `/dispatch`.

The capture → upload → review → create-order → send → record-dispatch path is
complete and idempotent today.
