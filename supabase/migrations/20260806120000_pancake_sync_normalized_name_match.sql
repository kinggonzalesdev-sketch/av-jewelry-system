-- Pancake auto-link was matching lower(display_name) = lower(name) — a case-insensitive
-- but otherwise EXACT full-name match, so any difference in spacing, punctuation, or a
-- trailing "Jr." left most customers unlinked (12 of 86). Match on a NORMALIZED name
-- instead (lower + punctuation stripped + whitespace collapsed) so many more link. Safe:
-- only auto-link when EXACTLY ONE active customer has that normalized name — same-name
-- collisions are left for manual linking (never mis-link one person's chat to another).

-- Shared name normalizer: lower-case, punctuation -> space, collapse whitespace, trim.
create or replace function app_private.normalize_name(p text)
returns text language sql immutable set search_path to '' as $$
  select btrim(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '[[:punct:]]+', ' ', 'g'),
           '[[:space:]]+', ' ', 'g'));
$$;

create or replace function public.sync_pancake_conversations(p_pairs jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_pair jsonb;
  v_name text;
  v_conv text;
  v_norm text;
  v_count int;
  v_matched int := 0;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: only the Owner or Selected Admin can sync Pancake conversations.'
      using errcode = 'insufficient_privilege';
  end if;

  for v_pair in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_name := trim(coalesce(v_pair->>'name', ''));
    v_conv := trim(coalesce(v_pair->>'conversation_id', ''));
    if v_name = '' or v_conv = '' then continue; end if;

    v_norm := app_private.normalize_name(v_name);
    if v_norm = '' then continue; end if;

    -- Only auto-link when the normalized name is UNIQUE among active customers.
    select count(*) into v_count
    from public.customers
    where is_active and app_private.normalize_name(display_name) = v_norm;

    if v_count = 1 then
      update public.customers
        set pancake_conversation_id = v_conv
        where is_active and app_private.normalize_name(display_name) = v_norm;
      v_matched := v_matched + 1;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched);
end;
$function$;
