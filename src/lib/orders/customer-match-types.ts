/**
 * Customer-match info shown before sending an invoice (§6). Not `server-only` so the
 * order modal (a client component) can import the type without the server module.
 */
export type CustomerMatchInfo = {
  /** Other ACTIVE customers with this exact name (case-insensitive) — ambiguity. */
  sameNameCount: number;
  /** Whether this customer has a linked Pancake conversation (auto-send can reach). */
  hasConversation: boolean;
  /** A few of the same-named customers, for the warning. */
  examples: string[];
};
