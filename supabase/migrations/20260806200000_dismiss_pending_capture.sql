-- Discard a junk/unwanted PENDING floating capture (no order created from it).
-- Active-staff only; only removes an unlinked floating pending row.
create or replace function public.dismiss_pending_capture(p_capture_record_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active MineFlow staff session is required.';
  end if;
  delete from public.capture_records
   where id = p_capture_record_id
     and official_order_id is null
     and source = 'floating';
end;
$function$;

revoke all on function public.dismiss_pending_capture(uuid) from public, anon, authenticated;
grant execute on function public.dismiss_pending_capture(uuid) to authenticated;
