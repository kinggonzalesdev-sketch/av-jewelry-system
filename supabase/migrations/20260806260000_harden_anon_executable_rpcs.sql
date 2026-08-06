-- Pre-live security hardening: 18 SECURITY DEFINER RPCs were EXECUTE-able by `anon`
-- (EXECUTE is granted to PUBLIC on function creation). Each already REJECTS an
-- unauthenticated caller via an internal guard (is_owner / has_permission /
-- current_staff_role), so there is no active exposure — but anon never legitimately
-- calls them, so we remove the grant as defense in depth (and to clear the Supabase
-- security advisor). EXECUTE is kept for `authenticated` (the app calls these as the
-- signed-in staff member) and `service_role` (server-side admin paths).
do $$
declare
  sig text;
  sigs text[] := array[
    'public.approve_capture_review(uuid)',
    'public.claim_next_label_job(uuid, text)',
    'public.delete_printer(uuid)',
    'public.end_live_session()',
    'public.enqueue_capture_review(text, text, text, uuid, numeric, numeric, text, jsonb, text, text)',
    'public.list_clock_staff()',
    'public.mark_label_job_failed(uuid, text)',
    'public.mark_label_job_printed(uuid)',
    'public.pause_live_session()',
    'public.register_printer(text, text, text, text)',
    'public.reject_capture_review(uuid, text)',
    'public.release_label_claim(uuid)',
    'public.reset_test_data()',
    'public.resume_live_session()',
    'public.set_order_facebook_link(uuid, text, text, text, text, text, text)',
    'public.set_test_mode(boolean)',
    'public.start_live_session(text, uuid, text, text, text, text, boolean)',
    'public.update_printer(uuid, text, boolean, boolean)'
  ];
begin
  foreach sig in array sigs loop
    execute format('revoke execute on function %s from public, anon;', sig);
    execute format('grant execute on function %s to authenticated, service_role;', sig);
  end loop;
end $$;
