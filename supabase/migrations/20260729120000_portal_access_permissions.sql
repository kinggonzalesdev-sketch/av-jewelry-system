-- Portal & Access permission catalogue (Owner request).
--
-- Mirrors what was applied to production. The TypeScript catalogue in
-- src/lib/authz/permissions.ts and this seed must not drift apart — a test
-- asserts every key here exists in both.
--
-- These 21 keys back the Manage Access screen's five groups. Page keys gate the
-- ROUTE (a member without one cannot open it, by URL either); the rest gate a
-- specific action. A Super Admin (owner) holds every permission implicitly.

insert into public.permissions (key, label, description, is_request_only) values
  -- Main System (page access)
  ('nav_dashboard',       'Dashboard',                 'See the Dashboard.', false),
  ('nav_orders',          'Orders',                    'See the Orders workspace.', false),
  ('nav_customers',       'Customers',                 'See the Customers workspace.', false),
  ('nav_inventory',       'Inventory',                 'See the Inventory workspace.', false),
  ('nav_payments',        'Payments',                  'See the Payments workspace.', false),
  ('nav_layaway',         'Layaway',                   'See the Layaway workspace.', false),
  ('nav_scrap',           'Scrap',                     'See the Scrap workspace.', false),
  -- Orders and Fulfillment
  ('order_add_deposit',   'Add Down Payment / Deposit','Record a down payment or deposit on an order.', false),
  ('order_cancel',        'Cancel Order',              'Request an order cancellation.', false),
  ('fulfillment_delivery','Delivery',                  'Handle delivery fulfillment.', false),
  ('fulfillment_shipping','Shipping',                  'Handle shipping fulfillment.', false),
  ('fulfillment_pickup',  'Pickup',                    'Handle pickup fulfillment.', false),
  -- Records Management
  ('customer_edit',       'Edit Customer',             'Edit customer details.', false),
  ('customer_delete',     'Delete Customer',           'Permanently delete a customer.', false),
  ('inventory_edit',      'Edit Inventory',            'Edit inventory item details.', false),
  ('inventory_delete',    'Delete Inventory',          'Permanently delete an inventory item.', false),
  -- Team Management
  ('hr_attendance',       'Attendance',                'Use the Attendance kiosk / records.', false),
  ('hr_review_attendance','Review Attendance',         'Review and correct attendance records.', false),
  ('hr_payroll',          'Payroll',                   'View and process payroll.', false),
  -- System
  ('view_reports',        'Reports',                   'See the Reports workspace.', false),
  ('view_settings',       'Settings',                  'See the Settings workspace.', false)
on conflict (key) do nothing;
