/**
 * Pending-capture shapes shared by the server reader and the client
 * `IncomingCapturesStrip`. Kept OUT of any `server-only` module so the client can
 * import the types without pulling server code into the browser bundle.
 */

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
};
