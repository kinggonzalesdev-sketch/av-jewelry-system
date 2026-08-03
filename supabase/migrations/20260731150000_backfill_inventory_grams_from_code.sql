-- Auto-detect grams for existing inventory (Owner request): where an item has no
-- stored weight but its code embeds a "…g" figure (e.g. "SBA-N-2683 1.80g"), fill
-- grams_per_piece from that figure. Mirrors the app's parseInventoryCode regex.
-- Only touches rows that are currently blank — never overwrites a real weight.
update public.inventory_items
set grams_per_piece = (substring(item_code from '([0-9]*\.?[0-9]+)\s*[gG]'))::numeric
where grams_per_piece is null
  and item_code ~* '([0-9]*\.?[0-9]+)\s*g';
