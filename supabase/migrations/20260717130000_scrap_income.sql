-- ============================================================================
-- Scrap income — a separate income report for scrap gold/silver (solution G).
-- ----------------------------------------------------------------------------
-- Scrap is a real income stream kept separate from item sales. One row per scrap
-- sale; income is summed IN SQL (numeric) and reported as a string. Any active
-- staff may record a scrap sale (attributed to themselves) and read the report;
-- records are not edited or deleted (append-only, like other money records).
-- ============================================================================

create table public.scrap_sales (
  id uuid primary key default gen_random_uuid(),
  material text not null check (material in ('gold', 'silver')),
  grams numeric(12, 3) not null check (grams > 0),
  amount numeric(14, 2) not null check (amount >= 0),
  buyer text check (buyer is null or length(trim(buyer)) between 1 and 160),
  sold_on date not null default current_date,
  note text check (note is null or length(trim(note)) <= 500),
  recorded_by uuid references public.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.scrap_sales is
  'Scrap gold/silver income (Bible §G). Separate from item sales. Append-only; income is summed in SQL.';

create index scrap_sales_material_date_idx on public.scrap_sales (material, sold_on desc);

alter table public.scrap_sales enable row level security;
alter table public.scrap_sales force row level security;
revoke all on public.scrap_sales from anon, authenticated;

create policy scrap_read on public.scrap_sales
  for select to authenticated using (app_private.is_active_staff());

-- Recording a scrap sale attributes it to the caller (self-attribution), the
-- same integrity control used for attachments.
create policy scrap_insert on public.scrap_sales
  for insert to authenticated
  with check (
    app_private.is_active_staff()
    and recorded_by = app_private.current_staff_id()
  );

-- No update/delete policy: scrap income is not rewritten or erased.
grant select, insert on public.scrap_sales to authenticated;

-- ----------------------------------------------------------------------------
-- Scrap income report — totals per material, summed in SQL, returned as strings.
-- ----------------------------------------------------------------------------
create or replace function public.report_scrap_income(p_from date, p_to date)
returns table (
  material text,
  total_grams text,
  total_amount text,
  sale_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.material,
    coalesce(sum(s.grams), 0)::text as total_grams,
    coalesce(sum(s.amount), 0)::text as total_amount,
    count(s.id)::int as sale_count
  from (values ('gold'), ('silver')) as m(material)
  left join public.scrap_sales s
    on s.material = m.material
    and s.sold_on between p_from and p_to
  group by m.material
  order by m.material;
$$;

comment on function public.report_scrap_income(date, date) is
  'Scrap income totals per material (Bible §G). Sums numeric in SQL, returned as strings. security invoker: RLS scopes rows.';

revoke all on function public.report_scrap_income(date, date) from public;
grant execute on function public.report_scrap_income(date, date) to authenticated;
