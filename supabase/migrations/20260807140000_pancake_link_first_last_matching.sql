-- Middle-name-tolerant Pancake linking (Owner request 2026-08-07). Customer names are
-- stored First [Middle] Last (e.g. "KING FRANCHESCO GONZALES") but FB names are usually
-- First Last ("King Gonzales"), so exact full-name matching linked only ~27/139. Add a
-- FIRST+LAST key so those link too. Still UNIQUE-GATED (link only when exactly one
-- customer matches), exact matches always win (pass 1), and a first+last match never
-- overwrites an exact one (pass-2 excludes exact-linked customers).
--
-- NOTE: avoid min(id) on a uuid column — this Postgres has no min(uuid) aggregate
-- ("function min(uuid) does not exist"); use `select id ... limit 1` when count = 1.

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
  v_pair jsonb;
  v_name text;
  v_conv text;
  v_norm text;
  v_key text;
  v_count int;
  v_id uuid;
  v_matched int := 0;
  v_exact uuid[] := '{}';
begin
  -- Pass 1: EXACT full-name (strongest). Record linked customers so pass 2 never
  -- overwrites an exact link.
  for v_pair in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_name := trim(coalesce(v_pair->>'name', ''));
    v_conv := trim(coalesce(v_pair->>'conversation_id', ''));
    if v_name = '' or v_conv = '' then continue; end if;
    v_norm := app_private.normalize_name(v_name);
    if v_norm = '' then continue; end if;
    select count(*) into v_count
      from public.customers where is_active and app_private.normalize_name(display_name) = v_norm;
    if v_count = 1 then
      select id into v_id
        from public.customers where is_active and app_private.normalize_name(display_name) = v_norm
        limit 1;
      update public.customers set pancake_conversation_id = v_conv where id = v_id;
      v_exact := array_append(v_exact, v_id);
      v_matched := v_matched + 1;
    end if;
  end loop;

  -- Pass 2: FIRST+LAST key (middle-name tolerant) for names with NO exact candidate,
  -- only when exactly one non-exact-linked customer matches.
  for v_pair in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_name := trim(coalesce(v_pair->>'name', ''));
    v_conv := trim(coalesce(v_pair->>'conversation_id', ''));
    if v_name = '' or v_conv = '' then continue; end if;
    v_norm := app_private.normalize_name(v_name);
    if v_norm = '' then continue; end if;
    perform 1 from public.customers where is_active and app_private.normalize_name(display_name) = v_norm;
    if found then continue; end if; -- had an exact candidate: resolved (or ambiguous) in pass 1
    v_key := app_private.name_key(v_name);
    if v_key = '' then continue; end if;
    select count(*) into v_count
      from public.customers
      where is_active and app_private.name_key(display_name) = v_key and not (id = any(v_exact));
    if v_count = 1 then
      select id into v_id
        from public.customers
        where is_active and app_private.name_key(display_name) = v_key and not (id = any(v_exact))
        limit 1;
      update public.customers set pancake_conversation_id = v_conv where id = v_id;
      v_matched := v_matched + 1;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched);
end;
$$;
