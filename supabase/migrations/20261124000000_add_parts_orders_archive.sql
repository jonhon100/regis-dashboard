-- Development-only archive support for REGIS HUB Parts Orders.
-- Existing rows remain active because archived_at defaults to null.
alter table public.regis_parts_orders
  add column if not exists archived_at timestamptz;

create index if not exists regis_parts_orders_user_archived_idx
  on public.regis_parts_orders (user_id, archived_at, created_at desc);
