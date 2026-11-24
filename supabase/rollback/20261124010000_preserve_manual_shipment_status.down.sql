begin;
drop trigger regis_ship_on_first_tracking on public.regis_parts_orders;
drop function public.regis_ship_on_first_tracking();
alter table public.regis_parts_orders drop column shipment_status_manual;
commit;
