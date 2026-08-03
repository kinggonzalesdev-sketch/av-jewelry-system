-- Standardize Mode of Payment (Owner request): the five canonical values
-- Cash / GCash / BPI / BDO / Credit Card become first-class, WITHOUT breaking any
-- historical record that still holds the legacy machine keys. The CHECK accepts
-- both sets; cash attribution is matched case-insensitively; and the two money
-- RPCs pass a recognized method through verbatim instead of collapsing it.
-- (Full RPC bodies live in the applied migration on the database; this file records
--  the constraint changes and the method-coercion intent for repo history.)

alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check
  check (
    payment_method is null
    or payment_method = any (array[
      'bank_transfer','e_wallet','cash','card','other',
      'Cash','GCash','BPI','BDO','Credit Card'
    ])
  );

alter table public.payments drop constraint if exists payments_cash_attribution_ck;
alter table public.payments add constraint payments_cash_attribution_ck
  check (
    lower(coalesce(payment_method, '')) <> 'cash'
    or (received_by is not null and reference_number is not null)
  );

-- add_order_payment and save_walkin_order were updated (CREATE OR REPLACE) so that
-- a recognized method (canonical OR legacy) is stored verbatim instead of being
-- lowercased and collapsed to 'other', and the cash-reference default is matched
-- case-insensitively (lower(v_method) = 'cash'). See the database for the current
-- authoritative function bodies.
