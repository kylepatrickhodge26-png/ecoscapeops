-- EcoScape Ops weather: a live forecast for each business's service area, a rain-day
-- action that moves a day's visits, and real text messages (sent through Twilio) that
-- tell the affected customers. Only customers who opted in to texts are ever texted.
--
--   * service_areas: where the business works (a ZIP code the app turns into a map
--     position for the forecast). Owners manage it; crew members can read it only
--     through business_service_area(), for the forecast on their dashboard.
--   * sms_senders: the Twilio number each business texts from. Numbers are assigned by
--     whoever runs EcoScape Ops (service role / SQL editor), never through the app:
--     owners can see their number but can't set or change it, so no business can ever
--     text from another business's number.
--   * rain_delays / rain_delay_visits: one "move a day's jobs" action and the visits it
--     moved. Texts are sent per rain delay.
--   * sms_messages: every text sent, at most one per customer per rain delay (so a
--     double tap never texts anyone twice), with its Twilio delivery status.
--   * Who gets a text is decided here, at send time, never by the browser: customers of
--     the caller's own business who have a visit in that rain delay, sms_opt_in = true,
--     and a phone number that is a usable mobile number.
--   * Replies of STOP (and Twilio's "unsubscribed" error) turn sms_opt_in off, for that
--     business's customer only.

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

-- A phone number as typed on a customer record, in the +15551234567 form Twilio needs,
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
-- Texting numbers (one per business, assigned by the operator)
-- ---------------------------------------------------------------------------
create table public.sms_senders (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  -- A number in the operator's Twilio account, e.g. +16315550100. Unique, so two
  -- businesses can never share a number (or each other's STOP replies).
  phone_number text not null unique,
  created_at timestamptz not null default now(),

  constraint sms_senders_phone_number_format check (phone_number ~ '^\+[1-9][0-9]{7,14}$')
);

create trigger sms_senders_business_id_immutable
  before update on public.sms_senders
  for each row execute function private.prevent_business_id_change();

-- Read-only for owners. No insert/update/delete grants: only the service role writes.
revoke all on public.sms_senders from anon, authenticated;
grant select on public.sms_senders to authenticated;

alter table public.sms_senders enable row level security;

create policy "Owners can view their texting number"
  on public.sms_senders for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

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
-- Text messages
-- ---------------------------------------------------------------------------
-- sending: claimed, being handed to Twilio. Then Twilio's own statuses.
create type public.sms_status as enum ('sending', 'queued', 'sent', 'delivered', 'undelivered', 'failed');

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  rain_delay_id uuid not null,
  -- Kept (without the customer) if the customer is deleted later.
  customer_id uuid,
  to_phone text not null,
  from_phone text not null,
  body text not null,
  status public.sms_status not null default 'sending',
  twilio_sid text unique,
  error_code integer,
  error_message text,
  sent_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (rain_delay_id, business_id) references public.rain_delays (id, business_id) on delete cascade,
  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete set null (customer_id),
  constraint sms_messages_one_per_customer unique (rain_delay_id, customer_id)
);

create index sms_messages_business_idx on public.sms_messages (business_id, created_at desc);

create trigger sms_messages_set_updated_at
  before update on public.sms_messages
  for each row execute function private.set_updated_at();

create trigger sms_messages_business_id_immutable
  before update on public.sms_messages
  for each row execute function private.prevent_business_id_change();

-- Twilio's message statuses, collapsed into ours.
create function private.sms_status_from_twilio(twilio_status text)
returns public.sms_status
language sql
immutable
set search_path = ''
as $$
  select (case lower(coalesce(twilio_status, ''))
    when 'sent' then 'sent'
    when 'delivered' then 'delivered'
    when 'read' then 'delivered'
    when 'undelivered' then 'undelivered'
    when 'failed' then 'failed'
    when 'canceled' then 'failed'
    else 'queued' -- accepted, scheduled, queued, sending
  end)::public.sms_status;
$$;

revoke execute on function private.sms_status_from_twilio(text) from public;

-- Status updates can arrive out of order; a message only ever moves forward.
create function private.sms_status_rank(status public.sms_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case status when 'sending' then 0 when 'queued' then 1 when 'sent' then 2 else 3 end;
$$;

revoke execute on function private.sms_status_rank(public.sms_status) from public;

-- Twilio error 21610: the recipient has replied STOP to this number.
create function private.opt_out_after_sms_error(msg public.sms_messages)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.customers c
  set sms_opt_in = false
  where msg.error_code = 21610
    and c.id = msg.customer_id
    and c.business_id = msg.business_id
    and c.sms_opt_in;
$$;

revoke execute on function private.opt_out_after_sms_error(public.sms_messages) from public;

-- Owners read their business's texts. Nobody writes them directly: only the functions
-- below (and the service role, for Twilio's callbacks).
revoke all on public.sms_messages from anon, authenticated;
grant select on public.sms_messages to authenticated;

alter table public.sms_messages enable row level security;

create policy "Owners can view their texts"
  on public.sms_messages for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

-- Rain delays and their visits: owners read them; the functions write them.
revoke all on public.rain_delays, public.rain_delay_visits from anon, authenticated;
grant select on public.rain_delays, public.rain_delay_visits to authenticated;

alter table public.rain_delays enable row level security;
alter table public.rain_delay_visits enable row level security;

create policy "Owners can view their rain delays"
  on public.rain_delays for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their rain delay visits"
  on public.rain_delay_visits for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

-- The customers a rain delay affects, and for each one either the text they got (and
-- its status), the text they would get, or why they won't be texted.
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
  message_id uuid,
  status public.sms_status,
  error_code integer,
  error_message text,
  sent_at timestamptz
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
  )
  select c.id, c.first_name, c.last_name, c.phone,
         private.to_e164(c.phone),
         c.sms_opt_in and private.to_e164(c.phone) is not null,
         case
           when not c.sms_opt_in then 'not_opted_in'
           when private.to_e164(c.phone) is null then 'no_mobile_number'
         end,
         coalesce(
           m.body,
           case when c.sms_opt_in and private.to_e164(c.phone) is not null
             then private.rain_delay_message(c.first_name, business_name, delay.from_date, delay.to_date)
           end
         ),
         m.id, m.status, m.error_code, m.error_message, m.created_at
  from affected a
  join public.customers c on c.id = a.id and c.business_id = biz
  left join public.sms_messages m on m.rain_delay_id = delay.id and m.customer_id = c.id
  order by c.last_name, c.first_name, c.id;
end;
$$;

revoke execute on function public.rain_delay_texts(uuid) from public, anon;
grant execute on function public.rain_delay_texts(uuid) to authenticated;

-- Claims the texts to send for a rain delay and returns them for the app to hand to
-- Twilio: one per opted-in customer with a usable number who hasn't been texted for this
-- rain delay yet (or whose earlier text failed). Claimed texts are recorded as
-- 'sending' first, so pressing Send twice — even at the same moment — never texts
-- anyone twice.
create function public.start_rain_delay_texts(rain_delay_id uuid)
returns table (message_id uuid, to_phone text, from_phone text, body text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  biz uuid := private.my_owned_business();
  delay public.rain_delays;
  sender text;
  business_name text;
begin
  -- Locked so two sends for the same rain delay run one after the other.
  select * into delay
  from public.rain_delays d
  where d.id = start_rain_delay_texts.rain_delay_id and d.business_id = biz
  for update;
  if not found then
    raise exception 'Rain delay not found' using errcode = 'P0002';
  end if;

  select s.phone_number into sender from public.sms_senders s where s.business_id = biz;
  if sender is null then
    raise exception 'Texting isn''t set up for this business yet' using errcode = '55000';
  end if;
  select b.name into business_name from public.businesses b where b.id = biz;

  return query
  with eligible as (
    select c.id as customer_id,
           private.to_e164(c.phone) as to_phone,
           private.rain_delay_message(c.first_name, business_name, delay.from_date, delay.to_date) as body
    from public.customers c
    where c.business_id = biz
      and c.sms_opt_in
      and private.to_e164(c.phone) is not null
      and c.id in (
        select j.customer_id
        from public.rain_delay_visits v
        join public.jobs j on j.id = v.job_id and j.business_id = v.business_id
        where v.rain_delay_id = delay.id
      )
  ),
  retried as (
    update public.sms_messages m
    set status = 'sending', to_phone = e.to_phone, from_phone = sender, body = e.body,
        twilio_sid = null, error_code = null, error_message = null, sent_by = (select auth.uid())
    from eligible e
    where m.rain_delay_id = delay.id and m.customer_id = e.customer_id and m.status = 'failed'
    returning m.id, m.to_phone, m.from_phone, m.body
  ),
  inserted as (
    insert into public.sms_messages (business_id, rain_delay_id, customer_id, to_phone, from_phone, body, sent_by)
    select biz, delay.id, e.customer_id, e.to_phone, sender, e.body, (select auth.uid())
    from eligible e
    on conflict (rain_delay_id, customer_id) do nothing
    returning sms_messages.id, sms_messages.to_phone, sms_messages.from_phone, sms_messages.body
  )
  select r.id, r.to_phone, r.from_phone, r.body from retried r
  union all
  select i.id, i.to_phone, i.from_phone, i.body from inserted i;
end;
$$;

revoke execute on function public.start_rain_delay_texts(uuid) from public, anon;
grant execute on function public.start_rain_delay_texts(uuid) to authenticated;

-- Records what Twilio said when the app handed it a claimed text: its message SID and
-- status, or (with no SID) why it was refused.
create function public.record_sms_result(
  message_id uuid,
  twilio_sid text default null,
  twilio_status text default null,
  error_code integer default null,
  error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  msg public.sms_messages;
begin
  update public.sms_messages m
  set twilio_sid = nullif(btrim(record_sms_result.twilio_sid), ''),
      status = case
        when nullif(btrim(record_sms_result.twilio_sid), '') is null then 'failed'
        else private.sms_status_from_twilio(record_sms_result.twilio_status)
      end,
      error_code = record_sms_result.error_code,
      error_message = left(record_sms_result.error_message, 500)
  where m.id = record_sms_result.message_id
    and m.business_id = biz
    and m.status = 'sending'
  returning * into msg;
  if not found then
    raise exception 'Text not found' using errcode = 'P0002';
  end if;
  perform private.opt_out_after_sms_error(msg);
end;
$$;

revoke execute on function public.record_sms_result(uuid, text, text, integer, text) from public, anon;
grant execute on function public.record_sms_result(uuid, text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Twilio webhooks. Called only by the app's webhook routes, with the service role,
-- after they've checked Twilio's signature. Nobody else can execute these.
-- ---------------------------------------------------------------------------

-- A delivery status update for a text we sent.
create function public.twilio_message_status(message_sid text, message_status text, error_code integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_status public.sms_status := private.sms_status_from_twilio(message_status);
  msg public.sms_messages;
begin
  update public.sms_messages m
  set status = new_status,
      error_code = coalesce(twilio_message_status.error_code, m.error_code)
  where m.twilio_sid = twilio_message_status.message_sid
    and private.sms_status_rank(new_status) > private.sms_status_rank(m.status)
  returning * into msg;
  if found then
    perform private.opt_out_after_sms_error(msg);
  end if;
end;
$$;

-- A customer replied STOP to a business's number: they're opted out of that business's
-- texts. The same phone number on another business's customer list is untouched.
-- Returns how many customer records were opted out.
create function public.twilio_opt_out(to_number text, from_number text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.customers c
  set sms_opt_in = false
  where c.business_id = (select s.business_id from public.sms_senders s where s.phone_number = to_number)
    and private.to_e164(c.phone) = from_number
    and c.sms_opt_in;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.twilio_message_status(text, text, integer) from public, anon, authenticated;
revoke execute on function public.twilio_opt_out(text, text) from public, anon, authenticated;
grant execute on function public.twilio_message_status(text, text, integer) to service_role;
grant execute on function public.twilio_opt_out(text, text) to service_role;
