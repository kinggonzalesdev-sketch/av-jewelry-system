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
 * A window CustomEvent (`detail: number`) the Incoming Captures strip fires after
 * every load with its CURRENT number of pending captures. The "Capture Pending"
 * pill listens and shows exactly this, so the pill's badge always matches the
 * popup's "(N)" — the server-rendered count is only the first-paint placeholder
 * until the strip's live count arrives (Owner request 2026-08-09).
 */
export const CAPTURE_COUNT_EVENT = 'mineflow:capture-count';

/** The resolved-customer state of a pending capture (Capture-time linking, 2026-08-09).
 *  Mirrors capture_records.link_status; null = not resolved yet. */
export type CaptureLinkStatus =
  | 'linked'
  | 'needs_confirmation'
  | 'customer_no_chat'
  | 'no_match'
  | null;

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
  /** The linked customer's saved Messenger URL, for "Open Conversation". */
  fbUrl: string | null;
  /** Whether this capture's screenshot has already been sent ('sent'/'failed'/other). */
  messageStatus: string | null;
};
