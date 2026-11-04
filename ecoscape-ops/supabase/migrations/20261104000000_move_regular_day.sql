-- "Make Thursday their regular day" when moving a visit now lines their later visits up on the
-- new day's cadence (every week, every other week or every third week after it), instead of
-- moving each one by the same number of days.
--
-- The two only differ when the visit being moved was already off the customer's regular day.
-- That happened to a customer whose Monday visit had been moved to a Thursday once; moving it
-- on to the next Thursday with "their regular day becomes Thursday" slid their later visits a
-- week but left them on Mondays. Now they land on Thursdays, as promised.
--
-- A Sunday can't be a regular day (a customer's preferred day is Monday to Saturday), so
-- asking for that is refused instead of quietly putting their later visits on Sundays. Moving
-- just the one visit to a Sunday is still fine.

create or replace function public.move_visits(job_ids uuid[], new_date date, move_later boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  today date := private.business_today(biz);
  j record;
  step integer;
  moved integer := 0;
  later_total integer;
  later_moved integer;
  shifted_plans uuid[] := '{}';
  note_line text;
  weekday text;
begin
  if move_visits.new_date is null then
    raise exception 'Pick a day' using errcode = '22023';
  end if;
  if move_visits.job_ids is null or cardinality(move_visits.job_ids) = 0 then
    raise exception 'Pick at least one visit' using errcode = '22023';
  end if;
  if cardinality(move_visits.job_ids) > 200 then
    raise exception 'Move at most 200 visits at a time' using errcode = '22023';
  end if;
  if move_visits.new_date < today - 30 or move_visits.new_date > today + 366 then
    raise exception 'Pick a day in the next year (or the last 30 days)' using errcode = '22023';
  end if;
  -- Every visit asked for must be this business's; anything else is "not found".
  if exists (
    select 1 from unnest(move_visits.job_ids) as asked(id)
    where not exists (select 1 from public.jobs x where x.id = asked.id and x.business_id = biz)
  ) then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;
  if move_visits.move_later and extract(isodow from move_visits.new_date) = 7 and exists (
    select 1
    from public.jobs x
    join public.service_plans p on p.id = x.service_plan_id and p.business_id = x.business_id
    where x.id = any(move_visits.job_ids) and x.business_id = biz and p.frequency <> 'one_time'
  ) then
    raise exception 'A Sunday can''t be their regular day. Move just this visit, or pick another day' using errcode = '22023';
  end if;

  for j in
    select x.id, x.scheduled_date, x.service_plan_id, x.customer_id, p.frequency
    from public.jobs x
    join public.service_plans p on p.id = x.service_plan_id and p.business_id = x.business_id
    where x.id = any(move_visits.job_ids)
      and x.business_id = biz
      and x.status not in ('completed', 'cancelled')
      and x.scheduled_date <> move_visits.new_date
    order by x.scheduled_date, x.id
    for update of x
  loop
    note_line := 'Moved from ' || to_char(j.scheduled_date, 'Dy, Mon FMDD');

    update public.jobs x
    set scheduled_date = move_visits.new_date,
        -- A visit that couldn't be done is back on the schedule once it has a new day.
        status = case when x.status = 'unable_to_complete' then 'scheduled'::public.job_status else x.status end,
        notes = left(case when btrim(x.notes) = '' then note_line else btrim(x.notes) || E'\n' || note_line end, 4000)
    where x.id = j.id;
    moved := moved + 1;

    -- The new day becomes their regular day (once per service, even if two of its visits
    -- were picked): their later visits line up on its cadence, one step after it, two steps
    -- after it, and so on, and new visits keep coming on that cadence.
    if move_visits.move_later and j.frequency <> 'one_time' and not (j.service_plan_id = any(shifted_plans)) then
      step := private.frequency_interval_days(j.frequency);

      select count(*) into later_total
      from public.jobs x
      where x.service_plan_id = j.service_plan_id
        and x.business_id = biz
        and x.scheduled_date > j.scheduled_date
        and x.id <> all(move_visits.job_ids)
        and x.status in ('scheduled', 'assigned', 'weather_delay', 'unable_to_complete');

      with later_visits as (
        select x.id, row_number() over (order by x.scheduled_date, x.id) as n
        from public.jobs x
        where x.service_plan_id = j.service_plan_id
          and x.business_id = biz
          and x.scheduled_date > j.scheduled_date
          and x.id <> all(move_visits.job_ids)
          and x.status in ('scheduled', 'assigned', 'weather_delay', 'unable_to_complete')
      )
      update public.jobs x
      set scheduled_date = move_visits.new_date + (l.n * step)::integer
      from later_visits l
      where x.id = l.id
        and x.scheduled_date <> move_visits.new_date + (l.n * step)::integer;
      get diagnostics later_moved = row_count;
      moved := moved + later_moved;

      -- (A stopped service has no next visit, and keeps none.)
      update public.service_plans p
      set next_visit_date = move_visits.new_date + (later_total + 1) * step
      where p.id = j.service_plan_id and p.business_id = biz and p.next_visit_date is not null;
      shifted_plans := shifted_plans || j.service_plan_id;

      weekday := (array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])[extract(isodow from move_visits.new_date)::int];
      update public.customers c set preferred_day = weekday where c.id = j.customer_id and c.business_id = biz;
    end if;
  end loop;

  if moved = 0 then
    raise exception 'Nothing to move: those visits are already on that day, or are completed or cancelled' using errcode = 'P0002';
  end if;
  return moved;
end;
$$;
