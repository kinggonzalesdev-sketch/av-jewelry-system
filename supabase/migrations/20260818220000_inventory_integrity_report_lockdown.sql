-- Lock the read-only integrity detector down to AUTHENTICATED managers only.
--
-- A public-schema function is EXECUTE-able by PUBLIC + anon by default. The in-function role
-- gate already blocks non-managers (anon -> null role -> "Not authorized"), but defense-in-depth
-- requires it not be anonymously/publicly callable at all. Authenticated staff keep access; the
-- function itself then restricts to owner / selected_admin internally.
revoke execute on function public.inventory_integrity_report() from public;
revoke execute on function public.inventory_integrity_report() from anon;
grant execute on function public.inventory_integrity_report() to authenticated;
