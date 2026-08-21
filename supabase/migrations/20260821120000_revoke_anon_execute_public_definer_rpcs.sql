-- #4 anon-execute hardening (Owner 2026-08-21). Supabase default privileges auto-grant EXECUTE to
-- anon+authenticated+service_role on every new public function, so these SECURITY DEFINER business
-- RPCs were anon-callable (the advisor's 15 anon_security_definer_function_executable). They all gate
-- internally (raise 'Not authorized' for a non-staff caller), but defense-in-depth: revoke anon (and
-- any PUBLIC) EXECUTE so anon can't invoke them at all. authenticated + service_role keep their own
-- explicit grants (the app calls these as authenticated staff / the webhook as service_role), so no
-- functionality changes.
--
-- app_private helpers/triggers are deliberately NOT touched: app_private is not exposed via PostgREST
-- (unreachable by anon over the API), and several (is_active_staff/has_permission/is_owner/has_scope/
-- current_staff_*) are referenced in RLS policies where revoking anon EXECUTE would break policy
-- evaluation for anon queries.
--
-- VERIFIED on prod: after this, 0 public-schema DEFINER functions are anon-executable; all 15 keep
-- authenticated + service_role. Rollback: grant execute on function public.<sig> to anon;
revoke execute on function public.add_order_item(uuid, uuid, numeric, integer)                       from anon, public;
revoke execute on function public.apply_inventory_item_edit(uuid, jsonb, jsonb)                      from anon, public;
revoke execute on function public.completed_inventory_page(text, text, integer, integer)             from anon, public;
revoke execute on function public.inventory_active_ids_page(text, text, text, integer, integer)      from anon, public;
revoke execute on function public.layaway_page(text, text, text, text, text, integer, integer)       from anon, public;
revoke execute on function public.orders_page(text, text, text, text, integer, integer)              from anon, public;
revoke execute on function public.mark_order_dispatched(uuid)                                        from anon, public;
revoke execute on function public.request_inventory_change(text, uuid, text, jsonb)                  from anon, public;
revoke execute on function public.request_order_edit(text, uuid, jsonb, text)                        from anon, public;
revoke execute on function public.save_pancake_sender_selection(text, text)                          from anon, public;
revoke execute on function public.set_fulfillment_details(uuid, text, text)                          from anon, public;
revoke execute on function public.set_layaway_term(uuid, smallint)                                   from anon, public;
revoke execute on function public.webhook_backfill_live_commenter(text, text, text, text, text)      from anon, public;
revoke execute on function public.webhook_recent_live_threads(text)                                  from anon, public;
revoke execute on function public.webhook_capture_raw_diag(text, text, text, text, jsonb, text)      from anon, public;
