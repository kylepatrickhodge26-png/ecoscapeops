-- Moving visits to another day, made easy: one visit or several at once, to any day, with
-- the option to move that customer's later visits by the same number of days (which also
-- makes the new weekday their regular day).
--
-- Owner only. Completed and cancelled visits never move. Each moved visit gets a note
-- ("Moved from Mon, Oct 26") so everyone can see what happened.

create function public.move_visits(job_ids uuid[], new_date date, move_later boolean default false)
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
  delta integer;
  moved integer := 0;
  later integer;
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
    delta := move_visits.new_date - j.scheduled_date;
    note_line := 'Moved from ' || to_char(j.scheduled_date, 'Dy, Mon FMDD');

    update public.jobs x
    set scheduled_date = move_visits.new_date,
        -- A visit that couldn't be done is back on the schedule once it has a new day.
        status = case when x.status = 'unable_to_complete' then 'scheduled'::public.job_status else x.status end,
        notes = left(case when btrim(x.notes) = '' then note_line else btrim(x.notes) || E'\n' || note_line end, 4000)
    where x.id = j.id;
    moved := moved + 1;

    -- Their later visits move by the same number of days (once per service, even if two of
    -- its visits were picked), and the new weekday becomes their regular day.
    if move_visits.move_later and j.frequency <> 'one_time' and not (j.service_plan_id = any(shifted_plans)) then
      update public.jobs x
      set scheduled_date = x.scheduled_date + delta
      where x.service_plan_id = j.service_plan_id
        and x.business_id = biz
        and x.scheduled_date > j.scheduled_date
        and x.id <> all(move_visits.job_ids)
        and x.status in ('scheduled', 'assigned', 'weather_delay', 'unable_to_complete');
      get diagnostics later = row_count;
      moved := moved + later;

      update public.service_plans p
      set next_visit_date = p.next_visit_date + delta
      where p.id = j.service_plan_id and p.business_id = biz;
      shifted_plans := shifted_plans || j.service_plan_id;

      weekday := (array['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])[extract(isodow from move_visits.new_date)::int];
      if weekday <> 'sunday' then
        update public.customers c set preferred_day = weekday where c.id = j.customer_id and c.business_id = biz;
      end if;
    end if;
  end loop;

  if moved = 0 then
    raise exception 'Nothing to move: those visits are already on that day, or are completed or cancelled' using errcode = 'P0002';
  end if;
  return moved;
end;
$$;

revoke execute on function public.move_visits(uuid[], date, boolean) from public, anon;
grant execute on function public.move_visits(uuid[], date, boolean) to authenticated;
