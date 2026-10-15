-- EcoScape Ops route ordering: each day's visits in driving order, starting from the
-- business's shop.
--
--   * Shop location. Each business saves its shop address; the app looks it up (U.S.
--     Census geocoder) and stores where it is, plus its city and state, which anchor
--     every customer lookup to the right area.
--   * Customer locations are cached on the customer: looked up once when the address is
--     saved, and reset to "pending" whenever the property address (or the shop) changes,
--     so a stale location is never used. A lookup that lands too far from the shop (or
--     outside the US) is "flagged" and never used for ordering. Only the owner (through
--     record_customer_geocode) can store a location.
--   * Routes. Each crew member has their own route per day, plus one for unassigned
--     visits. The suggested order (nearest stop first, from the shop) is worked out by the
--     app each time; route_days keeps only what people change: an order set with the
--     arrows, and a starting address for that one day.
--   * Access. Owners read and change any route in their business. Crew members get no
--     table access: crew_route / crew_route_settings return only their own route, and
--     they can reorder or restart only their own route. Nothing crosses businesses.

-- ---------------------------------------------------------------------------
-- Shop location
-- ---------------------------------------------------------------------------
create table public.shop_locations (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  -- As the owner typed it, and what the geocoder matched it to.
  address text not null,
  matched_address text not null,
  city text not null,
  state text not null,
  postal_code text not null default '',
  lat double precision not null,
  lon double precision not null,
  updated_at timestamptz not null default now(),

  constraint shop_locations_address_length check (char_length(btrim(address)) between 1 and 300),
  constraint shop_locations_matched_length check (char_length(matched_address) between 1 and 300),
  constraint shop_locations_city_length check (char_length(btrim(city)) between 1 and 100),
  constraint shop_locations_state_format check (state ~ '^[A-Z]{2}$'),
  constraint shop_locations_postal_code_format check (postal_code ~ '^([0-9]{5}(-[0-9]{4})?)?$'),
  constraint shop_locations_lat_range check (lat between -90 and 90),
  constraint shop_locations_lon_range check (lon between -180 and 180)
);

create trigger shop_locations_set_updated_at
  before update on public.shop_locations
  for each row execute function private.set_updated_at();

create trigger shop_locations_business_id_immutable
  before update on public.shop_locations
  for each row execute function private.prevent_business_id_change();

-- ---------------------------------------------------------------------------
-- Customer locations (cached)
-- ---------------------------------------------------------------------------
-- pending: not looked up yet (or the address or shop changed); located: found within
-- range of the shop; not_found: the geocoder couldn't find it; flagged: it matched
-- somewhere too far from the shop, or outside the US, so it isn't used.
create type public.geo_status as enum ('pending', 'located', 'not_found', 'flagged');

alter table public.customers
  add column geo_status public.geo_status not null default 'pending',
  add column geo_lat double precision,
  add column geo_lon double precision,
  -- What the geocoder matched (also kept for a flagged result, to show what went wrong).
  add column geo_matched_address text,
  -- Straight-line miles from the shop.
  add column geo_distance_miles numeric(8, 1),
  add column geocoded_at timestamptz,
  add constraint customers_geo_coords_together check ((geo_lat is null) = (geo_lon is null)),
  add constraint customers_geo_coords_only_when_located check ((geo_status = 'located') = (geo_lat is not null)),
  add constraint customers_geo_lat_range check (geo_lat between -90 and 90),
  add constraint customers_geo_lon_range check (geo_lon between -180 and 180),
  add constraint customers_geo_matched_length check (char_length(geo_matched_address) <= 300);

-- A new customer, or a changed property address, always starts over as "pending".
create function private.reset_customer_geocode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.property_address is distinct from old.property_address then
    new.geo_status := 'pending';
    new.geo_lat := null;
    new.geo_lon := null;
    new.geo_matched_address := null;
    new.geo_distance_miles := null;
    new.geocoded_at := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.reset_customer_geocode() from public;

create trigger customers_reset_geocode
  before insert or update on public.customers
  for each row execute function private.reset_customer_geocode();

-- Owners still add and edit customers directly, but only the customer's own fields: the
-- location columns are written only by record_customer_geocode.
revoke insert, update on public.customers from authenticated;
grant insert (
  id, business_id, first_name, last_name, phone, email, property_address, billing_address,
  access_instructions, service_notes, preferred_day, status, notification_preference,
  sms_opt_in, customer_since, created_at, updated_at
) on public.customers to authenticated;
grant update (
  business_id, first_name, last_name, phone, email, property_address, billing_address,
  access_instructions, service_notes, preferred_day, status, notification_preference,
  sms_opt_in, customer_since, updated_at
) on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- Routes: what people changed about one route on one day.
-- ---------------------------------------------------------------------------
create table public.route_days (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  route_date date not null,
  -- Whose route: a crew member (the owner is one too), or null for unassigned visits.
  crew_member_id uuid,
  -- A starting address for this day only (the shop's stays as it is).
  start_address text,
  start_matched_address text,
  start_lat double precision,
  start_lon double precision,
  -- The visits in the order someone set with the arrows; null means the suggested order.
  -- Visits added to the route later go after these.
  manual_order uuid[],
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),

  foreign key (crew_member_id, business_id) references public.crew_members (id, business_id) on delete cascade,
  constraint route_days_one_per_route unique nulls not distinct (business_id, route_date, crew_member_id),
  constraint route_days_start_together check (
    (start_address is null) = (start_lat is null)
    and (start_lat is null) = (start_lon is null)
    and (start_lat is null) = (start_matched_address is null)
  ),
  constraint route_days_start_length check (char_length(start_address) between 1 and 300 and char_length(start_matched_address) <= 300),
  constraint route_days_start_lat_range check (start_lat between -90 and 90),
  constraint route_days_start_lon_range check (start_lon between -180 and 180),
  constraint route_days_manual_order_size check (cardinality(manual_order) between 1 and 200)
);

create index route_days_business_date_idx on public.route_days (business_id, route_date);

create trigger route_days_set_updated_at
  before update on public.route_days
  for each row execute function private.set_updated_at();

create trigger route_days_business_id_immutable
  before update on public.route_days
  for each row execute function private.prevent_business_id_change();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security: owners read; functions write.
-- ---------------------------------------------------------------------------
revoke all on public.shop_locations, public.route_days from anon, authenticated;
grant select on public.shop_locations, public.route_days to authenticated;

alter table public.shop_locations enable row level security;
alter table public.route_days enable row level security;

create policy "Owners can view their shop location"
  on public.shop_locations for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their routes"
  on public.route_days for select to authenticated
  using (business_id in (select private.owner_business_ids()));

-- ---------------------------------------------------------------------------
-- Owner functions: shop location and customer locations
-- ---------------------------------------------------------------------------

-- Saves the shop location (looked up by the app). Moving the shop sends every customer
-- back to "pending": their lookups were anchored to the old shop's town, and their
-- distance from the shop has changed.
create function public.set_shop_location(
  address text,
  matched_address text,
  city text,
  state text,
  postal_code text,
  lat double precision,
  lon double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  old public.shop_locations;
begin
  select * into old from public.shop_locations s where s.business_id = biz;

  insert into public.shop_locations (business_id, address, matched_address, city, state, postal_code, lat, lon)
  values (
    biz, btrim(set_shop_location.address), btrim(set_shop_location.matched_address), btrim(set_shop_location.city),
    upper(btrim(set_shop_location.state)), btrim(coalesce(set_shop_location.postal_code, '')),
    set_shop_location.lat, set_shop_location.lon
  )
  on conflict (business_id) do update set
    address = excluded.address,
    matched_address = excluded.matched_address,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    lat = excluded.lat,
    lon = excluded.lon;

  if old.business_id is null or old.lat <> set_shop_location.lat or old.lon <> set_shop_location.lon
     or old.city <> btrim(set_shop_location.city) or old.state <> upper(btrim(set_shop_location.state)) then
    update public.customers c
    set geo_status = 'pending', geo_lat = null, geo_lon = null, geo_matched_address = null,
        geo_distance_miles = null, geocoded_at = null
    where c.business_id = biz and c.geo_status <> 'pending';
  end if;
end;
$$;

-- Stores the result of looking up one customer's property address. Ignored (returns
-- false) if the address has changed since it was looked up, or the customer isn't the
-- caller's.
create function public.record_customer_geocode(
  customer_id uuid,
  address text,
  status public.geo_status,
  lat double precision,
  lon double precision,
  matched_address text,
  distance_miles numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  if record_customer_geocode.status is null or record_customer_geocode.status = 'pending' then
    raise exception 'A lookup result is needed' using errcode = '22023';
  end if;
  if (record_customer_geocode.status = 'located') <> (record_customer_geocode.lat is not null and record_customer_geocode.lon is not null) then
    raise exception 'Only a located address has a position' using errcode = '22023';
  end if;

  update public.customers c
  set geo_status = record_customer_geocode.status,
      geo_lat = case when record_customer_geocode.status = 'located' then record_customer_geocode.lat end,
      geo_lon = case when record_customer_geocode.status = 'located' then record_customer_geocode.lon end,
      geo_matched_address = left(nullif(btrim(record_customer_geocode.matched_address), ''), 300),
      geo_distance_miles = round(record_customer_geocode.distance_miles, 1),
      geocoded_at = now()
  where c.id = record_customer_geocode.customer_id
    and c.business_id = biz
    and c.property_address = record_customer_geocode.address;
  return found;
end;
$$;

revoke execute on function public.set_shop_location(text, text, text, text, text, double precision, double precision) from public, anon;
revoke execute on function public.record_customer_geocode(uuid, text, public.geo_status, double precision, double precision, text, numeric) from public, anon;
grant execute on function public.set_shop_location(text, text, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.record_customer_geocode(uuid, text, public.geo_status, double precision, double precision, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Route functions (owner: any route in their business; crew: only their own)
-- ---------------------------------------------------------------------------

-- The caller's business, if they may change the given route; otherwise an error.
create function private.route_business(p_crew_member_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid;
  caller_role public.business_role;
begin
  select m.business_id, m.role into biz, caller_role
  from public.business_members m
  where m.user_id = (select auth.uid());
  if biz is null then
    raise exception 'Not a member of a business' using errcode = '42501';
  end if;

  if caller_role = 'owner' then
    if p_crew_member_id is not null and not exists (
      select 1 from public.crew_members c where c.id = p_crew_member_id and c.business_id = biz
    ) then
      raise exception 'Crew member not found' using errcode = 'P0002';
    end if;
    return biz;
  end if;

  if p_crew_member_id is null or p_crew_member_id is distinct from private.my_crew_member_id() then
    raise exception 'You can only change your own route' using errcode = '42501';
  end if;
  return biz;
end;
$$;

revoke execute on function private.route_business(uuid) from public;

-- Saves the order set with the arrows. Every visit must be on that route that day (the
-- route's crew member, not cancelled); visits not listed (added later) go after these.
create function public.set_route_order(route_date date, crew_member_id uuid, job_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.route_business(set_route_order.crew_member_id);
  wanted int := cardinality(set_route_order.job_ids);
begin
  if set_route_order.route_date is null or wanted is null or wanted = 0 or wanted > 200 then
    raise exception 'Choose the visits to put in order' using errcode = '22023';
  end if;
  if array_position(set_route_order.job_ids, null) is not null
     or (select count(distinct v) from unnest(set_route_order.job_ids) v) <> wanted then
    raise exception 'Each visit can only be in the route once' using errcode = '22023';
  end if;
  if (
    select count(*) from public.jobs j
    where j.id = any (set_route_order.job_ids)
      and j.business_id = biz
      and j.scheduled_date = set_route_order.route_date
      and j.assigned_crew_member_id is not distinct from set_route_order.crew_member_id
      and j.status <> 'cancelled'
  ) <> wanted then
    raise exception 'Those visits aren''t all on this route' using errcode = '22023';
  end if;

  insert into public.route_days (business_id, route_date, crew_member_id, manual_order, updated_by)
  values (biz, set_route_order.route_date, set_route_order.crew_member_id, set_route_order.job_ids, (select auth.uid()))
  on conflict on constraint route_days_one_per_route do update
    set manual_order = excluded.manual_order, updated_by = excluded.updated_by;
end;
$$;

-- Goes back to the suggested order.
create function public.reset_route_order(route_date date, crew_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.route_business(reset_route_order.crew_member_id);
begin
  update public.route_days r
  set manual_order = null, updated_by = (select auth.uid())
  where r.business_id = biz and r.route_date = reset_route_order.route_date
    and r.crew_member_id is not distinct from reset_route_order.crew_member_id;
end;
$$;

-- Sets (or, with a null address, clears) a starting address for this route on this day
-- only. The shop location doesn't change.
create function public.set_route_start(
  route_date date,
  crew_member_id uuid,
  address text,
  matched_address text,
  lat double precision,
  lon double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.route_business(set_route_start.crew_member_id);
  clearing boolean := nullif(btrim(coalesce(set_route_start.address, '')), '') is null;
begin
  if set_route_start.route_date is null then
    raise exception 'Choose a day' using errcode = '22023';
  end if;
  if not clearing and (set_route_start.lat is null or set_route_start.lon is null or nullif(btrim(coalesce(set_route_start.matched_address, '')), '') is null) then
    raise exception 'A starting address needs a position' using errcode = '22023';
  end if;

  insert into public.route_days (business_id, route_date, crew_member_id, start_address, start_matched_address, start_lat, start_lon, updated_by)
  values (
    biz, set_route_start.route_date, set_route_start.crew_member_id,
    case when clearing then null else btrim(set_route_start.address) end,
    case when clearing then null else btrim(set_route_start.matched_address) end,
    case when clearing then null else set_route_start.lat end,
    case when clearing then null else set_route_start.lon end,
    (select auth.uid())
  )
  on conflict on constraint route_days_one_per_route do update
    set start_address = excluded.start_address,
        start_matched_address = excluded.start_matched_address,
        start_lat = excluded.start_lat,
        start_lon = excluded.start_lon,
        updated_by = excluded.updated_by;
end;
$$;

revoke execute on function public.set_route_order(date, uuid, uuid[]) from public, anon;
revoke execute on function public.reset_route_order(date, uuid) from public, anon;
revoke execute on function public.set_route_start(date, uuid, text, text, double precision, double precision) from public, anon;
grant execute on function public.set_route_order(date, uuid, uuid[]) to authenticated;
grant execute on function public.reset_route_order(date, uuid) to authenticated;
grant execute on function public.set_route_start(date, uuid, text, text, double precision, double precision) to authenticated;

-- ---------------------------------------------------------------------------
-- A crew member's own route (no prices, nothing of anyone else's)
-- ---------------------------------------------------------------------------

-- The caller's visits on one day (not cancelled), with where each customer is.
create function public.crew_route(route_date date)
returns table (
  id uuid,
  scheduled_date date,
  status public.job_status,
  service_name text,
  notes text,
  customer_first_name text,
  customer_last_name text,
  customer_phone text,
  customer_email text,
  property_address text,
  access_instructions text,
  service_notes text,
  geo_status public.geo_status,
  geo_lat double precision,
  geo_lon double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.scheduled_date, j.status, j.service_name, j.notes,
         c.first_name, c.last_name, c.phone, c.email,
         c.property_address, c.access_instructions, c.service_notes,
         c.geo_status, c.geo_lat, c.geo_lon
  from public.jobs j
  join public.customers c on c.id = j.customer_id and c.business_id = j.business_id
  where j.assigned_crew_member_id = private.my_crew_member_id()
    and j.scheduled_date = crew_route.route_date
    and j.status <> 'cancelled'
  order by j.created_at, j.id;
$$;

-- The caller's route settings for one day, and the shop it starts from by default.
-- Always one row (blank where nothing is set) for a crew member; none for anyone else.
create function public.crew_route_settings(route_date date)
returns table (
  crew_member_id uuid,
  start_address text,
  start_matched_address text,
  start_lat double precision,
  start_lon double precision,
  manual_order uuid[],
  shop_address text,
  shop_city text,
  shop_state text,
  shop_lat double precision,
  shop_lon double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select me.id, r.start_address, r.start_matched_address, r.start_lat, r.start_lon, r.manual_order,
         s.address, s.city, s.state, s.lat, s.lon
  from public.crew_members me
  left join public.route_days r
    on r.business_id = me.business_id and r.crew_member_id = me.id and r.route_date = crew_route_settings.route_date
  left join public.shop_locations s on s.business_id = me.business_id
  where me.user_id = (select auth.uid());
$$;

revoke execute on function public.crew_route(date) from public, anon;
revoke execute on function public.crew_route_settings(date) from public, anon;
grant execute on function public.crew_route(date) to authenticated;
grant execute on function public.crew_route_settings(date) to authenticated;
