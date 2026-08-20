-- #6 sweep follow-up (Owner 2026-08-20): after reviewing the bodies, unpin the two name-matching
-- helpers. Both are LANGUAGE sql IMMUTABLE, SECURITY INVOKER, and reference ONLY pg_catalog built-ins
-- (normalize_name: btrim/regexp_replace/lower/coalesce) plus, for name_key, the fully-qualified
-- app_private.normalize_name — so nothing depends on search_path and the `SET search_path TO ''` pin
-- gives zero security benefit while blocking inlining. They are HOT: webhook_store_pancake_live_comment
-- runs `where app_private.normalize_name(display_name) = v_norm` per customer row on every Live comment
-- (auto-link). RESET leaves the body untouched -> output byte-identical.
--
-- VERIFIED on prod: md5 signature of normalize_name+name_key over ALL 1027 customers unchanged
-- before/after (distinct_norm:882, distinct_key:862); both now report proconfig IS NULL (inlinable).
--
-- FOLLOW-UP IDEA (not done): a functional index on app_private.normalize_name(display_name) would
-- turn the per-comment auto-link customer scan from O(n) into an index lookup at scale.
--
-- Rollback: ALTER FUNCTION app_private.normalize_name(text) SET search_path TO '';  (and name_key)
alter function app_private.normalize_name(text) reset search_path;
alter function app_private.name_key(text) reset search_path;
