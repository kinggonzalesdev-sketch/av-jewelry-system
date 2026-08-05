-- Owner request: "Review Attendance" (all-staff attendance) should work for any
-- member granted hr_review_attendance in Manage Access — not just the Owner. The
-- read policy previously allowed a member only their OWN record (or everything for
-- the Owner), so a granted Admin saw a page with just their own row. Broaden it so
-- a holder of hr_review_attendance reads every attendance record. The nav item and
-- page guard are updated in the same change to stop hard-coding owner-only.
drop policy if exists attendance_read on public.attendance_records;
create policy attendance_read on public.attendance_records
  for select to authenticated
  using (
    staff_profile_id = app_private.current_staff_id()
    or app_private.is_owner()
    or app_private.has_permission('hr_review_attendance')
  );
