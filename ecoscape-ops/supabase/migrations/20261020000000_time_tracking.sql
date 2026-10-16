-- Time tracking: crew clock in and out of a visit; the owner sees hours per visit, crew member
-- and customer, edits a forgotten clock-out with a note, and sees revenue per labor hour.
--
-- Crew members can only clock in to visits assigned to them (the owner can clock in to any
-- visit in the business), have at most one open entry at a time, and can never read time
-- entries, prices or revenue per hour. Everything crew do goes through functions; only the
-- owner can read the table.

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id uuid not null,
  -- Kept (as null) with the name below if the crew member is later removed.
  crew_member_id uuid,
  crew_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text not null default '',
  -- Set when the owner changed the times.
  edited_at timestamptz,
  created_at timestamptz not null default now(),

  foreign key (job_id, business_id) references public.jobs (id, business_id) on delete cascade,
  foreign key (crew_member_id, business_id) references public.crew_members (id, business_id) on delete set null (crew_member_id),
  constraint time_entries_id_business_unique unique (id, business_id),
  constraint time_entries_end_after_start check (ended_at is null or ended_at > started_at),
  constraint time_entries_max_length check (ended_at is null or ended_at - started_at <= interval '24 hours'),
  constraint time_entries_note_length check (char_length(note) <= 500)
);

create index time_entries_job_idx on public.time_entries (job_id, started_at);
create index time_entries_crew_idx on public.time_entries (crew_member_id, started_at);
create index time_entries_business_idx on public.time_entries (business_id, started_at);
-- A crew member can have only one open (not clocked out) entry at a time.
create unique index time_entries_one_open_per_member on public.time_entries (crew_member_id) where ended_at is null and crew_member_id is not null;

create trigger time_entries_business_id_immutable
  before update on public.time_entries
  for each row execute function private.prevent_business_id_change();

-- ---------------------------------------------------------------------------
-- Crew and owner: clocking in and out
-- ---------------------------------------------------------------------------
create function public.clock_in(job_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  me public.crew_members;
  open_entry public.time_entries;
  open_job public.jobs;
  new_id uuid;
begin
  select * into me from public.crew_members c where c.user_id = (select auth.uid());
  if not found then
    raise exception 'You are not on a crew' using errcode = '42501';
  end if;

  select * into j from public.jobs x where x.id = clock_in.job_id and x.business_id = me.business_id;
  if not found or not private.can_use_job(clock_in.job_id) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if j.status in ('cancelled', 'completed') then
    raise exception 'This visit is already %', case j.status when 'cancelled' then 'cancelled' else 'completed' end using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(me.id::text, 0));

  select * into open_entry from public.time_entries t where t.crew_member_id = me.id and t.ended_at is null;
  if found then
    if open_entry.job_id = clock_in.job_id then
      return open_entry.id; -- already clocked in here; a second tap changes nothing
    end if;
    select * into open_job from public.jobs x where x.id = open_entry.job_id;
    raise exception 'You''re already clocked in to % — clock out first', coalesce(open_job.service_name, 'another visit') using errcode = '23505';
  end if;

  insert into public.time_entries (business_id, job_id, crew_member_id, crew_name)
  values (me.business_id, clock_in.job_id, me.id, me.name)
  returning id into new_id;
  return new_id;
end;
$$;

create function public.clock_out(job_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.my_crew_member_id();
begin
  update public.time_entries t
  set ended_at = greatest(now(), t.started_at + interval '1 second')
  where t.crew_member_id = me and t.job_id = clock_out.job_id and t.ended_at is null;
  if not found then
    raise exception 'You''re not clocked in to this visit' using errcode = 'P0002';
  end if;
exception
  when check_violation then
    raise exception 'That entry has been open more than 24 hours — ask the owner to fix it' using errcode = '22023';
end;
$$;

-- The caller's own open entry, if any. Crew see this and nothing else about time.
create function public.my_open_time_entry()
returns table (job_id uuid, started_at timestamptz, service_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.job_id, t.started_at, j.service_name
  from public.time_entries t
  join public.jobs j on j.id = t.job_id and j.business_id = t.business_id
  where t.crew_member_id = private.my_crew_member_id() and t.ended_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Owner: fix or remove an entry
-- ---------------------------------------------------------------------------
-- The times are the business's local clock time (what the owner typed), converted here so
-- daylight-saving changes come out right. A note saying why is required.
create function public.edit_time_entry(entry_id uuid, started_local timestamp, ended_local timestamp, note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  tz text;
  e public.time_entries;
  new_start timestamptz;
  new_end timestamptz;
  why text := btrim(coalesce(edit_time_entry.note, ''));
begin
  select * into e from public.time_entries t where t.id = edit_time_entry.entry_id and t.business_id = biz for update;
  if not found then
    raise exception 'Time entry not found' using errcode = 'P0002';
  end if;
  select b.time_zone into tz from public.businesses b where b.id = biz;

  if started_local is null then
    raise exception 'Enter a start time' using errcode = '22023';
  end if;
  if why = '' then
    raise exception 'Add a note saying why you changed this' using errcode = '22023';
  end if;
  if char_length(why) > 500 then
    raise exception 'The note must be 500 characters or fewer' using errcode = '22023';
  end if;

  new_start := started_local at time zone tz;
  new_end := ended_local at time zone tz;
  if new_start > now() + interval '5 minutes' or new_end > now() + interval '5 minutes' then
    raise exception 'Times can''t be in the future' using errcode = '22023';
  end if;
  if new_end is not null and new_end <= new_start then
    raise exception 'The end must be after the start' using errcode = '22023';
  end if;
  if new_end is not null and new_end - new_start > interval '24 hours' then
    raise exception 'An entry can''t be longer than 24 hours' using errcode = '22023';
  end if;
  if new_end is null and e.ended_at is not null then
    raise exception 'Enter an end time' using errcode = '22023';
  end if;

  if e.crew_member_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(e.crew_member_id::text, 0));
    if exists (
      select 1 from public.time_entries o
      where o.crew_member_id = e.crew_member_id and o.id <> e.id
        and tstzrange(o.started_at, coalesce(o.ended_at, 'infinity'::timestamptz)) && tstzrange(new_start, coalesce(new_end, 'infinity'::timestamptz))
    ) then
      raise exception 'That overlaps another time entry for the same person' using errcode = '22023';
    end if;
  end if;

  update public.time_entries t
  set started_at = new_start, ended_at = new_end, note = why, edited_at = now()
  where t.id = e.id;
end;
$$;

create function public.delete_time_entry(entry_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  delete from public.time_entries t where t.id = delete_time_entry.entry_id and t.business_id = biz;
  if not found then
    raise exception 'Time entry not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: hours and revenue per hour. Everything is keyed on the visit's date, so a visit's
-- hours and its value always line up. A visit's value is its price, or its invoiced amount
-- once it is on a sent invoice (the same rule as the dashboard and reports). Revenue per hour
-- is per labor hour: two people working an hour each is two hours. Open entries aren't counted
-- as hours yet.
-- ---------------------------------------------------------------------------
create function public.time_by_job(from_date date, to_date date)
returns table (
  job_id uuid,
  scheduled_date date,
  service_name text,
  customer_id uuid,
  customer_name text,
  hours numeric,
  open_entries integer,
  job_value numeric,
  revenue_per_hour numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  with per_job as (
    select j.id as jid, j.scheduled_date as jdate, j.service_name as jservice, j.customer_id as jcust,
           coalesce(sum(extract(epoch from (t.ended_at - t.started_at))) filter (where t.ended_at is not null), 0) / 3600.0 as hrs,
           (count(*) filter (where t.ended_at is null))::integer as open_n,
           coalesce(
             (select sum(l.amount) from public.invoice_lines l
              join public.invoices i on i.id = l.invoice_id and i.business_id = l.business_id
              where l.job_id = j.id and l.business_id = biz and not l.invoice_cancelled and i.status = 'sent'),
             j.price
           ) as val
    from public.jobs j
    join public.time_entries t on t.job_id = j.id and t.business_id = biz
    where j.business_id = biz and j.status <> 'cancelled' and j.scheduled_date between from_date and to_date
    group by j.id
  )
  select p.jid, p.jdate, p.jservice, p.jcust,
         coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), nullif(c.phone, ''), nullif(c.email, ''), 'Customer'),
         round(p.hrs, 2), p.open_n, p.val,
         -- Worked out from the hours as shown, so the three figures always agree.
         case when round(p.hrs, 2) >= 0.01 then round(p.val / round(p.hrs, 2), 2) end
  from per_job p
  join public.customers c on c.id = p.jcust and c.business_id = biz
  order by p.jdate desc, p.jservice, p.jid
  limit 500;
end;
$$;

create function public.time_by_crew(from_date date, to_date date)
returns table (crew_member_id uuid, crew_name text, hours numeric, entries integer, open_entries integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select t.crew_member_id,
         min(t.crew_name),
         round(coalesce(sum(extract(epoch from (t.ended_at - t.started_at))) filter (where t.ended_at is not null), 0) / 3600.0, 2),
         count(*)::integer,
         (count(*) filter (where t.ended_at is null))::integer
  from public.time_entries t
  join public.jobs j on j.id = t.job_id and j.business_id = t.business_id
  where t.business_id = biz and j.status <> 'cancelled' and j.scheduled_date between from_date and to_date
  group by t.crew_member_id, lower(t.crew_name)
  order by 3 desc, 2;
end;
$$;

create function public.time_by_customer(from_date date, to_date date)
returns table (customer_id uuid, customer_name text, hours numeric, visits integer, job_value numeric, revenue_per_hour numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select j.customer_id,
         min(j.customer_name),
         round(sum(j.hours), 2),
         count(*)::integer,
         sum(j.job_value),
         case when round(sum(j.hours), 2) >= 0.01 then round(sum(j.job_value) / round(sum(j.hours), 2), 2) end
  from public.time_by_job(from_date, to_date) j
  group by j.customer_id
  order by 3 desc, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: only the owner can read the table; everything crew do is a function.
-- ---------------------------------------------------------------------------
revoke all on public.time_entries from anon, authenticated;
grant select on public.time_entries to authenticated;
alter table public.time_entries enable row level security;
create policy "Owners can view their time entries"
  on public.time_entries for select to authenticated
  using (business_id in (select private.owner_business_ids()));

revoke execute on function public.clock_in(uuid) from public, anon;
revoke execute on function public.clock_out(uuid) from public, anon;
revoke execute on function public.my_open_time_entry() from public, anon;
revoke execute on function public.edit_time_entry(uuid, timestamp, timestamp, text) from public, anon;
revoke execute on function public.delete_time_entry(uuid) from public, anon;
revoke execute on function public.time_by_job(date, date) from public, anon;
revoke execute on function public.time_by_crew(date, date) from public, anon;
revoke execute on function public.time_by_customer(date, date) from public, anon;
grant execute on function public.clock_in(uuid) to authenticated;
grant execute on function public.clock_out(uuid) to authenticated;
grant execute on function public.my_open_time_entry() to authenticated;
grant execute on function public.edit_time_entry(uuid, timestamp, timestamp, text) to authenticated;
grant execute on function public.delete_time_entry(uuid) to authenticated;
grant execute on function public.time_by_job(date, date) to authenticated;
grant execute on function public.time_by_crew(date, date) to authenticated;
grant execute on function public.time_by_customer(date, date) to authenticated;
