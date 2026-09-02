import { parseInventoryCode } from './code-parser';
import { isHKItem } from './hk-item';

/**
 * The per-row Grams cell text for the Inventory table (Owner 2026-09-02, BR3).
 *
 * An HK ITEM is a FIXED-PRICE piece with no weight, so its Grams column reads the label
 * "Fixed Price" instead of a number or an em dash — a DISPLAY label only. The underlying grams
 * value stays NULL in the database (the literal string is never written to a numeric column).
 *
 * For every other item the value is unchanged: the stored `grams_per_piece` when present, else the
 * grams parsed from the `item_code` text (grams_per_piece is NULL for ~all historical items), else
 * an em dash. Pure + dependency-light so it renders identically in every inventory grams surface.
 */
export const FIXED_PRICE_LABEL = 'Fixed Price';

export function rowGramsDisplay(
  itemCode: string | null | undefined,
  gramsPerPiece?: string | number | null,
  itemName?: string | null,
): string {
  if (isHKItem({ code: itemCode ?? '', name: itemName ?? null })) return FIXED_PRICE_LABEL;
  if (gramsPerPiece !== null && gramsPerPiece !== undefined && `${gramsPerPiece}`.trim() !== '') {
    return `${gramsPerPiece}`;
  }
  return parseInventoryCode(itemCode ?? '').grams ?? '—';
}
