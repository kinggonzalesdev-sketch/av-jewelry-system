-- BULK "SEND INVOICES" + REMINDERS FOR SENT INVOICES (Owner 2026-09-25).
--
-- The Orders -> For Invoice "Send Invoices" window sends many invoices through the SAME
-- individual Send Invoice path (sendOrderInvoice). That path records its outcome on the order's
-- customer_messages row but never claimed the send, so two clicks, two tabs or two admins could
-- each deliver the same invoice. This migration adds the claim the bulk window needs:
--
--   1. claim_order_invoice_send(order)   - locks the ORDER row, then moves its message to
--      'direct_send_pending' (a status the table already allows). Refuses an order that is not in
--      For Invoice, an invoice already sent ('direct_sent' / 'manually_sent'), a send in flight
--      (pending < 2 minutes) and a stale pending ('unconfirmed': the worker vanished after maybe
--      reaching Pancake, so it is never re-sent automatically; staff check the chat).
--   2. finalize_order_invoice_send(order) - the safety net that closes a claim the send path could
--      not record (its own write is RLS-gated); a no-op when the send path already recorded it.
--   3. release_order_invoice_send(order)  - hands a claim back when nothing was sent (incomplete
--      grams/price, no linked chat, Test Session).
--   4. record_order_reminder - reminders were allowed only in the retired For Reminder status;
--      sent invoices now stay in For Invoice. A For Invoice order may now be reminded once its
--      invoice was sent. Still 1..3 in sequence, never the same number twice, and never for an
--      order that is paid in full.
--   5. Reminder template - its wording still said "for your order {order_number}"; order numbers
--      were retired, so that line is reworded (only while it is still the untouched text).
--
-- Additive: three new functions, record_order_reminder re-created from its LIVE definition with
-- the For Invoice branch and the paid-in-full check added, one guarded text change. No column,
-- no other data change. The individual Send Invoice is untouched.
--
-- ROLLBACK (only if ever needed):
--   drop function if exists public.claim_order_invoice_send(uuid);
--   drop function if exists public.finalize_order_invoice_send(uuid, boolean, text);
--   drop function if exists public.release_order_invoice_send(uuid, text);
--   re-create public.record_order_reminder from the save point (live definition before this).
--   update public.message_templates set body = replace(body, 'A friendly reminder about your order.',
--     'A friendly reminder for your order {order_number}.') where key = 'reminder_1'; (same for default_body)

create or replace function public.claim_order_invoice_send(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_status text;
  v_destination text;
  v_customer uuid;
  v_message_id uuid;
  v_message_status text;
  v_message_updated timestamptz;
  v_actor uuid;
begin
  if not app_private.has_permission('invoice_preparation') then
    raise exception 'Not authorized: the invoice_preparation permission is required.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The ORDER row is the lock: two claims for one order run one after the other.
  select o.status, o.fulfillment_destination, o.customer_id
    into v_status, v_destination, v_customer
    from public.official_orders o
   where o.id = p_order_id
     for update;
  if not found then return 'not_found'; end if;
  if v_status <> 'invoiced' or v_destination is not null then return 'not_for_invoice'; end if;

  select m.id, m.status, m.updated_at
    into v_message_id, v_message_status, v_message_updated
    from public.customer_messages m
   where m.official_order_id = p_order_id
   order by m.created_at desc
   limit 1;

  if v_message_id is not null then
    if v_message_status in ('direct_sent', 'manually_sent') then return 'already_sent'; end if;
    if v_message_status = 'direct_send_pending' then
      if v_message_updated > now() - interval '2 minutes' then return 'in_progress'; end if;
      return 'unconfirmed';
    end if;
    update public.customer_messages set status = 'direct_send_pending' where id = v_message_id;
    return 'claimed';
  end if;

  select sp.id into v_actor from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  insert into public.customer_messages (official_order_id, customer_id, body, status, created_by)
  values (p_order_id, v_customer, '', 'direct_send_pending', v_actor);
  return 'claimed';
end
$$;

create or replace function public.finalize_order_invoice_send(
  p_order_id uuid,
  p_delivered boolean,
  p_body text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_message_id uuid;
  v_actor uuid;
begin
  if not app_private.has_permission('invoice_preparation') then
    raise exception 'Not authorized: the invoice_preparation permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  select m.id into v_message_id
    from public.customer_messages m
   where m.official_order_id = p_order_id and m.status = 'direct_send_pending'
   order by m.created_at desc
   limit 1
     for update;
  if v_message_id is null then return 'noop'; end if;

  select sp.id into v_actor from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  update public.customer_messages
     set status = case when p_delivered then 'direct_sent' else 'direct_send_failed' end,
         body = coalesce(nullif(btrim(coalesce(p_body, '')), ''), body),
         auto_sent_at = case when p_delivered then now() else auto_sent_at end,
         auto_sent_by = case when p_delivered then v_actor else auto_sent_by end
   where id = v_message_id;
  return case when p_delivered then 'sent' else 'failed' end;
end
$$;

create or replace function public.release_order_invoice_send(p_order_id uuid, p_restore text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_message_id uuid;
begin
  if not app_private.has_permission('invoice_preparation') then
    raise exception 'Not authorized: the invoice_preparation permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_restore is null
     or p_restore not in ('message_draft', 'ready_to_copy_or_send', 'direct_send_failed') then
    raise exception 'Unknown message status.' using errcode = 'check_violation';
  end if;
  select m.id into v_message_id
    from public.customer_messages m
   where m.official_order_id = p_order_id and m.status = 'direct_send_pending'
   order by m.created_at desc
   limit 1
     for update;
  if v_message_id is null then return 'noop'; end if;
  update public.customer_messages set status = p_restore where id = v_message_id;
  return 'released';
end
$$;

revoke all on function public.claim_order_invoice_send(uuid) from public, anon;
revoke all on function public.finalize_order_invoice_send(uuid, boolean, text) from public, anon;
revoke all on function public.release_order_invoice_send(uuid, text) from public, anon;
grant execute on function public.claim_order_invoice_send(uuid) to authenticated;
grant execute on function public.finalize_order_invoice_send(uuid, boolean, text) to authenticated;
grant execute on function public.release_order_invoice_send(uuid, text) to authenticated;

create or replace function public.record_order_reminder(p_order_id uuid, p_number smallint, p_body text, p_channel text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid;
  v_status text;
  v_prev int;
  v_id uuid;
begin
  if not (
    app_private.current_staff_role() in ('owner', 'selected_admin')
    or app_private.has_permission('message_preparation')
    or app_private.has_permission('message_sending')
  ) then
    raise exception 'Not authorized: sending a reminder needs message preparation/sending permission.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_number not between 1 and 3 then
    raise exception 'Reminder number must be 1, 2, or 3.';
  end if;

  select status into v_status from public.official_orders where id = p_order_id;
  if v_status is null then
    raise exception 'Official Order not found.';
  end if;
  -- 2026-09-25 (Owner): sent invoices now stay in For Invoice, so a For Invoice order may be
  -- reminded once its invoice was sent. The retired For Reminder status keeps working.
  if v_status = 'invoiced' then
    if not exists (
      select 1 from public.customer_messages m
       where m.official_order_id = p_order_id and m.status in ('direct_sent', 'manually_sent')
    ) then
      raise exception 'Send the invoice first: a reminder follows a sent invoice.';
    end if;
  elsif v_status <> 'awaiting_required_payment' then
    raise exception 'Reminders can only be sent for a For Invoice order whose invoice was sent.';
  end if;
  if coalesce((public.order_balance(p_order_id) ->> 'paid_in_full')::boolean, false) then
    raise exception 'This order is paid in full: no reminder is needed.';
  end if;

  -- Sequence: reminder N requires N-1 already recorded.
  if p_number > 1 then
    select count(*) into v_prev from public.order_reminders
      where official_order_id = p_order_id and reminder_number = p_number - 1;
    if v_prev = 0 then
      raise exception 'Send reminder % first.', p_number - 1;
    end if;
  end if;

  select sp.id into v_actor from public.staff_profiles sp
    where sp.auth_user_id = (select auth.uid());

  begin
    insert into public.order_reminders (official_order_id, reminder_number, body, channel, sent_by)
    values (p_order_id, p_number, p_body, coalesce(nullif(btrim(p_channel), ''), 'facebook_manual'), v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Reminder % was already sent for this order.', p_number;
  end;

  return v_id;
end;
$function$;

update public.message_templates
   set body = replace(body, 'A friendly reminder for your order {order_number}.', 'A friendly reminder about your order.')
 where key = 'reminder_1'
   and position('A friendly reminder for your order {order_number}.' in body) > 0;
update public.message_templates
   set default_body = replace(default_body, 'A friendly reminder for your order {order_number}.', 'A friendly reminder about your order.')
 where key = 'reminder_1'
   and position('A friendly reminder for your order {order_number}.' in default_body) > 0;
