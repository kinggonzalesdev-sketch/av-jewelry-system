-- Route B: allow mark_capture_photo_state to set a 'link_sent' terminal status (a secure-link
-- Private Reply was sent), alongside the existing failure states, and protect it from being
-- overwritten. Additive.
create or replace function public.mark_capture_photo_state(p_capture_id uuid, p_status text)
returns text language plpgsql security definer set search_path to '' as $function$
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('failed', 'awaiting_inbox', 'link_sent') then
    raise exception 'mark_capture_photo_state only sets failed/awaiting_inbox/link_sent.'
      using errcode = 'check_violation';
  end if;
  update public.capture_records
    set message_status = p_status
    where id = p_capture_id
      and coalesce(message_status, '') not in ('sent', 'sending', 'link_sent');
  return p_status;
end;
$function$;
