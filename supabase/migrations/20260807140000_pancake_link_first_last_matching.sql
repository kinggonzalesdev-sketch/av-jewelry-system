-- Middle-name-tolerant Pancake linking (Owner request 2026-08-07). Customer names are
-- stored First [Middle] Last ("KING FRANCHESCO GONZALES") but FB names are First Last
-- ("King Gonzales"), so exact full-name matching linked only ~27/140. Add a FIRST+LAST
-- key so those link too. UNIQUE-GATED (link only when exactly one customer matches),
-- exact matches always win, first+last never overwrites an exact link.
--
-- Implemented SET-BASED (not a per-pair loop): a loop over 1367 conversations re-scanned
-- all customers with regexp-heavy normalize_name each time and hit the 8s statement
-- timeout. Computing each customer's keys ONCE + resolving all pairs by hash join runs
-- in ~200ms. (Also avoids min(uuid), which this Postgres has no aggregate for.)

-- "first|last" of the normalized name — internal only (SECURITY DEFINER RPCs call it).
create or replace function app_private.name_key(p text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when app_private.normalize_name(p) = '' then ''
    else split_part(app_private.normalize_name(p), ' ', 1) || '|' ||
         (string_to_array(app_private.normalize_name(p), ' '))[
           cardinality(string_to_array(app_private.normalize_name(p), ' '))]
  end;
$$;
revoke execute on function app_private.name_key(text) from public, anon, authenticated;

create or replace function app_private.link_pancake_conversations(p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_matched int;
begin
  with cust as (
    select id,
      app_private.normalize_name(display_name) as norm,
      app_private.name_key(display_name) as key
    from public.customers
    where is_active
  ),
  exact_map as (  -- unique exact normalized name -> customer
    select norm, (array_agg(id))[1] as id
    from cust where norm <> '' group by norm having count(*) = 1
  ),
  fl_map as (     -- unique first|last key -> customer
    select key, (array_agg(id))[1] as id
    from cust where key <> '' group by key having count(*) = 1
  ),
  pairs as (
    select distinct
      trim(elem->>'conversation_id') as conv,
      app_private.normalize_name(trim(elem->>'name')) as norm,
      app_private.name_key(trim(elem->>'name')) as key
    from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) elem
    where trim(coalesce(elem->>'name', '')) <> ''
      and trim(coalesce(elem->>'conversation_id', '')) <> ''
  ),
  resolved as (
    -- exact match wins; first+last only when the name has no unique exact customer.
    select p.conv, coalesce(e.id, f.id) as cust_id, (e.id is not null) as is_exact
    from pairs p
    left join exact_map e on e.norm = p.norm
    left join fl_map f
      on f.key = p.key and not exists (select 1 from exact_map e2 where e2.norm = p.norm)
    where coalesce(e.id, f.id) is not null
  ),
  ranked as (  -- one conversation per customer; an exact-resolved one always wins
    select cust_id, conv,
      row_number() over (partition by cust_id order by is_exact desc, conv desc) as rn
    from resolved
  ),
  upd as (
    update public.customers c
      set pancake_conversation_id = r.conv
      from ranked r
      where c.id = r.cust_id and r.rn = 1
      returning c.id
  )
  select count(*) into v_matched from upd;

  return jsonb_build_object('matched', v_matched);
end;
$$;
