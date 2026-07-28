/**
 * Demo login — CLIENT-SAFE persona metadata only (labels, no credentials).
 *
 * This module carries nothing secret: no emails, no passwords. It is safe to
 * import into a client component to render the demo buttons. Credential
 * resolution and the enable check live in `demo.server.ts`, which is server-only
 * — so a password can never be bundled into the browser.
 *
 * Purpose: let the Owner walk a client through the real system quickly, signing
 * in as each role with one tap instead of typing credentials. The accounts are
 * REAL (the seeded demo/UAT accounts), the data is real — nothing is faked.
 */

export type DemoPersona = {
  /** Stable key sent to the server action; the server maps it to an account. */
  key: string;
  label: string;
  description: string;
};

/**
 * The roles shown as demo buttons. Order is the walkthrough order: the Owner
 * (sees everything), the highest non-Owner authority, then an everyday operator.
 */
export const DEMO_PERSONAS: DemoPersona[] = [
  { key: 'owner', label: 'Owner', description: 'Sees everything' },
  {
    key: 'admin',
    label: 'Selected Admin',
    description: 'Highest non-Owner authority',
  },
  { key: 'staff', label: 'Staff', description: 'Everyday operator' },
];
