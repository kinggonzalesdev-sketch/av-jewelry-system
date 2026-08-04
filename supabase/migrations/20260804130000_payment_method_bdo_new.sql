-- Owner request: add "BDO NEW" to the Mode of Payment choices everywhere. Only the
-- payments.payment_method CHECK constrains the value; widen it to accept the new
-- canonical option alongside the existing canonical + legacy sets.
alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check
  check (
    payment_method is null
    or payment_method = any (array[
      'bank_transfer', 'e_wallet', 'cash', 'card', 'other',
      'Cash', 'GCash', 'BPI', 'BDO', 'BDO NEW', 'Credit Card'
    ])
  );
