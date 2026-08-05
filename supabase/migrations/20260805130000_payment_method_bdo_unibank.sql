-- Owner request: add "BDO UNIBANK" to the Mode of Payment choices everywhere,
-- alongside the existing options. Only the payments.payment_method CHECK constrains
-- the value; widen it to accept the new canonical option next to the existing
-- canonical + legacy sets (mirrors the 20260804130000 "BDO NEW" migration).
alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check
  check (
    payment_method is null
    or payment_method = any (array[
      'bank_transfer', 'e_wallet', 'cash', 'card', 'other',
      'Cash', 'GCash', 'BPI', 'BDO', 'BDO NEW', 'BDO UNIBANK', 'Credit Card'
    ])
  );
