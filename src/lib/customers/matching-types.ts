/** Shared customer-matching types (spec §1/§2). Not server-only so client match UIs
 *  can import them. ONE matching model is used everywhere — Orders, Walk-In, Layaway,
 *  Customer editing, Screenshot processing — never a per-surface copy. */

/** Where a candidate matched, strongest first (mirrors the §2 priority order). */
export type MatchSource =
  | 'pancake_conversation' // an existing linked Pancake conversation id
  | 'phone' // a verified phone number
  | 'exact_name' // exact normalized full name
  | 'similar_name'; // a similar name — never auto-linked, always confirm

export type MatchConfidence = 'high' | 'medium' | 'low';

/** One matched MineFlow customer, with whatever Facebook/Pancake link it already has. */
export type CustomerMatch = {
  customerId: string;
  displayName: string;
  contactNumber: string | null;
  address: string | null;
  /** The saved Messenger URL (Open FB Chat), if any. */
  facebookConversationUrl: string | null;
  /** The saved Pancake conversation id (Send Invoice), if any. */
  pancakeConversationId: string | null;
  hasConversation: boolean;
  confidence: MatchConfidence;
  source: MatchSource;
};

export type CustomerMatchQuery = {
  name?: string | null;
  phone?: string | null;
  /** An existing Pancake conversation id to match on directly (strongest signal). */
  conversationId?: string | null;
};

export type CustomerMatchOutcome = {
  /** The single high-confidence match safe to auto-select, or null. Only set when
   *  there is exactly one strong candidate and no same-name collision. */
  autoMatch: CustomerMatch | null;
  /** All candidates, ranked best-first. */
  candidates: CustomerMatch[];
  /** True when the user must pick — several strong candidates, or only weak ones. */
  needsConfirmation: boolean;
};
