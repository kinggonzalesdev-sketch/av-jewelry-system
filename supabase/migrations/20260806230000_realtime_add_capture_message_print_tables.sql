-- Add the capture / message / print tables to Realtime so their changes broadcast:
-- capture_records powers "Incoming Captures" auto-appearing on the PC the moment the
-- phone uploads; customer_messages + label_jobs power live message/print status.
-- Additive + safe (RLS still gates who receives each change).
alter publication supabase_realtime add table public.capture_records;
alter publication supabase_realtime add table public.customer_messages;
alter publication supabase_realtime add table public.label_jobs;
