/**
 * `/orders?order=<id>` opens that order's details directly (Owner 2026-09-26: the Inventory delete
 * popup links each linked order). Only a well-formed UUID is accepted; anything else is ignored and
 * the Orders page opens as usual.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orderIdFromParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}
