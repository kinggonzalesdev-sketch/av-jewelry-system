/** Types for the Live Operations → Error Recovery Center. Kept free of any
 *  server-only import so the client panel can share them. */

export type LiveErrorKind = 'message' | 'print';

/** One failed operation surfaced for recovery. */
export type LiveErrorRow = {
  id: string;
  kind: LiveErrorKind;
  /** Who/what it was for — customer + order, or item + customer — so the operator
   *  recognises it at a glance. */
  title: string;
  /** The failure reason, when the source recorded one. */
  detail: string | null;
  occurredAt: string | null;
  /** The order to retry a failed message send against (message rows only). */
  orderId: string | null;
  /** From a Test Mode session — shown with a TEST tag, never hidden. */
  isTest: boolean;
};

export type LiveErrorReport =
  | { ok: true; messages: LiveErrorRow[]; prints: LiveErrorRow[] }
  | { ok: false; reason: string };
