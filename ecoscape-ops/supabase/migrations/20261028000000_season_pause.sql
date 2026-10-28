-- Done for the season: marking a customer inactive pauses their repeat services and takes
-- their upcoming repeat visits off the schedule; marking them active again brings the visits
-- back on their regular day. One-time jobs are never touched.
--
-- A service plan is "paused" exactly when it repeats and its customer is inactive. The
-- database keeps that true on every insert and update, so no other path (booking, accepting a
-- quote, a hand-made API call) can leave a paused customer with repeat visits.

alter table public.service_plans add column paused boolean not null default false;

comment on column public.service_plans.paused is
  'True while the customer is inactive (done for the season). Set by the database only. A paused plan adds no visits.';

-- ---------------------------------------------------------------------------
-- paused follows the customer's status, whatever was sent
-- ---------------------------------------------------------------------------
create function private.service_plan_paused_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.paused := new.frequency <> 'one_time' and exists (
    select 1 from public.customers c
    where c.id = new.customer_id and c.business_id = new.business_id and c.status = 'inactive'
  );
  return new;
end;
$$;

revoke execute on function private.service_plan_paused_rule() from public;

-- Named to run after service_plans_set_first_visit (triggers fire in name order).
create trigger service_plans_set_paused
  before insert or update on public.service_plans
  for each row execute function private.service_plan_paused_rule();

-- ---------------------------------------------------------------------------
-- Visit generation skips paused plans (same as the crew version, plus "paused")
-- ---------------------------------------------------------------------------
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
  if not found or not plan.active or plan.paused or plan.next_visit_date is null then
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

-- The first day on a plan's cadence that is on or after both from_day and the plan's first
-- visit. The cadence is anchored on a date the plan would visit (its next visit date), which
-- follows any "move their later visits too" the owner has done.
create function private.next_on_cadence(anchor date, step integer, from_day date, first_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select anchor + (ceil((greatest(from_day, first_day) - anchor)::numeric / step))::integer * step;
$$;

revoke execute on function private.next_on_cadence(date, integer, date, date) from public;

-- ---------------------------------------------------------------------------
-- Marking a customer inactive or active
-- ---------------------------------------------------------------------------
create function private.customer_status_changed()
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

    -- Upcoming repeat visits that haven't started come off the schedule. Visits under way,
    -- done or in the past stay, and so do one-time jobs.
    delete from public.jobs j
    using public.service_plans p
    where p.id = j.service_plan_id and p.business_id = j.business_id
      and j.customer_id = new.id and j.business_id = new.business_id
      and p.frequency <> 'one_time'
      and j.scheduled_date >= today
      and j.status in ('scheduled', 'assigned', 'weather_delay');

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

revoke execute on function private.customer_status_changed() from public;

create trigger customers_pause_or_resume_services
  after update of status on public.customers
  for each row
  when (old.status is distinct from new.status)
  execute function private.customer_status_changed();

-- ---------------------------------------------------------------------------
-- Customers already marked inactive get the same treatment now.
-- ---------------------------------------------------------------------------
update public.service_plans p set paused = true
where p.frequency <> 'one_time'
  and exists (select 1 from public.customers c where c.id = p.customer_id and c.business_id = p.business_id and c.status = 'inactive');

delete from public.jobs j
using public.service_plans p, public.customers c
where p.id = j.service_plan_id and p.business_id = j.business_id
  and c.id = j.customer_id and c.business_id = j.business_id
  and c.status = 'inactive'
  and p.frequency <> 'one_time'
  and j.scheduled_date >= private.business_today(j.business_id)
  and j.status in ('scheduled', 'assigned', 'weather_delay');
