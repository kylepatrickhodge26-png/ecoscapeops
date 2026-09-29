-- EcoScape Ops weather: a live forecast for each business's service area, a rain-day
-- action that moves a day's visits, and a personalized text for each affected customer
-- who has opted in to texts. The owner sends each text from their own phone (the app
-- opens it, filled in, in their Messages app), so there's no texting service to pay for.
--
--   * service_areas: where the business works (a ZIP code the app turns into a map
--     position for the forecast). Owners manage it; crew members can read it only
--     through business_service_area(), for the forecast on their dashboard.
--   * rain_delays / rain_delay_visits: one "move a day's jobs" action and the visits it
--     moved. Texts are prepared per rain delay.
--   * weather_texts: which customers' texts the owner has opened for a rain delay, so
--     they can keep track of who they've texted.
--   * Who gets a text is decided here, never by the browser: customers of the caller's
--     own business who have a visit in that rain delay, sms_opt_in = true, and a phone
--     number that is a usable mobile number. Nobody else gets a message or a button.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's business, if they own one; otherwise an error.
create function private.my_owned_business()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid;
begin
  select m.business_id into biz
  from public.business_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner';
  if biz is null then
    raise exception 'Only the business owner can do this' using errcode = '42501';
  end if;
  return biz;
end;
$$;

revoke execute on function private.my_owned_business() from public;

-- A phone number as typed on a customer record, in the +15551234567 form a text link needs,
-- or null if it can't be a mobile number. US/Canada numbers may be written any way
-- ("(631) 555-0142", "1-631-555-0142"); other countries need a leading +.
create function private.to_e164(phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(coalesce(phone, '')) like '+%' then
      case when s.d ~ '^[1-9][0-9]{7,14}$' then '+' || s.d end
    when s.d ~ '^[2-9][0-9]{9}$' then '+1' || s.d
    when s.d ~ '^1[2-9][0-9]{9}$' then '+' || s.d
  end
  from (select regexp_replace(coalesce(phone, ''), '\D', '', 'g') as d) s;
$$;

revoke execute on function private.to_e164(text) from public;

-- The text a customer gets for a rain delay. Kept short, in plain characters (no curly
-- quotes or dashes), so it usually fits in a single 160-character SMS segment:
-- "Hi Jane, this is Acme Lawn Care. Due to the weather, we're moving your Tue, Sep 29
-- visit to Wed, Sep 30. Thanks! Reply STOP to opt out."
create function private.rain_delay_message(first_name text, business_name text, from_date date, to_date date)
returns text
language sql
stable
set search_path = ''
as $$
  select 'Hi' || coalesce(nullif(' ' || btrim(first_name), ' '), '') || ', this is ' || btrim(business_name) || '. '
    || 'Due to the weather, we''re moving your ' || to_char(from_date, 'Dy, Mon FMDD')
    || ' visit to ' || to_char(to_date, 'Dy, Mon FMDD') || '. '
    || 'Thanks! Reply STOP to opt out.';
$$;

revoke execute on function private.rain_delay_message(text, text, date, date) from public;

-- ---------------------------------------------------------------------------
-- Service area
-- ---------------------------------------------------------------------------
create table public.service_areas (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  postal_code text not null,
  place_name text not null,
  latitude numeric(8, 5) not null,
  longitude numeric(8, 5) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint service_areas_postal_code_format check (postal_code ~ '^[0-9]{5}$'),
  constraint service_areas_place_name_length check (char_length(btrim(place_name)) between 1 and 100),
  constraint service_areas_latitude_range check (latitude between -90 and 90),
  constraint service_areas_longitude_range check (longitude between -180 and 180)
);

create trigger service_areas_set_updated_at
  before update on public.service_areas
  for each row execute function private.set_updated_at();

create trigger service_areas_business_id_immutable
  before update on public.service_areas
  for each row execute function private.prevent_business_id_change();

revoke all on public.service_areas from anon, authenticated;
grant select, delete on public.service_areas to authenticated;
grant insert (business_id, postal_code, place_name, latitude, longitude) on public.service_areas to authenticated;
-- business_id is listed only so an upsert (insert … on conflict update) works; the
-- trigger above stops it from ever changing.
grant update (business_id, postal_code, place_name, latitude, longitude) on public.service_areas to authenticated;

alter table public.service_areas enable row level security;

create policy "Owners can view their service area"
  on public.service_areas for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can set their service area"
  on public.service_areas for insert
  to authenticated
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can change their service area"
  on public.service_areas for update
  to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can remove their service area"
  on public.service_areas for delete
  to authenticated
  using (business_id in (select private.owner_business_ids()));

-- Everyone in the business (crew included) can read where the forecast is for.
create function public.business_service_area()
returns table (postal_code text, place_name text, latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select a.postal_code, a.place_name, a.latitude, a.longitude
  from public.service_areas a
  where a.business_id in (select private.member_business_ids());
$$;

revoke execute on function public.business_service_area() from public, anon;
grant execute on function public.business_service_area() to authenticated;

-- ---------------------------------------------------------------------------
-- Rain delays: "move a day's jobs"
-- ---------------------------------------------------------------------------
-- Lets rain_delay_visits reference (job, business) pairs.
alter table public.jobs add constraint jobs_id_business_unique unique (id, business_id);

create table public.rain_delays (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint rain_delays_id_business_unique unique (id, business_id),
  constraint rain_delays_dates_differ check (from_date <> to_date)
);

create index rain_delays_business_idx on public.rain_delays (business_id, created_at desc);

create trigger rain_delays_business_id_immutable
  before update on public.rain_delays
  for each row execute function private.prevent_business_id_change();

-- The visits a rain delay moved. If a visit is later deleted, it drops out of here.
create table public.rain_delay_visits (
  rain_delay_id uuid not null,
  job_id uuid not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  primary key (rain_delay_id, job_id),
  foreign key (rain_delay_id, business_id) references public.rain_delays (id, business_id) on delete cascade,
  foreign key (job_id, business_id) references public.jobs (id, business_id) on delete cascade
);

create index rain_delay_visits_job_idx on public.rain_delay_visits (job_id);

create trigger rain_delay_visits_business_id_immutable
  before update on public.rain_delay_visits
  for each row execute function private.prevent_business_id_change();

-- Moves every visit on from_date that isn't completed or cancelled to to_date, marks it
-- weather-delayed (with a note), and records the move. Both dates must be today or
-- later where the business is. Returns the new rain delay's id.
create function public.move_day_visits(from_date date, to_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  business_today date;
  delay_id uuid;
  note_line text;
  moved integer;
begin
  if move_day_visits.from_date is null or move_day_visits.to_date is null then
    raise exception 'Choose both dates' using errcode = '22023';
  end if;
  if move_day_visits.from_date = move_day_visits.to_date then
    raise exception 'Choose two different dates' using errcode = '22023';
  end if;
  select (now() at time zone b.time_zone)::date into business_today from public.businesses b where b.id = biz;
  if move_day_visits.from_date < business_today or move_day_visits.to_date < business_today then
    raise exception 'Dates can''t be before today' using errcode = '22023';
  end if;

  insert into public.rain_delays (business_id, from_date, to_date, created_by)
  values (biz, move_day_visits.from_date, move_day_visits.to_date, (select auth.uid()))
  returning id into delay_id;

  note_line := 'Moved from ' || to_char(move_day_visits.from_date, 'Dy, Mon FMDD') || ' due to weather';

  with moved_jobs as (
    update public.jobs j
    set scheduled_date = move_day_visits.to_date,
        status = 'weather_delay',
        notes = case when btrim(j.notes) = '' then note_line else btrim(j.notes) || E'\n' || note_line end
    where j.business_id = biz
      and j.scheduled_date = move_day_visits.from_date
      and j.status not in ('completed', 'cancelled')
    returning j.id
  )
  insert into public.rain_delay_visits (rain_delay_id, job_id, business_id)
  select delay_id, mj.id, biz from moved_jobs mj;
  get diagnostics moved = row_count;

  if moved = 0 then
    -- Rolls back the rain delay inserted above.
    raise exception 'There are no visits to move on that day' using errcode = 'P0002';
  end if;

  return delay_id;
end;
$$;

revoke execute on function public.move_day_visits(date, date) from public, anon;
grant execute on function public.move_day_visits(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Weather texts
-- ---------------------------------------------------------------------------
-- One row per customer per rain delay, once the owner has opened that customer's text.
create table public.weather_texts (
  rain_delay_id uuid not null,
  customer_id uuid not null,
  business_id uuid not null references public.businesses (id) on delete cascade,
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  primary key (rain_delay_id, customer_id),
  foreign key (rain_delay_id, business_id) references public.rain_delays (id, business_id) on delete cascade,
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade
);

create trigger weather_texts_business_id_immutable
  before update on public.weather_texts
  for each row execute function private.prevent_business_id_change();

-- Rain delays, their visits, and weather texts: owners read them; only the functions in
-- this file write them.
revoke all on public.rain_delays, public.rain_delay_visits, public.weather_texts from anon, authenticated;
grant select on public.rain_delays, public.rain_delay_visits, public.weather_texts to authenticated;

alter table public.rain_delays enable row level security;
alter table public.rain_delay_visits enable row level security;
alter table public.weather_texts enable row level security;

create policy "Owners can view their rain delays"
  on public.rain_delays for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their rain delay visits"
  on public.rain_delay_visits for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their weather texts"
  on public.weather_texts for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

-- The customers a rain delay affects: for each one, the text they should get (and when
-- the owner opened it), or why they won't be texted.
create function public.rain_delay_texts(rain_delay_id uuid)
returns table (
  customer_id uuid,
  first_name text,
  last_name text,
  phone text,
  to_phone text,
  can_text boolean,
  -- Why a customer won't be texted: 'not_opted_in' or 'no_mobile_number'.
  reason text,
  body text,
  opened_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  delay public.rain_delays;
  business_name text;
begin
  select * into delay
  from public.rain_delays d
  where d.id = rain_delay_texts.rain_delay_id and d.business_id = biz;
  if not found then
    raise exception 'Rain delay not found' using errcode = 'P0002';
  end if;
  select b.name into business_name from public.businesses b where b.id = biz;

  return query
  with affected as (
    select distinct j.customer_id as id
    from public.rain_delay_visits v
    join public.jobs j on j.id = v.job_id and j.business_id = v.business_id
    where v.rain_delay_id = delay.id
  ),
  checked as (
    select c.*, private.to_e164(c.phone) as e164
    from affected a
    join public.customers c on c.id = a.id and c.business_id = biz
  )
  select c.id, c.first_name, c.last_name, c.phone, c.e164,
         c.sms_opt_in and c.e164 is not null,
         case
           when not c.sms_opt_in then 'not_opted_in'
           when c.e164 is null then 'no_mobile_number'
         end,
         case when c.sms_opt_in and c.e164 is not null
           then private.rain_delay_message(c.first_name, business_name, delay.from_date, delay.to_date)
         end,
         t.opened_at
  from checked c
  left join public.weather_texts t on t.rain_delay_id = delay.id and t.customer_id = c.id
  order by c.last_name, c.first_name, c.id;
end;
$$;

revoke execute on function public.rain_delay_texts(uuid) from public, anon;
grant execute on function public.rain_delay_texts(uuid) to authenticated;

-- Records that the owner opened a customer's text for a rain delay. Only for a customer
-- who can be texted (opted in, usable number, with a visit in this rain delay); anything
-- else is refused. Opening it again keeps the first time. Returns when it was opened.
create function public.mark_weather_text_opened(rain_delay_id uuid, customer_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  opened timestamptz;
begin
  if not exists (
    select 1 from public.rain_delays d
    where d.id = mark_weather_text_opened.rain_delay_id and d.business_id = biz
  ) then
    raise exception 'Rain delay not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.rain_delay_visits v
    join public.jobs j on j.id = v.job_id and j.business_id = v.business_id
    join public.customers c on c.id = j.customer_id and c.business_id = j.business_id
    where v.rain_delay_id = mark_weather_text_opened.rain_delay_id
      and v.business_id = biz
      and c.id = mark_weather_text_opened.customer_id
      and c.sms_opt_in
      and private.to_e164(c.phone) is not null
  ) then
    raise exception 'This customer can''t be texted' using errcode = '42501';
  end if;

  insert into public.weather_texts (rain_delay_id, customer_id, business_id, opened_by)
  values (mark_weather_text_opened.rain_delay_id, mark_weather_text_opened.customer_id, biz, (select auth.uid()))
  on conflict on constraint weather_texts_pkey do nothing;

  select t.opened_at into opened
  from public.weather_texts t
  where t.rain_delay_id = mark_weather_text_opened.rain_delay_id
    and t.customer_id = mark_weather_text_opened.customer_id;
  return opened;
end;
$$;

revoke execute on function public.mark_weather_text_opened(uuid, uuid) from public, anon;
grant execute on function public.mark_weather_text_opened(uuid, uuid) to authenticated;
