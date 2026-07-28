-- ============================================================================
-- Layaway financers (UI/UX spec §14). Financers are NOT suppliers — a separate
-- business entity. Configurable list (seeded Tess/Izza/Nez), plus per-layaway
-- financer + current holder/location + remarks. "OK" stays a Remark, never a
-- financer; uncertain legacy values ("MANUEL") are left for manual review at
-- import time (import is a later phase).
-- ============================================================================

create table public.financers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.financers is
  'Configurable layaway financers (Bible §F, spec §14). Distinct from suppliers.';

insert into public.financers (name) values ('Tess'), ('Izza'), ('Nez')
on conflict (name) do nothing;

alter table public.financers enable row level security;
alter table public.financers force row level security;
revoke all on public.financers from anon, authenticated;

create policy financers_read on public.financers
  for select to authenticated using (app_private.is_active_staff());
create policy financers_insert on public.financers
  for insert to authenticated with check (app_private.is_owner());
create policy financers_update on public.financers
  for update to authenticated using (app_private.is_owner())
  with check (app_private.is_owner());

grant select, insert, update on public.financers to authenticated;

-- Per-layaway financer + custody/remarks (spec §12/§14). Additive; no existing
-- data changes.
alter table public.layaway_arrangements
  add column if not exists financer_id uuid references public.financers (id),
  add column if not exists current_holder text
    check (current_holder is null or length(trim(current_holder)) <= 120),
  add column if not exists current_location text
    check (current_location is null or length(trim(current_location)) <= 160),
  add column if not exists remarks text
    check (remarks is null or length(trim(remarks)) <= 500);

comment on column public.layaway_arrangements.financer_id is
  'The layaway financer (spec §14). Separate from the supplier and from custody.';
