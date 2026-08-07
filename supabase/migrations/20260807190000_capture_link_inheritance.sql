-- Capture → Order LINK INHERITANCE (auto-link/send spec §2, §11, §12, §13).
--
-- Problem: the Facebook/Pancake conversation resolved at CAPTURE time (when the phone
-- auto-sends the screenshot to a uniquely-matched customer) was used for the send but
-- never persisted. So the order created from that capture had no link and got
-- RE-MATCHED by name on open — the "meron kaming conversation pero di naka-link" gap.
--
-- Fix (both additive & safe):
--   1) update_capture_dispatch also stores the resolved conversation on the capture
--      row, so a send (even a failed one, for retry) leaves the identity attached.
--   2) link_capture_to_order copies that confirmed conversation onto the ORDER and the
--      CUSTOMER when the capture becomes an order — so Open FB Chat / Send Invoice reuse
--      exactly that chat with no weak re-matching. It NEVER clobbers an existing link
--      (a manual link on the order, or a conversation the customer already has, wins).

-- 1) Persist the resolved conversation when recording a dispatch. The signature gains a
--    trailing, defaulted param, so the old 6-arg version is dropped and replaced.
drop function if exists public.update_capture_dispatch(text, text, text, text, text, text);

create or replace function public.update_capture_dispatch(
  p_device text,
  p_capture_id text,
  p_message_status text default null,
  p_print_status text default null,
  p_pancake_message_id text default null,
  p_screenshot_path text default null,
  p_pancake_conversation_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key text;
  v_row public.capture_records%rowtype;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_device), '') = '' or coalesce(trim(p_capture_id), '') = '' then
    raise exception 'A device id and capture id are required.' using errcode = 'check_violation';
  end if;

  v_key := 'capture:' || trim(p_device) || ':' || trim(p_capture_id);

  update public.capture_records
    set message_status = coalesce(nullif(trim(p_message_status), ''), message_status),
        print_status = coalesce(nullif(trim(p_print_status), ''), print_status),
        pancake_message_id = coalesce(nullif(trim(p_pancake_message_id), ''), pancake_message_id),
        screenshot_path = coalesce(nullif(trim(p_screenshot_path), ''), screenshot_path),
        pancake_conversation_id =
          coalesce(nullif(trim(p_pancake_conversation_id), ''), pancake_conversation_id)
    where idempotency_key = v_key
    returning * into v_row;

  if not found then
    raise exception 'No capture record for that device/capture.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'capture_record_id', v_row.id,
    'message_status', v_row.message_status,
    'print_status', v_row.print_status
  );
end;
$function$;

revoke all on function
  public.update_capture_dispatch(text, text, text, text, text, text, text) from public, anon;
grant execute on function
  public.update_capture_dispatch(text, text, text, text, text, text, text) to authenticated;

-- 2) Inherit the confirmed link when a capture becomes an order.
create or replace function public.link_capture_to_order(
  p_capture_record_id uuid,
  p_order_id uuid
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_conv text;
  v_pcust text;
  v_customer uuid;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active MineFlow staff session is required.';
  end if;

  -- Attach the order to the capture and read back the capture's resolved link (if any).
  update public.capture_records
     set official_order_id = p_order_id,
         confirmed = jsonb_build_object('confirmed_at', now(), 'via', 'pc_review')
   where id = p_capture_record_id
   returning nullif(trim(coalesce(pancake_conversation_id, '')), ''),
             nullif(trim(coalesce(pancake_customer_id, '')), '')
        into v_conv, v_pcust;

  if v_conv is null then
    return; -- capture never resolved a conversation — order-open matching handles it.
  end if;

  -- Copy onto the ORDER, but only if it isn't already linked (a manual link wins).
  update public.official_orders o set
      fb_pancake_conversation_id = v_conv,
      fb_pancake_customer_id = coalesce(nullif(trim(coalesce(o.fb_pancake_customer_id, '')), ''), v_pcust),
      fb_link_method = 'capture',
      fb_link_confidence = 'auto',
      fb_link_status = 'confirmed',
      fb_linked_by = coalesce(o.fb_linked_by, app_private.current_staff_id()),
      fb_linked_at = coalesce(o.fb_linked_at, now())
    where o.id = p_order_id
      and nullif(trim(coalesce(o.fb_pancake_conversation_id, '')), '') is null;

  -- Carry the identity to the CUSTOMER too (future orders inherit it). Never overwrites
  -- a conversation the customer already has.
  select customer_id into v_customer from public.official_orders where id = p_order_id;
  if v_customer is not null then
    update public.customers c
       set pancake_conversation_id = v_conv
     where c.id = v_customer
       and nullif(trim(coalesce(c.pancake_conversation_id, '')), '') is null;
  end if;
end;
$function$;

revoke all on function public.link_capture_to_order(uuid, uuid) from public, anon;
grant execute on function public.link_capture_to_order(uuid, uuid) to authenticated;
