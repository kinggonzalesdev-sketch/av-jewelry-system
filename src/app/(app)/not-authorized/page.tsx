import type { Metadata } from 'next';

import { NotAuthorized } from '@/components/states/not-authorized';

export const metadata: Metadata = {};

/**
 * Not-authorized destination.
 *
 * Reaching this page is the RESULT of a server-side denial, never the mechanism of
 * one. When permissions land in Roadmap Phase 2, server-side checks will redirect
 * here after already refusing the action and changing no record (Bible §11.45).
 */
export default function NotAuthorizedPage() {
  return <NotAuthorized />;
}
