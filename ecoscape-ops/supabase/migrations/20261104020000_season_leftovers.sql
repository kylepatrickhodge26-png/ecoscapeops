-- Done for the season also cancels the customer's earlier repeat visits that were never marked
-- done: ones on a day before today that are still scheduled, assigned, weather-delayed or
-- marked couldn't-be-done. Until now those stayed, so a customer who was done for the season
-- could still be on the schedule (an old overdue visit). Each gets a note, "Cancelled: done for
-- the season".
--
-- They're cancelled, not removed, so the history stays, and the owner can still set one to
-- Completed (Edit → Status) if it was done after all. One-time jobs and visits that were
-- started are left as they are. Marking the customer active again doesn't bring them back.

create or replace function private.customer_status_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := private.business_today(new.business_id);
  plan public.service_plans;
  last_kept date;
begin
  if new.status = 'inactive' then
    -- The rule trigger sets paused; touching the plans is enough.
    update public.service_plans p set paused = true
    where p.customer_id = new.id and p.business_id = new.business_id and p.frequency <> 'one_time';

    -- Upcoming repeat visits that haven't started come off the schedule. Visits under way or
    -- done stay, and so do one-time jobs.
    delete from public.jobs j
    using public.service_plans p
    where p.id = j.service_plan_id and p.business_id = j.business_id
      and j.customer_id = new.id and j.business_id = new.business_id
      and p.frequency <> 'one_time'
      and j.scheduled_date >= today
      and j.status in ('scheduled', 'assigned', 'weather_delay');

    -- Earlier repeat visits that were never done are cancelled (their services are paused,
    -- so this adds no visits).
    update public.jobs j
    set status = 'cancelled',
        notes = left(case when btrim(j.notes) = '' then 'Cancelled: done for the season'
                          else btrim(j.notes) || E'\n' || 'Cancelled: done for the season' end, 4000)
    from public.service_plans p
    where p.id = j.service_plan_id and p.business_id = j.business_id
      and j.customer_id = new.id and j.business_id = new.business_id
      and p.frequency <> 'one_time'
      and j.scheduled_date < today
      and j.status in ('scheduled', 'assigned', 'weather_delay', 'unable_to_complete');

  elsif new.status = 'active' then
    for plan in
      select * from public.service_plans p
      where p.customer_id = new.id and p.business_id = new.business_id
        and p.frequency <> 'one_time' and p.active and p.paused
      order by p.created_at, p.id
      for update
    loop
      -- Back on their regular day, from the next one on or after today, and after any of
      -- this service's visits that were kept (one under way or done today isn't doubled).
      select max(j.scheduled_date) into last_kept from public.jobs j where j.service_plan_id = plan.id;
      update public.service_plans p
      set paused = false,
          next_visit_date = private.next_on_cadence(
            coalesce(plan.next_visit_date, plan.start_date),
            private.frequency_interval_days(plan.frequency),
            greatest(today, coalesce(last_kept + 1, today)),
            plan.start_date)
      where p.id = plan.id;
      perform private.top_up_service_plan(plan.id);
    end loop;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customers already done for the season get the same treatment now.
-- ---------------------------------------------------------------------------
update public.jobs j
set status = 'cancelled',
    notes = left(case when btrim(j.notes) = '' then 'Cancelled: done for the season'
                      else btrim(j.notes) || E'\n' || 'Cancelled: done for the season' end, 4000)
from public.service_plans p, public.customers c
where p.id = j.service_plan_id and p.business_id = j.business_id
  and c.id = j.customer_id and c.business_id = j.business_id
  and c.status = 'inactive'
  and p.frequency <> 'one_time'
  and j.scheduled_date < private.business_today(j.business_id)
  and j.status in ('scheduled', 'assigned', 'weather_delay', 'unable_to_complete');
