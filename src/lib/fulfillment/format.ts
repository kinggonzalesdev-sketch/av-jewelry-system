/**
 * Pure, client-safe fulfillment display helpers. No money math here — money is
 * computed in SQL and formatted with the payments helpers.
 */

/** Human label for a collection channel. Unknown/absent → an honest em dash. */
export function channelLabel(channel: string | null | undefined): string {
  switch (channel) {
    case 'rider':
      return 'Own Rider';
    case 'lbc':
      return 'LBC';
    default:
      return '—';
  }
}
