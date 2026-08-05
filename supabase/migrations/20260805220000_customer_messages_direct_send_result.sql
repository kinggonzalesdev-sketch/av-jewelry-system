-- Persist the Pancake send result on the order's customer_message (Owner request,
-- §10): the returned message id, when it was sent, and by whom, plus a 'direct_sent'
-- success status (the schema already had direct_send_pending/direct_send_failed).
-- Additive; the table is empty so widening the CHECK is safe.
alter table public.customer_messages add column if not exists pancake_message_id text;
alter table public.customer_messages add column if not exists auto_sent_at timestamptz;
alter table public.customer_messages add column if not exists auto_sent_by uuid references public.staff_profiles(id);

alter table public.customer_messages drop constraint if exists customer_messages_status_check;
alter table public.customer_messages add constraint customer_messages_status_check
  check (status = any (array[
    'message_draft', 'ready_to_copy_or_send', 'manually_sent',
    'direct_send_pending', 'direct_send_failed', 'direct_sent'
  ]));
