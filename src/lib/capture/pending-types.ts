/**
 * Pending-capture shapes shared by the server reader and the client
 * `IncomingCapturesStrip`. Kept OUT of any `server-only` module so the client can
 * import the types without pulling server code into the browser bundle.
 */

/**
 * A window CustomEvent that toggles the Incoming Captures strip open/closed. The
 * strip stays hidden until the operator clicks the "Capture Pending" pill beside
 * + New Order (Owner request 2026-08-09 — it should not appear on its own). The
 * pill (in OrdersView) dispatches this; the strip (a sibling component) listens.
 * A plain window event keeps the two decoupled without a shared provider, and the
 * strip stays mounted the whole time so its background auto-print keeps working.
 */
export const TOGGLE_INCOMING_CAPTURES_EVENT = 'mineflow:toggle-incoming-captures';

/**
 * A window CustomEvent (`detail: number`) the Incoming Captures strip fires whenever
 * the EXACT number of pending captures changes (the server count, adjusted for what
 * this station just added or removed; never the number of rows it has loaded). The
 * "Capture Pending" pill listens and shows exactly this, so the pill's badge always
 * matches the popup's "(N)" — the server-rendered count is only the first-paint
 * placeholder until the strip's count arrives (Owner request 2026-08-09).
 */
export const CAPTURE_COUNT_EVENT = 'mineflow:capture-count';

/**
 * A window event the pill fires when it mounts: the strip lives app-wide and may
 * have loaded before the Orders page opened, so the pill asks for the current count
 * instead of waiting for the next change (Owner 2026-09-24: pill 70, list 50).
 */
export const CAPTURE_COUNT_REQUEST_EVENT = 'mineflow:capture-count-request';

/** Rows per Incoming Captures page. The first page is what the station always
 *  loaded; older pages load on demand, so every pending capture is reachable. */
export const PENDING_CAPTURES_PAGE_SIZE = 50;

/** The resolved-customer state of a pending capture (Capture-time linking, 2026-08-09).
 *  Mirrors capture_records.link_status; null = not resolved yet. */
export type CaptureLinkStatus =
  'linked' | 'needs_confirmation' | 'customer_no_chat' | 'no_match' | null;

/** What a resolve/change/remove link action returns to the strip (client-safe). */
export type CaptureLinkResult = {
  ok: boolean;
  linkStatus: CaptureLinkStatus;
  linkedCustomerId: string | null;
  linkedCustomerName: string | null;
  conversationAvailable: boolean;
  fbUrl: string | null;
  matchCount: number;
  /** True when this resolve also auto-sent the screenshot. */
  sent: boolean;
  /** True only when the linked conversation has a GENUINE customer-initiated Inbox DM inside the
   *  media window — i.e. a normal Inbox PHOTO can actually be delivered now. A linked conversation
   *  (chat resolved) does NOT imply this: a comment-only customer is `linked` but NOT photo-ready.
   *  Distinct from `conversationAvailable` (a chat exists) — this is "photo can be sent". */
  photoEligible: boolean;
  error?: string;
};

/** One customer the operator can pick in the needs-confirmation / Change picker. */
export type CaptureCandidateOption = {
  customerId: string;
  displayName: string;
  contactNumber: string | null;
  /** Has a messageable conversation on the active page. */
  hasConversation: boolean;
  /** Pancake profile photo, to confirm the right person by face. */
  avatarUrl: string | null;
};

/** A floating-screenshot capture waiting on the PC for the operator to turn into an
 *  order. The OCR fields are only a guess — the operator confirms/corrects them. */
export type PendingCaptureRow = {
  captureRecordId: string;
  capturedAt: string;
  /** Short-lived signed URL for the screenshot preview, or null if it couldn't sign. */
  screenshotUrl: string | null;
  /** OCR guess of the Facebook name (may be null/empty). */
  fbName: string | null;
  /** OCR guess of the mined item (code or text) to search inventory with. */
  itemQuery: string | null;
  /** OCR guess of the weight in grams from the pinned comment (a bare number is read
   *  as grams), normalized ("11.50" → "11.5"). Null when no confident number was read
   *  — a "needs review" capture the operator confirms before printing/auto-print. */
  grams: string | null;
  /** Canonical grams proven by the EXACT matched Pancake comment (leading-decimal safety net) — e.g.
   *  OCR read "33" but the comment said ".33" → "0.33". Null when no canonical correction applies.
   *  The raw OCR `grams` above is always preserved; the UI shows effectiveGrams = canonicalGrams ?? grams. */
  canonicalGrams: string | null;
  /** True when captured during a Test Mode session. */
  isTest: boolean;
  // --- Capture-time customer link (resolved from fbName) ----------------------
  /** Resolution outcome; null until the PC resolves it on first sight. */
  linkStatus: CaptureLinkStatus;
  /** The linked MineFlow customer's name, when one was matched. */
  linkedCustomerName: string | null;
  /** The linked MineFlow customer's id, when one was matched. */
  linkedCustomerId: string | null;
  /** True when a messageable Pancake conversation is attached (auto-send is possible). */
  conversationAvailable: boolean;
  /** True only when the linked conversation has a GENUINE customer-initiated Inbox DM inside the
   *  media window (a normal Inbox PHOTO can be delivered now). A `linked` comment-only customer is
   *  false here. Distinct from `conversationAvailable` (merely "a chat exists"). */
  photoEligible: boolean;
  /** The linked customer's saved Messenger URL, for "Open Conversation". */
  fbUrl: string | null;
  /** Whether this capture's screenshot has already been sent ('sent'/'failed'/other). */
  messageStatus: string | null;
  /** Durable auto-router's last human-safe finite reason (e.g. "AUTO TEXT Sent to Messenger ✓",
   *  "AUTO TEXT Failed · awaiting comment context"). Null until the server router has run. */
  routeReason: string | null;
  /** The capture's messaging sequence, fixed at its first send ('screenshot_first' / 'classic'),
   *  or null for a capture that has not started messaging (or predates the setting). */
  messageSequence?: string | null;
  /** Screenshot-first computation text state (pending / sending / sent / waiting_reply / failed /
   *  unconfirmed), or null. */
  textSendStatus?: string | null;
  /** Computation First screenshot state (same values), or null. */
  photoSendStatus?: string | null;
};

/** Where the next (older) page starts: the oldest row already loaded. Newest-first keyset on
 *  (captured_at, id), so a capture arriving on top can never shift, duplicate or skip a page. */
export type PendingCapturesCursor = { capturedAt: string; id: string };

export type PendingCapturesPage = {
  rows: PendingCaptureRow[];
  /** EXACT number of pending captures (the same count the pill shows), not rows.length;
   *  null when the count could not be read (the station keeps its last known total). */
  total: number | null;
};
