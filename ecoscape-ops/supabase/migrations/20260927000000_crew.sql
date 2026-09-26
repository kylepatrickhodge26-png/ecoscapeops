-- EcoScape Ops crew: crew members with their own logins, job assignment, and a crew
-- member's own view of the jobs assigned to them.
--
-- Access model
--   * Owners keep full access to their business, as before.
--   * Crew members get NO direct access to customers, service plans, or jobs. Everything
--     a crew member sees or does goes through the crew_* functions below, which only ever
--     touch jobs assigned to the caller and never return prices.
--   * Crew members join with an invite link: the owner adds a name, gets a one-time link
--     (only its SHA-256 hash is stored), and the crew member signs up through it.

-- ---------------------------------------------------------------------------
-- Crew members. The owner is one too, so jobs can be assigned to them.
-- ---------------------------------------------------------------------------
create table public.crew_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  -- Set once the person has their own login (immediately for the owner).
  user_id uuid unique,
  email text,
  -- SHA-256 (hex) of the invite token. The token itself is shown to the owner once and
  -- never stored. Cleared when the invite is accepted.
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint crew_members_id_business_unique unique (id, business_id),
  constraint crew_members_name_length check (char_length(btrim(name)) between 1 and 80),
  -- A crew member with a login always has a membership in the same business, and
  -- removing that membership removes them from the crew.
  foreign key (business_id, user_id) references public.business_members (business_id, user_id) on delete cascade
);

create index crew_members_business_idx on public.crew_members (business_id);

create trigger crew_members_set_updated_at
  before update on public.crew_members
  for each row execute function private.set_updated_at();

create trigger crew_members_business_id_immutable
  before update on public.crew_members
  for each row execute function private.prevent_business_id_change();

-- "Kyle" from signup's full_name, else the part of the email before the @.
create function private.user_display_name(meta jsonb, email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(coalesce(nullif(btrim(meta ->> 'full_name'), ''), nullif(split_part(email, '@', 1), ''), 'Owner'), 80);
$$;

revoke execute on function private.user_display_name(jsonb, text) from public;

-- Existing owners join their own crew list.
insert into public.crew_members (business_id, name, user_id, email)
select m.business_id, private.user_display_name(u.raw_user_meta_data, u.email), u.id, u.email
from public.business_members m
join auth.users u on u.id = m.user_id
where m.role = 'owner';

-- New businesses add their owner to the crew list.
create or replace function private.create_business_for_user(p_user_id uuid, p_business_name text, p_time_zone text)
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

  insert into public.crew_members (business_id, name, user_id, email)
  select new_business_id, private.user_display_name(u.raw_user_meta_data, u.email), u.id, u.email
  from auth.users u
  where u.id = p_user_id;

  return new_business_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assignment
-- ---------------------------------------------------------------------------
alter table public.service_plans add column assigned_crew_member_id uuid;
alter table public.service_plans
  add constraint service_plans_assigned_crew_member_fkey
  foreign key (assigned_crew_member_id, business_id)
  references public.crew_members (id, business_id)
  on delete set null (assigned_crew_member_id);

alter table public.jobs add column assigned_crew_member_id uuid;
alter table public.jobs
  add constraint jobs_assigned_crew_member_fkey
  foreign key (assigned_crew_member_id, business_id)
  references public.crew_members (id, business_id)
  on delete set null (assigned_crew_member_id);

create index jobs_assignee_idx on public.jobs (assigned_crew_member_id, scheduled_date)
  where assigned_crew_member_id is not null;

-- Visits generated for a plan go to the plan's crew member.
create or replace function private.top_up_service_plan(p_plan_id uuid)
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
    insert into public.jobs (business_id, customer_id, service_plan_id, service_name, price, scheduled_date, assigned_crew_member_id)
    values (plan.business_id, plan.customer_id, plan.id, plan.service_name, plan.price, plan.next_visit_date, plan.assigned_crew_member_id);
    update public.service_plans set next_visit_date = null where id = plan.id;
    return;
  end if;

  step := private.frequency_interval_days(plan.frequency);
  select count(*) into open_visits
  from public.jobs j
  where j.service_plan_id = plan.id and j.status not in ('completed', 'cancelled');

  while open_visits < 6 loop
    insert into public.jobs (business_id, customer_id, service_plan_id, service_name, price, scheduled_date, assigned_crew_member_id)
    values (plan.business_id, plan.customer_id, plan.id, plan.service_name, plan.price, plan.next_visit_date, plan.assigned_crew_member_id);
    plan.next_visit_date := plan.next_visit_date + step;
    open_visits := open_visits + 1;
  end loop;

  update public.service_plans set next_visit_date = plan.next_visit_date where id = plan.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------
create function private.new_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 64 hex characters from two random UUIDs (244 random bits).
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create function private.hash_invite_token(token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex');
$$;

revoke execute on function private.new_invite_token() from public;
revoke execute on function private.hash_invite_token(text) from public;

-- Owner: add a crew member. Returns the invite token, which is never stored or shown again.
create function public.add_crew_member(member_name text)
returns table (crew_member_id uuid, invite_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_business uuid;
  token text := private.new_invite_token();
  new_id uuid;
begin
  select m.business_id into owner_business
  from public.business_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner';
  if owner_business is null then
    raise exception 'Only the business owner can add crew members' using errcode = '42501';
  end if;

  insert into public.crew_members (business_id, name, invite_token_hash, invite_expires_at)
  values (owner_business, btrim(member_name), private.hash_invite_token(token), now() + interval '14 days')
  returning id into new_id;

  return query select new_id, token;
end;
$$;

-- Owner: replace a pending invite link (the old one stops working).
create function public.regenerate_crew_invite(crew_member_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text := private.new_invite_token();
begin
  update public.crew_members c
  set invite_token_hash = private.hash_invite_token(token), invite_expires_at = now() + interval '14 days'
  where c.id = regenerate_crew_invite.crew_member_id
    and c.user_id is null
    and c.business_id in (select private.owner_business_ids());
  if not found then
    raise exception 'No pending invite for that crew member' using errcode = 'P0002';
  end if;
  return token;
end;
$$;

-- Owner: remove a crew member. Their login loses all access to the business, and their
-- jobs become unassigned. Owners can't be removed.
create function public.remove_crew_member(crew_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.crew_members;
begin
  select * into member
  from public.crew_members c
  where c.id = remove_crew_member.crew_member_id
    and c.business_id in (select private.owner_business_ids());
  if not found then
    raise exception 'Crew member not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.business_members m
    where m.business_id = member.business_id and m.user_id = member.user_id and m.role = 'owner'
  ) then
    raise exception 'The owner can''t be removed from the crew' using errcode = '42501';
  end if;

  if member.user_id is not null then
    delete from public.business_members m where m.business_id = member.business_id and m.user_id = member.user_id;
  end if;
  delete from public.crew_members c where c.id = member.id;
end;
$$;

-- Anyone holding a valid invite link: which business and name it's for.
create function public.crew_invite_details(token text)
returns table (business_name text, crew_member_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name, c.name
  from public.crew_members c
  join public.businesses b on b.id = c.business_id
  where c.invite_token_hash = private.hash_invite_token(token)
    and c.user_id is null
    and c.invite_expires_at > now();
$$;

create function private.accept_crew_invite_for_user(p_user_id uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  member public.crew_members;
  user_email text;
begin
  select * into member
  from public.crew_members c
  where c.invite_token_hash = private.hash_invite_token(p_token)
    and c.user_id is null
    and c.invite_expires_at > now()
  for update;
  if not found then
    raise exception 'This invite link is invalid or has expired' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.business_members m where m.user_id = p_user_id) then
    raise exception 'This account already belongs to a business' using errcode = '23505';
  end if;

  select u.email into user_email from auth.users u where u.id = p_user_id;

  insert into public.business_members (business_id, user_id, role)
  values (member.business_id, p_user_id, 'crew');

  update public.crew_members
  set user_id = p_user_id, email = user_email, invite_token_hash = null, invite_expires_at = null
  where id = member.id;

  return member.business_id;
end;
$$;

revoke execute on function private.accept_crew_invite_for_user(uuid, text) from public;

-- A signed-in user with no business accepts an invite.
create function public.accept_crew_invite(token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return private.accept_crew_invite_for_user((select auth.uid()), token);
end;
$$;

-- Signup: an invite token in the metadata joins that crew (an invalid token fails the
-- signup rather than leaving a login with no business); otherwise a business_name
-- creates a business as before.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'crew_invite_token'), '') is not null then
    perform private.accept_crew_invite_for_user(new.id, new.raw_user_meta_data ->> 'crew_invite_token');
  elsif nullif(btrim(new.raw_user_meta_data ->> 'business_name'), '') is not null then
    perform private.create_business_for_user(
      new.id,
      new.raw_user_meta_data ->> 'business_name',
      new.raw_user_meta_data ->> 'time_zone'
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crew-facing functions: only the caller's own assigned jobs, never prices
-- ---------------------------------------------------------------------------
create function private.my_crew_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.crew_members c where c.user_id = (select auth.uid());
$$;

revoke execute on function private.my_crew_member_id() from public;

create function public.crew_jobs(from_date date, to_date date)
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
  service_notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.scheduled_date, j.status, j.service_name, j.notes,
         c.first_name, c.last_name, c.phone, c.email,
         c.property_address, c.access_instructions, c.service_notes
  from public.jobs j
  join public.customers c on c.id = j.customer_id and c.business_id = j.business_id
  where j.assigned_crew_member_id = private.my_crew_member_id()
    and j.scheduled_date between from_date and to_date
  order by j.scheduled_date, j.created_at;
$$;

-- One of the caller's own jobs, locked for update. Anything else is "not found".
create function private.my_job_for_update(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
begin
  select * into job
  from public.jobs j
  where j.id = p_job_id
    and j.assigned_crew_member_id = private.my_crew_member_id()
  for update;
  if not found then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  return job;
end;
$$;

revoke execute on function private.my_job_for_update(uuid) from public;

-- "Maria: <line>", appended to a job's notes.
create function private.append_crew_note(p_job public.jobs, p_line text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  line text := btrim(coalesce(p_line, ''));
  author text;
begin
  if line = '' or char_length(line) > 500 then
    raise exception 'A note must be 1 to 500 characters' using errcode = '22023';
  end if;
  select c.name into author from public.crew_members c where c.id = private.my_crew_member_id();
  line := author || ': ' || line;
  return case when btrim(p_job.notes) = '' then line else btrim(p_job.notes) || E'\n' || line end;
end;
$$;

revoke execute on function private.append_crew_note(public.jobs, text) from public;

create function public.crew_set_job_status(job_id uuid, new_status public.job_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
begin
  if new_status not in ('en_route', 'in_progress', 'completed') then
    raise exception 'Crew can mark a job en route, in progress, or completed' using errcode = '42501';
  end if;
  job := private.my_job_for_update(job_id);
  if job.status in ('completed', 'cancelled') then
    raise exception 'This job is already completed or cancelled' using errcode = '22023';
  end if;
  update public.jobs set status = new_status where id = job.id;
end;
$$;

create function public.crew_add_job_note(job_id uuid, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
begin
  job := private.my_job_for_update(job_id);
  update public.jobs set notes = private.append_crew_note(job, note) where id = job.id;
end;
$$;

-- "Could not service": reschedule to a new date (today or later where the business
-- is) or cancel. note_line explains what happened and is added to the job's notes.
create function public.crew_could_not_service(job_id uuid, choice text, new_date date, note_line text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.jobs;
  business_today date;
begin
  job := private.my_job_for_update(job_id);
  if job.status in ('completed', 'cancelled') then
    raise exception 'This job is already completed or cancelled' using errcode = '22023';
  end if;

  if choice = 'reschedule' then
    select (now() at time zone b.time_zone)::date into business_today
    from public.businesses b where b.id = job.business_id;
    if new_date is null or new_date < business_today then
      raise exception 'The new date can''t be before today' using errcode = '22023';
    end if;
    update public.jobs
    set scheduled_date = new_date, status = 'scheduled', notes = private.append_crew_note(job, note_line)
    where id = job.id;
  elsif choice = 'cancel' then
    update public.jobs
    set status = 'cancelled', notes = private.append_crew_note(job, note_line)
    where id = job.id;
  else
    raise exception 'Choose reschedule or cancel' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security
-- ---------------------------------------------------------------------------
revoke all on public.crew_members from anon, authenticated;
grant select, update (name) on public.crew_members to authenticated;
alter table public.crew_members enable row level security;

-- Owners see their whole crew; a crew member sees only their own record.
create policy "Owners see their crew; crew see themselves"
  on public.crew_members for select
  to authenticated
  using (business_id in (select private.owner_business_ids()) or user_id = (select auth.uid()));

create policy "Owners can rename crew members"
  on public.crew_members for update
  to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

-- Crew members no longer see the rest of the business's memberships, only their own.
drop policy "Members can view memberships of their business" on public.business_members;
create policy "Owners see all memberships; others see their own"
  on public.business_members for select
  to authenticated
  using (user_id = (select auth.uid()) or business_id in (select private.owner_business_ids()));

revoke execute on function public.add_crew_member(text) from public, anon;
revoke execute on function public.regenerate_crew_invite(uuid) from public, anon;
revoke execute on function public.remove_crew_member(uuid) from public, anon;
revoke execute on function public.accept_crew_invite(text) from public, anon;
revoke execute on function public.crew_invite_details(text) from public;
revoke execute on function public.crew_jobs(date, date) from public, anon;
revoke execute on function public.crew_set_job_status(uuid, public.job_status) from public, anon;
revoke execute on function public.crew_add_job_note(uuid, text) from public, anon;
revoke execute on function public.crew_could_not_service(uuid, text, date, text) from public, anon;

grant execute on function public.add_crew_member(text) to authenticated;
grant execute on function public.regenerate_crew_invite(uuid) to authenticated;
grant execute on function public.remove_crew_member(uuid) to authenticated;
grant execute on function public.accept_crew_invite(text) to authenticated;
grant execute on function public.crew_invite_details(text) to anon, authenticated;
grant execute on function public.crew_jobs(date, date) to authenticated;
grant execute on function public.crew_set_job_status(uuid, public.job_status) to authenticated;
grant execute on function public.crew_add_job_note(uuid, text) to authenticated;
grant execute on function public.crew_could_not_service(uuid, text, date, text) to authenticated;
