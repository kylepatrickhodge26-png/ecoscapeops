-- Workday clock and one-tap job clock.
--
--   * Workdays (work_shifts): each person clocks in for the day and out at the end, for
--     payroll hours. At most one open workday per person. The owner reads them and can fix or
--     remove one (with a note); crew only ever see their own, through my_clock().
--   * One tap per job: start_job() starts the workday if it isn't started, clocks in to the
--     visit and marks it in progress. finish_job() clocks out and, with complete = true, marks
--     the visit completed. Ending the workday also stops any job clock (the visit stays open).
--   * Forgotten clocks: a clock left running for more than 16 hours is closed the next time
--     that person clocks in (a workday at their last job clock-out, a job a minute after it
--     started) and flagged, so the owner sees it needs fixing, and nobody is stuck.
--   * Same access rules as the job clock: crew can only use visits assigned to them, the owner
--     any visit in their business; nothing crosses businesses.

create table public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Kept (as null) with the name below if the crew member is later removed.
  crew_member_id uuid,
  crew_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text not null default '',
  -- Closed by the app because the person never ended their day (see private.close_stale_clock).
  auto_closed boolean not null default false,
  -- Set when the owner changed the times.
  edited_at timestamptz,
  created_at timestamptz not null default now(),

  foreign key (crew_member_id, business_id) references public.crew_members (id, business_id) on delete set null (crew_member_id),
  constraint work_shifts_end_after_start check (ended_at is null or ended_at > started_at),
  constraint work_shifts_max_length check (ended_at is null or ended_at - started_at <= interval '24 hours'),
  constraint work_shifts_note_length check (char_length(note) <= 500)
);

create index work_shifts_crew_idx on public.work_shifts (crew_member_id, started_at);
create index work_shifts_business_idx on public.work_shifts (business_id, started_at);
-- One open workday per person.
create unique index work_shifts_one_open_per_member on public.work_shifts (crew_member_id) where ended_at is null and crew_member_id is not null;

create trigger work_shifts_business_id_immutable
  before update on public.work_shifts
  for each row execute function private.prevent_business_id_change();

-- Only the owner reads the table; everything crew do is a function.
revoke all on public.work_shifts from anon, authenticated;
grant select on public.work_shifts to authenticated;
alter table public.work_shifts enable row level security;
create policy "Owners can view their crew's workdays"
  on public.work_shifts for select to authenticated
  using (business_id in (select private.owner_business_ids()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's crew record (the owner has one too), or an error.
create function private.my_crew_record()
returns public.crew_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.crew_members;
begin
  select * into me from public.crew_members c where c.user_id = (select auth.uid());
  if not found then
    raise exception 'You are not on a crew' using errcode = '42501';
  end if;
  return me;
end;
$$;

revoke execute on function private.my_crew_record() from public;

-- Closes clocks someone left running for more than 16 hours, and flags them for the owner.
create function private.close_stale_clock(p_member uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- The workday first, ending at the last real clock-out during it.
  update public.work_shifts s
  set ended_at = least(
        s.started_at + interval '24 hours',
        greatest(
          s.started_at + interval '1 minute',
          coalesce(
            (select max(t.ended_at) from public.time_entries t
             where t.crew_member_id = p_member and t.started_at >= s.started_at and t.ended_at is not null),
            s.started_at + interval '1 minute'
          )
        )
      ),
      auto_closed = true,
      note = case when s.note = '' then 'Closed automatically: the day was never ended' else s.note end
  where s.crew_member_id = p_member and s.ended_at is null and s.started_at < now() - interval '16 hours';

  update public.time_entries t
  set ended_at = t.started_at + interval '1 minute',
      note = case when t.note = '' then 'Closed automatically: never clocked out' else t.note end,
      edited_at = now()
  where t.crew_member_id = p_member and t.ended_at is null and t.started_at < now() - interval '16 hours';
end;
$$;

revoke execute on function private.close_stale_clock(uuid) from public;

-- How a customer is named in a message: their name, else phone, else email.
create function private.customer_label(c public.customers)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), nullif(c.phone, ''), nullif(c.email, ''), 'a customer');
$$;

revoke execute on function private.customer_label(public.customers) from public;

-- ---------------------------------------------------------------------------
-- Workday clock (crew and owner)
-- ---------------------------------------------------------------------------
create function public.start_workday()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.crew_members := private.my_crew_record();
  existing uuid;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(me.id::text, 0));
  perform private.close_stale_clock(me.id);
  select s.id into existing from public.work_shifts s where s.crew_member_id = me.id and s.ended_at is null;
  if existing is not null then
    return existing; -- already on the clock; a second tap changes nothing
  end if;
  insert into public.work_shifts (business_id, crew_member_id, crew_name)
  values (me.business_id, me.id, me.name)
  returning id into new_id;
  return new_id;
end;
$$;

-- Ends the day, and stops any job clock that's still running (the visit stays open).
create function public.end_workday()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.crew_members := private.my_crew_record();
begin
  perform pg_advisory_xact_lock(hashtextextended(me.id::text, 0));
  perform private.close_stale_clock(me.id);
  update public.time_entries t
  set ended_at = greatest(now(), t.started_at + interval '1 second')
  where t.crew_member_id = me.id and t.ended_at is null;
  update public.work_shifts s
  set ended_at = greatest(now(), s.started_at + interval '1 second')
  where s.crew_member_id = me.id and s.ended_at is null;
  if not found then
    raise exception 'You haven''t started your day' using errcode = 'P0002';
  end if;
end;
$$;

-- Where the caller stands: their open workday and job clock (nulls when none). One row for
-- anyone on a crew, none otherwise. Crew see this and nothing else about time.
create function public.my_clock()
returns table (workday_started_at timestamptz, job_id uuid, job_started_at timestamptz, service_name text, customer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.started_at, t.job_id, t.started_at, j.service_name, case when c.id is not null then private.customer_label(c) end
  from public.crew_members me
  left join public.work_shifts s
    on s.crew_member_id = me.id and s.ended_at is null and s.started_at >= now() - interval '16 hours'
  left join public.time_entries t
    on t.crew_member_id = me.id and t.ended_at is null and t.started_at >= now() - interval '16 hours'
  left join public.jobs j on j.id = t.job_id and j.business_id = t.business_id
  left join public.customers c on c.id = j.customer_id and c.business_id = j.business_id
  where me.user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- One-tap job clock (crew: their own visits; owner: any visit in the business)
-- ---------------------------------------------------------------------------

-- Clock in to a visit: starts the workday if needed, clocks in, and marks the visit in
-- progress. Tapping again on the same visit changes nothing.
create function public.start_job(job_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.crew_members := private.my_crew_record();
  j public.jobs;
  open_entry public.time_entries;
  other_label text;
  entry_id uuid;
begin
  select * into j from public.jobs x where x.id = start_job.job_id and x.business_id = me.business_id;
  if not found or not private.can_use_job(start_job.job_id) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if j.status in ('cancelled', 'completed') then
    raise exception 'This visit is already %', case j.status when 'cancelled' then 'cancelled' else 'completed' end using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(me.id::text, 0));
  perform private.close_stale_clock(me.id);

  if not exists (select 1 from public.work_shifts s where s.crew_member_id = me.id and s.ended_at is null) then
    insert into public.work_shifts (business_id, crew_member_id, crew_name) values (me.business_id, me.id, me.name);
  end if;

  select * into open_entry from public.time_entries t where t.crew_member_id = me.id and t.ended_at is null;
  if found and open_entry.job_id <> j.id then
    select private.customer_label(c) into other_label
    from public.jobs x join public.customers c on c.id = x.customer_id and c.business_id = x.business_id
    where x.id = open_entry.job_id;
    raise exception 'You''re clocked in at % — clock out there first', coalesce(other_label, 'another visit') using errcode = '23505';
  end if;

  if found then
    entry_id := open_entry.id;
  else
    insert into public.time_entries (business_id, job_id, crew_member_id, crew_name)
    values (me.business_id, j.id, me.id, me.name)
    returning id into entry_id;
  end if;

  update public.jobs x set status = 'in_progress'
  where x.id = j.id and x.status not in ('in_progress', 'completed', 'cancelled');
  return entry_id;
end;
$$;

-- Clock out of a visit. With complete = true it's also marked completed (one tap for "done");
-- without, the visit stays open to come back to. The workday keeps running.
create function public.finish_job(job_id uuid, complete boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.crew_members := private.my_crew_record();
  j public.jobs;
  clocked_out boolean;
begin
  select * into j from public.jobs x where x.id = finish_job.job_id and x.business_id = me.business_id;
  if not found or not private.can_use_job(finish_job.job_id) then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(me.id::text, 0));
  perform private.close_stale_clock(me.id);

  update public.time_entries t
  set ended_at = greatest(now(), t.started_at + interval '1 second')
  where t.crew_member_id = me.id and t.job_id = j.id and t.ended_at is null;
  clocked_out := found;

  if coalesce(finish_job.complete, false) then
    if j.status = 'cancelled' then
      raise exception 'This visit was cancelled' using errcode = '22023';
    end if;
    update public.jobs x set status = 'completed' where x.id = j.id and x.status <> 'completed';
  elsif not clocked_out then
    raise exception 'You''re not clocked in to this visit' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: workday hours, and fixing a workday
-- ---------------------------------------------------------------------------

-- Hours on the clock per person, by the day the workday started (business time). Open
-- workdays aren't counted as hours yet; auto-closed ones are counted but flagged.
create function public.workday_by_crew(from_date date, to_date date)
returns table (crew_member_id uuid, crew_name text, days integer, hours numeric, open_workdays integer, needs_look integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.crew_member_id,
         (array_agg(s.crew_name order by s.started_at desc))[1],
         count(distinct (s.started_at at time zone b.time_zone)::date)::int,
         round(coalesce(sum(extract(epoch from (s.ended_at - s.started_at))) filter (where s.ended_at is not null), 0) / 3600, 2),
         count(*) filter (where s.ended_at is null)::int,
         count(*) filter (where s.auto_closed)::int
  from public.work_shifts s
  join public.businesses b on b.id = s.business_id
  where s.business_id = private.my_owned_business()
    and (s.started_at at time zone b.time_zone)::date between workday_by_crew.from_date and workday_by_crew.to_date
  group by s.crew_member_id, case when s.crew_member_id is null then s.crew_name end
  order by 2;
$$;

-- The times are the business's local clock time (what the owner typed). A note is required.
create function public.edit_work_shift(shift_id uuid, started_local timestamp, ended_local timestamp, note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  tz text;
  s public.work_shifts;
  new_start timestamptz;
  new_end timestamptz;
  why text := btrim(coalesce(edit_work_shift.note, ''));
begin
  select * into s from public.work_shifts w where w.id = edit_work_shift.shift_id and w.business_id = biz for update;
  if not found then
    raise exception 'Workday not found' using errcode = 'P0002';
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
    raise exception 'A workday can''t be longer than 24 hours' using errcode = '22023';
  end if;
  if new_end is null and s.ended_at is not null then
    raise exception 'Enter an end time' using errcode = '22023';
  end if;

  if s.crew_member_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(s.crew_member_id::text, 0));
    if exists (
      select 1 from public.work_shifts o
      where o.crew_member_id = s.crew_member_id and o.id <> s.id
        and tstzrange(o.started_at, coalesce(o.ended_at, 'infinity'::timestamptz)) && tstzrange(new_start, coalesce(new_end, 'infinity'::timestamptz))
    ) then
      raise exception 'That overlaps another workday for the same person' using errcode = '22023';
    end if;
  end if;

  update public.work_shifts w
  set started_at = new_start, ended_at = new_end, note = why, edited_at = now(), auto_closed = false
  where w.id = s.id;
end;
$$;

create function public.delete_work_shift(shift_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.work_shifts w where w.id = delete_work_shift.shift_id and w.business_id = private.my_owned_business();
  if not found then
    raise exception 'Workday not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.start_workday() from public, anon;
revoke execute on function public.end_workday() from public, anon;
revoke execute on function public.my_clock() from public, anon;
revoke execute on function public.start_job(uuid) from public, anon;
revoke execute on function public.finish_job(uuid, boolean) from public, anon;
revoke execute on function public.workday_by_crew(date, date) from public, anon;
revoke execute on function public.edit_work_shift(uuid, timestamp, timestamp, text) from public, anon;
revoke execute on function public.delete_work_shift(uuid) from public, anon;
grant execute on function public.start_workday() to authenticated;
grant execute on function public.end_workday() to authenticated;
grant execute on function public.my_clock() to authenticated;
grant execute on function public.start_job(uuid) to authenticated;
grant execute on function public.finish_job(uuid, boolean) to authenticated;
grant execute on function public.workday_by_crew(date, date) to authenticated;
grant execute on function public.edit_work_shift(uuid, timestamp, timestamp, text) to authenticated;
grant execute on function public.delete_work_shift(uuid) to authenticated;
