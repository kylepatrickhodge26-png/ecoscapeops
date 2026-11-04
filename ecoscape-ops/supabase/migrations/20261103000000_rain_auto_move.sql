-- Rain days, handled for you: the business's work hours (so the calendar can mark "rain likely
-- 10am–2pm" for the hours the crew is out), and an option to move a rainy day's repeat visits
-- (weekly mowing and the like) to the next dry day on their own. The app reads the hourly
-- forecast (the database can't see the weather) and asks auto_rain_move() below to move a
-- day; the database decides what moves. Every rain delay can be undone.
--
--   * businesses.work_start / work_end: when the crew works. Rain outside these hours doesn't
--     count. The app checks after work the day before, and in the morning before work.
--   * businesses.rain_auto_move: the owner's on/off switch. Off until they turn it on.
--   * rain_delays.automatic / rain_window: a move the app made on its own, and when rain was
--     likely ("10am–2pm"). At most one per business and day, so the app never moves a day
--     twice, even after the owner undoes it.
--   * rain_delays.undone_at and rain_delay_visits.previous_status: for Undo, on automatic and
--     hand-made rain delays alike.

-- ---------------------------------------------------------------------------
-- Work hours and the on/off switch
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column work_start time not null default '08:00',
  add column work_end time not null default '16:00',
  add column rain_auto_move boolean not null default false,
  -- On the quarter hour, between 4 AM and 10 PM, starting before they end.
  add constraint businesses_work_hours check (
    work_start < work_end
    and work_start >= '04:00' and work_end <= '22:00'
    and extract(epoch from work_start)::integer % 900 = 0
    and extract(epoch from work_end)::integer % 900 = 0
  );

comment on column public.businesses.work_start is 'When the crew starts work, where the business is. Rain before then doesn''t count.';
comment on column public.businesses.work_end is 'When the crew finishes work. Rain after then doesn''t count.';
comment on column public.businesses.rain_auto_move is 'Move a day''s repeat visits to the next dry day when rain is likely during work hours.';

-- Owners change these like the business name (the update policy on businesses is owners only).
grant update (work_start, work_end, rain_auto_move) on public.businesses to authenticated;

-- ---------------------------------------------------------------------------
-- Rain delays: automatic ones, and undo
-- ---------------------------------------------------------------------------
alter table public.rain_delays
  add column automatic boolean not null default false,
  add column rain_window text not null default '',
  add column undone_at timestamptz,
  add constraint rain_delays_rain_window_length check (char_length(rain_window) <= 60);

create unique index rain_delays_one_automatic_per_day on public.rain_delays (business_id, from_date) where automatic;

-- What each visit's status was before the move, so Undo can put it back. (Empty for rain
-- delays made before this.)
alter table public.rain_delay_visits add column previous_status public.job_status;

-- Moving a day's visits by hand: as before, and now it also remembers each visit's status
-- (for Undo) and keeps notes within their limit.
create or replace function public.move_day_visits(from_date date, to_date date)
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

  with picked as (
    select j.id, j.status
    from public.jobs j
    where j.business_id = biz
      and j.scheduled_date = move_day_visits.from_date
      and j.status not in ('completed', 'cancelled')
    for update
  ),
  moved_jobs as (
    update public.jobs j
    set scheduled_date = move_day_visits.to_date,
        status = 'weather_delay',
        notes = left(case when btrim(j.notes) = '' then note_line else btrim(j.notes) || E'\n' || note_line end, 4000)
    from picked p
    where j.id = p.id
    returning j.id, p.status
  )
  insert into public.rain_delay_visits (rain_delay_id, job_id, business_id, previous_status)
  select delay_id, mj.id, biz, mj.status from moved_jobs mj;
  get diagnostics moved = row_count;

  if moved = 0 then
    -- Rolls back the rain delay inserted above.
    raise exception 'There are no visits to move on that day' using errcode = 'P0002';
  end if;

  return delay_id;
end;
$$;

-- The app's automatic move: when rain is likely during work hours on rain_day, that day's
-- repeat visits that haven't started go to move_to (the app picks the next dry work day), are
-- marked Weather delay, and get a note. One-time jobs stay put: those are the owner's call.
--
-- Only with the switch on, only for today or tomorrow, never to or from a Sunday, and only
-- once per day: if the app already moved that day (even if the owner undid it), nothing
-- happens. Returns the rain delay's id, or null when nothing moved.
create function public.auto_rain_move(rain_day date, move_to date, rain_hours text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  today date := private.business_today(biz);
  hours text := btrim(coalesce(auto_rain_move.rain_hours, ''));
  delay_id uuid;
  note_line text;
begin
  if not (select b.rain_auto_move from public.businesses b where b.id = biz) then
    raise exception 'Moving visits for rain automatically is turned off' using errcode = '42501';
  end if;
  if auto_rain_move.rain_day is null or auto_rain_move.move_to is null then
    raise exception 'Choose both days' using errcode = '22023';
  end if;
  if auto_rain_move.rain_day < today or auto_rain_move.rain_day > today + 1 then
    raise exception 'Only today''s or tomorrow''s visits move automatically' using errcode = '22023';
  end if;
  if auto_rain_move.move_to <= auto_rain_move.rain_day or auto_rain_move.move_to > auto_rain_move.rain_day + 7 then
    raise exception 'The new day must be in the week after' using errcode = '22023';
  end if;
  if extract(isodow from auto_rain_move.rain_day) = 7 or extract(isodow from auto_rain_move.move_to) = 7 then
    raise exception 'Nothing moves to or from a Sunday automatically' using errcode = '22023';
  end if;
  if char_length(hours) > 60 then
    raise exception 'Say when it will rain in 60 characters or fewer' using errcode = '22023';
  end if;

  -- The app moves a day once; after that it's the owner's call.
  if exists (
    select 1 from public.rain_delays d
    where d.business_id = biz and d.from_date = auto_rain_move.rain_day and d.automatic
  ) then
    return null;
  end if;

  -- Nothing waiting to move: nothing is recorded, so a visit booked later is still looked after.
  if not exists (
    select 1
    from public.jobs j
    join public.service_plans p on p.id = j.service_plan_id and p.business_id = j.business_id
    where j.business_id = biz
      and j.scheduled_date = auto_rain_move.rain_day
      and p.frequency <> 'one_time'
      and j.status in ('scheduled', 'assigned', 'weather_delay')
  ) then
    return null;
  end if;

  insert into public.rain_delays (business_id, from_date, to_date, created_by, automatic, rain_window)
  values (biz, auto_rain_move.rain_day, auto_rain_move.move_to, (select auth.uid()), true, hours)
  on conflict (business_id, from_date) where automatic do nothing
  returning id into delay_id;
  -- Another check moved this day at the same moment.
  if delay_id is null then
    return null;
  end if;

  note_line := 'Moved from ' || to_char(auto_rain_move.rain_day, 'Dy, Mon FMDD') || ' due to rain'
    || case when hours <> '' then ' (likely ' || hours || ')' else '' end;

  with picked as (
    select j.id, j.status
    from public.jobs j
    join public.service_plans p on p.id = j.service_plan_id and p.business_id = j.business_id
    where j.business_id = biz
      and j.scheduled_date = auto_rain_move.rain_day
      and p.frequency <> 'one_time'
      and j.status in ('scheduled', 'assigned', 'weather_delay')
    for update of j
  ),
  moved_jobs as (
    update public.jobs j
    set scheduled_date = auto_rain_move.move_to,
        status = 'weather_delay',
        notes = left(case when btrim(j.notes) = '' then note_line else btrim(j.notes) || E'\n' || note_line end, 4000)
    from picked p
    where j.id = p.id
    returning j.id, p.status
  )
  insert into public.rain_delay_visits (rain_delay_id, job_id, business_id, previous_status)
  select delay_id, mj.id, biz, mj.status from moved_jobs mj;

  return delay_id;
end;
$$;

revoke execute on function public.auto_rain_move(date, date, text) from public, anon;
grant execute on function public.auto_rain_move(date, date, text) to authenticated;

-- Undo a rain delay (automatic or by hand) while its day is still ahead: the visits still
-- waiting on the new day go back to their old day and status, and lose the move's note. Any
-- started, done, cancelled or moved again since stay where they are. Returns how many went
-- back.
create function public.undo_rain_delay(rain_delay_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  delay public.rain_delays;
  note_pattern text;
  moved_back integer;
begin
  select * into delay
  from public.rain_delays d
  where d.id = undo_rain_delay.rain_delay_id and d.business_id = biz
  for update;
  if not found then
    raise exception 'Rain delay not found' using errcode = 'P0002';
  end if;
  if delay.undone_at is not null then
    raise exception 'This rain delay was already undone' using errcode = '22023';
  end if;
  if delay.from_date < private.business_today(biz) then
    raise exception 'That day has passed, so this can''t be undone' using errcode = '22023';
  end if;

  -- The note line the move added, when it's still the last line of the notes.
  note_pattern := '(^|\n)Moved from ' || to_char(delay.from_date, 'Dy, Mon FMDD') || ' due to [^\n]*$';

  with back as (
    update public.jobs j
    set scheduled_date = delay.from_date,
        status = coalesce(v.previous_status, 'scheduled'),
        notes = regexp_replace(j.notes, note_pattern, '')
    from public.rain_delay_visits v
    where v.rain_delay_id = delay.id
      and v.business_id = biz
      and j.id = v.job_id
      and j.business_id = biz
      and j.scheduled_date = delay.to_date
      and j.status = 'weather_delay'
    returning j.id
  )
  select count(*) into moved_back from back;

  update public.rain_delays d set undone_at = now() where d.id = delay.id;
  return moved_back;
end;
$$;

revoke execute on function public.undo_rain_delay(uuid) from public, anon;
grant execute on function public.undo_rain_delay(uuid) to authenticated;
