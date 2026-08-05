/** Shared types for the Review Mode capture queue. Not server-only so the client
 *  review panel can import them. */

export type CaptureReviewRow = {
  id: string;
  customerName: string;
  itemCode: string | null;
  itemName: string | null;
  /** Money as a string end-to-end. */
  price: string;
  grams: string | null;
  screenshotPath: string | null;
  /** From a Test Mode session — shown with a TEST tag, never hidden. */
  isTest: boolean;
  createdAt: string;
};

export type CaptureReviewResult = { ok: true } | { ok: false; error: string };
