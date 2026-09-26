-- EcoScape Ops scheduling: service plans (a customer's booked service) and jobs
-- (individual visits), following the prototype's Schedule screen.
--
--   * Booking a service creates a service_plan; the database generates its visits.
--   * Recurring plans always keep 6 open visits on the schedule: whenever a visit is
--     completed or cancelled, the next one in the cadence is added. One-time plans get
--     exactly one visit. Stopping a plan removes its upcoming not-yet-started visits.
--   * Same isolation model as customers: business_id on every row, owner-only RLS,
--     and composite foreign keys so a plan or job can only point at a customer (or
--     plan) in the same business.

-- ---------------------------------------------------------------------------
-- Business time zone: "today" (for the Today / Upcoming / overdue logic) depends on
-- where the business is. Captured from the browser at signup.
-- ---------------------------------------------------------------------------
alter table public.businesses add column time_zone text not null default 'America/New_York';

-- Returns tz if Postgres knows it, otherwise the default.
create function private.valid_time_zone(tz text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select n.name from pg_catalog.pg_timezone_names n where n.name = tz limit 1),
    'America/New_York'
  );
$$;

revoke execute on function private.valid_time_zone(text) from public;

drop function public.create_business(text);
drop function private.create_business_for_user(uuid, text);

create function private.create_business_for_user(p_user_id uuid, p_business_name text, p_time_zone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_business_id uuid;
begin
  insert into public.businesses (name, time_zone)
  values (btrim(p_business_name), private.valid_time_zone(p_time_zone))
  returning id into new_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_business_id, p_user_id, 'owner');

  return new_business_id;
end;
$$;

revoke execute on function private.create_business_for_user(uuid, text, text) from public;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'business_name'), '') is not null then
    perform private.create_business_for_user(
      new.id,
      new.raw_user_meta_data ->> 'business_name',
      new.raw_user_meta_data ->> 'time_zone'
    );
  end if;
  return new;
end;
$$;

create function public.create_business(business_name text, time_zone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if exists (select 1 from public.business_members m where m.user_id = current_user_id) then
    raise exception 'This account already belongs to a business' using errcode = '23505';
  end if;

  return private.create_business_for_user(current_user_id, business_name, time_zone);
end;
$$;

revoke execute on function public.create_business(text, text) from public, anon;
grant execute on function public.create_business(text, text) to authenticated;

-- Lets plans and jobs reference (customer, business) pairs, so a row can never point at
-- another business's customer.
alter table public.customers add constraint customers_id_business_unique unique (id, business_id);

-- ---------------------------------------------------------------------------
-- Service plans
-- ---------------------------------------------------------------------------
create type public.service_frequency as enum ('weekly', 'biweekly', 'triweekly', 'one_time');

create table public.service_plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,

  service_name text not null,
  price numeric(10, 2) not null,
  frequency public.service_frequency not null,
  start_date date not null,
  -- The next visit date in the plan's cadence. Anchored to start_date so rescheduling
  -- one visit doesn't shift the rest. Null once a one-time plan has its visit, or once
  -- a plan is stopped.
  next_visit_date date,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade,
  constraint service_plans_id_business_unique unique (id, business_id),
  constraint service_plans_service_name_length check (char_length(btrim(service_name)) between 1 and 100),
  constraint service_plans_price_range check (price >= 0 and price <= 99999.99)
);

create index service_plans_customer_idx on public.service_plans (business_id, customer_id);

create trigger service_plans_set_updated_at
  before update on public.service_plans
  for each row execute function private.set_updated_at();

create trigger service_plans_business_id_immutable
  before update on public.service_plans
  for each row execute function private.prevent_business_id_change();

-- ---------------------------------------------------------------------------
-- Jobs (visits)
-- ---------------------------------------------------------------------------
create type public.job_status as enum (
  'scheduled',
  'assigned',
  'en_route',
  'in_progress',
  'completed',
  'unable_to_complete',
  'weather_delay',
  'cancelled'
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,
  service_plan_id uuid not null,

  -- Copied from the plan when the visit is created; can be changed per visit.
  service_name text not null,
  price numeric(10, 2) not null,
  scheduled_date date not null,
  status public.job_status not null default 'scheduled',
  notes text not null default '',
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade,
  foreign key (service_plan_id, business_id) references public.service_plans (id, business_id) on delete cascade,
  constraint jobs_service_name_length check (char_length(btrim(service_name)) between 1 and 100),
  constraint jobs_price_range check (price >= 0 and price <= 99999.99),
  constraint jobs_notes_length check (char_length(notes) <= 4000)
);

create index jobs_business_date_idx on public.jobs (business_id, scheduled_date);
create index jobs_plan_idx on public.jobs (service_plan_id, status);
create index jobs_customer_idx on public.jobs (business_id, customer_id, scheduled_date);

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function private.set_updated_at();

create trigger jobs_business_id_immutable
  before update on public.jobs
  for each row execute function private.prevent_business_id_change();

-- completed_at tracks when a visit was marked completed, and clears if it's reopened.
create function private.set_job_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    new.completed_at = now();
  elsif new.status <> 'completed' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger jobs_set_completed_at
  before insert or update of status on public.jobs
  for each row execute function private.set_job_completed_at();

-- ---------------------------------------------------------------------------
-- Visit generation: keep 6 open visits on every active recurring plan
-- ---------------------------------------------------------------------------
create function private.frequency_interval_days(f public.service_frequency)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case f when 'weekly' then 7 when 'biweekly' then 14 when 'triweekly' then 21 end;
$$;

revoke execute on function private.frequency_interval_days(public.service_frequency) from public;

-- Adds visits until the plan has 6 open (not completed/cancelled) ones; a one-time plan
-- gets its single visit. SECURITY DEFINER so it works whoever changed the job (e.g.
-- future crew members, who won't be allowed to insert jobs themselves). It only ever
-- copies data from the plan it's given, within that plan's business.
create function private.top_up_service_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.service_plans;
  open_visits integer;
  step integer;
begin
  -- Lock the plan so two visits completed at the same moment can't both add visits.
  select * into plan from public.service_plans where id = p_plan_id for update;
  if not found or not plan.active or plan.next_visit_date is null then
    return;
  end if;

  if plan.frequency = 'one_time' then
    insert into public.jobs (business_id, customer_id, service_plan_id, service_name, price, scheduled_date)
    values (plan.business_id, plan.customer_id, plan.id, plan.service_name, plan.price, plan.next_visit_date);
    update public.service_plans set next_visit_date = null where id = plan.id;
    return;
  end if;

  step := private.frequency_interval_days(plan.frequency);
  select count(*) into open_visits
  from public.jobs j
  where j.service_plan_id = plan.id and j.status not in ('completed', 'cancelled');

  while open_visits < 6 loop
    insert into public.jobs (business_id, customer_id, service_plan_id, service_name, price, scheduled_date)
    values (plan.business_id, plan.customer_id, plan.id, plan.service_name, plan.price, plan.next_visit_date);
    plan.next_visit_date := plan.next_visit_date + step;
    open_visits := open_visits + 1;
  end loop;

  update public.service_plans set next_visit_date = plan.next_visit_date where id = plan.id;
end;
$$;

revoke execute on function private.top_up_service_plan(uuid) from public;

create function private.service_plan_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.top_up_service_plan(new.id);
  return null;
end;
$$;

revoke execute on function private.service_plan_created() from public;

-- A new plan always starts its cadence at start_date.
create function private.service_plan_set_first_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.next_visit_date = new.start_date;
  new.active = true;
  return new;
end;
$$;

create trigger service_plans_set_first_visit
  before insert on public.service_plans
  for each row execute function private.service_plan_set_first_visit();

create trigger service_plans_generate_visits
  after insert on public.service_plans
  for each row execute function private.service_plan_created();

create function private.job_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.top_up_service_plan(new.service_plan_id);
  return null;
end;
$$;

revoke execute on function private.job_closed() from public;

create trigger jobs_top_up_plan
  after update of status on public.jobs
  for each row
  when (new.status in ('completed', 'cancelled') and old.status is distinct from new.status)
  execute function private.job_closed();

-- Stops a plan: no more visits get added, and its upcoming visits that haven't started
-- (scheduled/assigned, today or later in the business's time zone) are removed. Past
-- and in-flight visits stay. Runs as the caller, so RLS applies. Returns how many
-- visits were removed.
create function public.stop_service_plan(plan_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  business_today date;
  removed integer;
begin
  select (now() at time zone b.time_zone)::date into business_today
  from public.service_plans p
  join public.businesses b on b.id = p.business_id
  where p.id = plan_id;

  if not found then
    raise exception 'Service not found' using errcode = 'P0002';
  end if;

  update public.service_plans set active = false, next_visit_date = null where id = plan_id;

  delete from public.jobs
  where service_plan_id = plan_id
    and scheduled_date >= business_today
    and status in ('scheduled', 'assigned');
  get diagnostics removed = row_count;

  return removed;
end;
$$;

revoke execute on function public.stop_service_plan(uuid) from public, anon;
grant execute on function public.stop_service_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security (owner-only, like customers)
-- ---------------------------------------------------------------------------
revoke all on public.service_plans, public.jobs from anon, authenticated;
grant select, insert, update, delete on public.service_plans to authenticated;
grant select, insert, update, delete on public.jobs to authenticated;

alter table public.service_plans enable row level security;
alter table public.jobs enable row level security;

create policy "Owners can view their service plans"
  on public.service_plans for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can add service plans"
  on public.service_plans for insert
  to authenticated
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can update their service plans"
  on public.service_plans for update
  to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can delete their service plans"
  on public.service_plans for delete
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their jobs"
  on public.jobs for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can add jobs"
  on public.jobs for insert
  to authenticated
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can update their jobs"
  on public.jobs for update
  to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can delete their jobs"
  on public.jobs for delete
  to authenticated
  using (business_id in (select private.owner_business_ids()));
