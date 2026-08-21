-- #5 (Owner 2026-08-21): sticker_settings had two permissive SELECT policies — sticker_settings_read
-- (FOR SELECT, is_active_staff) and sticker_settings_write (FOR ALL, which also covers SELECT). Split
-- the write policy into INSERT/UPDATE/DELETE so SELECT is governed by ONE policy, and widen the read
-- policy to preserve the OLD select access EXACTLY (is_active_staff OR owner/selected_admin — admins
-- are active staff so this is equivalent, kept for exactness). Clears the last multiple_permissive_
-- policies advisory. 1-row config table; write gating unchanged.
-- VERIFIED on prod: sticker_settings now has exactly 1 policy per command (SELECT/INSERT/UPDATE/DELETE).
-- Rollback: recreate the FOR ALL write policy + the SELECT-only read policy.
drop policy sticker_settings_read  on public.sticker_settings;
drop policy sticker_settings_write on public.sticker_settings;
create policy sticker_settings_read on public.sticker_settings for select to authenticated
  using (app_private.is_active_staff() or app_private.current_staff_role() = any (array['owner','selected_admin']));
create policy sticker_settings_insert on public.sticker_settings for insert to authenticated
  with check (app_private.current_staff_role() = any (array['owner','selected_admin']));
create policy sticker_settings_update on public.sticker_settings for update to authenticated
  using (app_private.current_staff_role() = any (array['owner','selected_admin']))
  with check (app_private.current_staff_role() = any (array['owner','selected_admin']));
create policy sticker_settings_delete on public.sticker_settings for delete to authenticated
  using (app_private.current_staff_role() = any (array['owner','selected_admin']));
