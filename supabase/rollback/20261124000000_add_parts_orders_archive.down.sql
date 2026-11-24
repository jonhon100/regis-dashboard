drop index if exists public.regis_parts_orders_user_archived_idx;

alter table public.regis_parts_orders
  drop column if exists archived_at;
