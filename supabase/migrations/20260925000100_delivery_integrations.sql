-- Somente novas estruturas. Não altera records, AuthUser, estoque ou policies existentes.
begin;
create table public.delivery_integrations (
  platform text primary key check (platform in ('ifood','99food')),
  status text not null default 'disconnected' check (status in ('disconnected','connecting','connected','attention','error')),
  sealed_credentials text,
  last_sync_at timestamptz,
  last_error text,
  first_event_at timestamptz,
  last_event_at timestamptz,
  last_poll_at timestamptz,
  lock_owner uuid,
  lock_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.delivery_integrations(platform) values ('ifood'), ('99food');
create table public.delivery_merchants (
  platform text not null references public.delivery_integrations(platform),
  merchant_id text not null,
  name text,
  enabled boolean not null default true,
  primary key (platform, merchant_id)
);
create table public.delivery_events (
  platform text not null,
  merchant_id text not null,
  event_id text not null,
  envelope jsonb not null,
  received_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  primary key(platform, merchant_id, event_id),
  foreign key(platform, merchant_id) references public.delivery_merchants(platform, merchant_id)
);
create index delivery_pending_events on public.delivery_events(platform, received_at) where processed_at is null;
create table public.delivery_orders (
  platform text not null,
  merchant_id text not null,
  external_id text not null,
  ordered_at timestamptz not null,
  event_at timestamptz not null,
  status text not null,
  data jsonb not null,
  cash_movement_id text,
  reconciled_by uuid,
  reconciled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(platform, merchant_id, external_id),
  foreign key(platform, merchant_id) references public.delivery_merchants(platform, merchant_id)
);
create index delivery_order_period on public.delivery_orders(ordered_at);

alter table public.delivery_integrations enable row level security;
alter table public.delivery_merchants enable row level security;
alter table public.delivery_events enable row level security;
alter table public.delivery_orders enable row level security;
revoke all on public.delivery_integrations, public.delivery_merchants, public.delivery_events, public.delivery_orders from public, anon, authenticated;
grant all on public.delivery_integrations, public.delivery_merchants, public.delivery_events, public.delivery_orders to service_role;
-- Nenhuma policy anon/authenticated: acesso somente pelas Edge Functions verificadas.

create function public.delivery_lock(p_platform text, p_owner uuid) returns boolean
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update delivery_integrations set lock_owner = p_owner, lock_until = now() + interval '5 minutes'
  where platform = p_platform and (lock_until is null or lock_until < now());
  return found;
end $$;
create function public.delivery_unlock(p_platform text, p_owner uuid) returns void
language sql security invoker set search_path = public, pg_temp as $$
  update delivery_integrations set lock_owner = null, lock_until = null where platform = p_platform and lock_owner = p_owner;
$$;

create function public.delivery_enqueue(p_platform text, p_events jsonb) returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare e jsonb; old jsonb; added integer := 0;
begin
  for e in select value from jsonb_array_elements(p_events) loop
    if not exists(select 1 from delivery_merchants where platform = p_platform and merchant_id = e->>'merchantId' and enabled) then
      raise exception 'UNAUTHORIZED_MERCHANT';
    end if;
    insert into delivery_events(platform, merchant_id, event_id, envelope)
    values(p_platform, e->>'merchantId', e->>'id', e) on conflict do nothing;
    if found then added := added + 1;
    else
      select envelope into old from delivery_events where platform = p_platform and merchant_id = e->>'merchantId' and event_id = e->>'id';
      if old <> e then raise exception 'EVENT_ID_CONFLICT'; end if;
    end if;
  end loop;
  return added;
end $$;

create function public.delivery_apply_event(p_platform text, p_merchant text, p_event text, p_order jsonb) returns boolean
language plpgsql security invoker set search_path = public, pg_temp as $$
declare e delivery_events; previous delivery_orders; incoming_at timestamptz; apply_change boolean := true;
begin
  select * into e from delivery_events where platform = p_platform and merchant_id = p_merchant and event_id = p_event for update;
  if not found then raise exception 'EVENT_NOT_QUEUED'; end if;
  if e.processed_at is not null then return false; end if;
  if p_order->>'platform' <> p_platform or p_order->>'merchant_id' <> p_merchant or p_order->>'external_id' <> e.envelope->>'orderId'
    or p_order->>'event_id' <> p_event then raise exception 'EVENT_ORDER_MISMATCH'; end if;
  incoming_at := (p_order->>'event_at')::timestamptz;
  if incoming_at <> (e.envelope->>'createdAt')::timestamptz then raise exception 'EVENT_DATE_MISMATCH'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_platform || ':' || p_merchant || ':' || (p_order->>'external_id'), 0));
  select * into previous from delivery_orders where platform=p_platform and merchant_id=p_merchant and external_id=p_order->>'external_id';
  if found then
    apply_change := not (
      incoming_at < previous.event_at
      or (incoming_at = previous.event_at and p_order->>'status' <> 'cancelled')
      or (previous.status = 'cancelled' and p_order->>'status' <> 'cancelled')
      or (previous.status = 'concluded' and p_order->>'status' not in ('concluded','cancelled'))
    );
  end if;
  if apply_change then
    insert into delivery_orders(platform,merchant_id,external_id,ordered_at,event_at,status,data)
    values(p_platform,p_merchant,p_order->>'external_id',(p_order->>'ordered_at')::timestamptz,incoming_at,p_order->>'status',p_order)
    on conflict(platform,merchant_id,external_id) do update
      set event_at=excluded.event_at, status=excluded.status, data=excluded.data, updated_at=now();
  end if;
  update delivery_events set processed_at=now(), last_error=null where platform=p_platform and merchant_id=p_merchant and event_id=p_event;
  update delivery_integrations set first_event_at=least(first_event_at,incoming_at),last_event_at=greatest(last_event_at,incoming_at) where platform=p_platform;
  return apply_change;
end $$;
revoke all on function public.delivery_lock(text,uuid), public.delivery_unlock(text,uuid), public.delivery_enqueue(text,jsonb), public.delivery_apply_event(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.delivery_lock(text,uuid), public.delivery_unlock(text,uuid), public.delivery_enqueue(text,jsonb), public.delivery_apply_event(text,text,text,jsonb) to service_role;
commit;
