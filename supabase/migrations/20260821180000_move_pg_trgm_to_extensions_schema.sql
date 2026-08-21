-- #6 (Owner 2026-08-21): move pg_trgm out of public into the dedicated extensions schema (advisor
-- extension_in_public). Safe: the 10 GIN trigram indexes reference gin_trgm_ops by OID (survive the
-- move), ilike (~~*) is pg_catalog, and no business function uses trgm operators/functions directly.
--
-- VERIFIED on prod after the move: pg_trgm is in `extensions`; a `display_name ilike '%an%'` search
-- still plans as `Bitmap Index Scan on customers_display_name_trgm_idx` and returns correct counts
-- (customers 295 / inventory item_name 0 / item_code 3451). Trigram search unaffected.
-- Rollback: alter extension pg_trgm set schema public;
alter extension pg_trgm set schema extensions;
