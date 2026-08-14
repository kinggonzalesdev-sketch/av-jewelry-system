-- Owner request (2026-08-13): add "Remittance" to the Mode of Payment choices across
-- the ENTIRE system. Frontend: adding it to PAYMENT_METHODS (src/lib/payments/methods.ts)
-- flows to every dropdown + the Zod validation (ACCEPTED_PAYMENT_METHODS). DB: widen the
-- payments CHECK and the three active RPC method whitelists so a "Remittance" payment
-- stores verbatim instead of being coerced to 'other'.
--
-- Applied to the database via Supabase MCP (this file mirrors it for repo history). The
-- RPC bodies are edited surgically: each live definition is fetched and ONLY its whitelist
-- substring is swapped, aborting if the expected substring is not found — so the large
-- function bodies are never re-typed (zero body-drift risk). See the DB for authoritative
-- bodies. Layaway payments (add_layaway_ledger_payment) already store mode_of_payment
-- verbatim (no whitelist), so Remittance works there with no change.

-- 1) Widen the payments.payment_method CHECK (preserve the full live set incl. 'Trade').
alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check
  check (
    payment_method is null
    or payment_method = any (array[
      'bank_transfer','e_wallet','cash','card','other',
      'Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade','Remittance'
    ])
  );

-- 2) Surgically widen the three active RPC whitelists.
do $mig$
declare d text; d0 text;
begin
  -- add_order_payment: also closes a latent gap — 'BDO NEW'/'BDO UNIBANK'/'Trade' were
  -- being collapsed to 'other' on an order payment. Now the full canonical set + Remittance.
  select pg_get_functiondef(oid) into d from pg_proc
    where proname = 'add_order_payment' and pronamespace = 'public'::regnamespace;
  d0 := d;
  d := replace(d,
    $old$'bank_transfer','e_wallet','cash','card','other','Cash','GCash','BPI','BDO','Credit Card'$old$,
    $new$'bank_transfer','e_wallet','cash','card','other','Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade','Remittance'$new$);
  if d = d0 then raise exception 'add_order_payment: whitelist substring not found'; end if;
  execute d;

  -- save_walkin_order: add Remittance to the existing full whitelist.
  select pg_get_functiondef(oid) into d from pg_proc
    where proname = 'save_walkin_order' and pronamespace = 'public'::regnamespace;
  d0 := d;
  d := replace(d,
    $old$'bank_transfer','e_wallet','cash','card','other','Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade'$old$,
    $new$'bank_transfer','e_wallet','cash','card','other','Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade','Remittance'$new$);
  if d = d0 then raise exception 'save_walkin_order: whitelist substring not found'; end if;
  execute d;

  -- create_walkin_order_multi (fully-paid Daily Cash walk-in): stop lowercasing +
  -- collapsing canonical methods to legacy/'other'; preserve them verbatim + add Remittance.
  select pg_get_functiondef(oid) into d from pg_proc
    where proname = 'create_walkin_order_multi' and pronamespace = 'public'::regnamespace;
  d0 := d;
  d := replace(d,
    $old$v_method := lower(coalesce(nullif(trim(p_payment_method), ''), 'cash'));$old$,
    $new$v_method := coalesce(nullif(trim(p_payment_method), ''), 'Cash');$new$);
  if d = d0 then raise exception 'create_walkin_order_multi: lower() line not found'; end if;
  d0 := d;
  d := replace(d,
    $old$'bank_transfer', 'e_wallet', 'cash', 'card', 'other'$old$,
    $new$'bank_transfer','e_wallet','cash','card','other','Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade','Remittance'$new$);
  if d = d0 then raise exception 'create_walkin_order_multi: whitelist substring not found'; end if;
  execute d;
end $mig$;
