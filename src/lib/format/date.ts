/**
 * ONE date format for the whole app (Owner request 2026-08-09): the long
 * "Month Day, Year" form — e.g. "August 8, 2026" — never the numeric 08/08/2026
 * or the ISO 2026-08-08.
 *
 * Pinned to the `en-US` locale so the output never drifts with the server's
 * locale (the app renders on Vercel, whose locale is not guaranteed). The print
 * helpers ([lib/print/order-receipt.ts] stickerDate / slipDateTime) already use
 * this exact shape, so screen and sticker read the same.
 *
 * A missing / unparseable value returns the original string when there is one
 * (so a raw value is never hidden), or an em dash when there is nothing to show.
 */

type DateInput = string | number | Date | null | undefined;

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fallback(input: DateInput): string {
  return typeof input === 'string' && input.trim() ? input : '—';
}

/** Long date only — "August 8, 2026". */
export function formatDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return fallback(input);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Long date + time — "August 8, 2026, 3:45 PM". */
export function formatDateTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return fallback(input);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
