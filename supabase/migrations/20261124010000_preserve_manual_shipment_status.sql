begin;

-- NULL on historical rows means no override has been recorded.
alter table public.regis_parts_orders add column shipment_status_manual boolean;

create function public.regis_ship_on_first_tracking() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.shipment_status = 'awaiting_shipment'
     and new.shipment_status_manual is not true
     and nullif(btrim(new.tracking_number), '') is not null then
    if tg_op = 'INSERT' then
      new.shipment_status := 'shipped';
    elsif nullif(btrim(old.tracking_number), '') is null then
      new.shipment_status := 'shipped';
    end if;
  end if;
  return new;
end;
$$;

create trigger regis_ship_on_first_tracking
before insert or update of tracking_number on public.regis_parts_orders
for each row execute function public.regis_ship_on_first_tracking();

commit;
