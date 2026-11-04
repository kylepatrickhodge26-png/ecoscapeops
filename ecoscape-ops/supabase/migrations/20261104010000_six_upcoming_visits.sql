-- Repeat services keep 6 *upcoming* visits on the schedule.
--
-- Until now the 6 counted every open visit, including old ones that were never marked done or
-- cancelled. So a customer with four overdue visits had only two upcoming ones, and "Start
-- again" after "Done for the season" brought back only two. Overdue visits still stay where
-- they are (they show as overdue until they're marked done or cancelled); they just no longer
-- take the place of new ones.
--
-- If a service's schedule has fallen behind (every visit it added is in the past), new visits
-- carry on from today on the same cadence instead of being added on days already gone.

create or replace function private.top_up_service_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.service_plans;
  today date;
  upcoming integer;
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
  today := private.business_today(plan.business_id);

  -- Open visits from today on, where the business is. Overdue ones don't count.
  select count(*) into upcoming
  from public.jobs j
  where j.service_plan_id = plan.id
    and j.status not in ('completed', 'cancelled')
    and j.scheduled_date >= today;

  -- Fallen behind: carry on from today, on the same cadence. (A brand-new booking still
  -- starts on its first visit date.)
  if plan.next_visit_date < today and exists (select 1 from public.jobs j where j.service_plan_id = plan.id) then
    plan.next_visit_date := private.next_on_cadence(plan.next_visit_date, step, today, plan.start_date);
  end if;

  while upcoming < 6 loop
    insert into public.jobs (business_id, customer_id, service_plan_id, service_name, price, scheduled_date, assigned_crew_member_id)
    values (plan.business_id, plan.customer_id, plan.id, plan.service_name, plan.price, plan.next_visit_date, plan.assigned_crew_member_id);
    plan.next_visit_date := plan.next_visit_date + step;
    upcoming := upcoming + 1;
  end loop;

  update public.service_plans set next_visit_date = plan.next_visit_date where id = plan.id;
end;
$$;

-- Repeat services that are short of upcoming visits get them now.
do $$
declare
  p record;
begin
  for p in
    select s.id
    from public.service_plans s
    where s.active and not s.paused and s.frequency <> 'one_time' and s.next_visit_date is not null
    order by s.created_at, s.id
  loop
    perform private.top_up_service_plan(p.id);
  end loop;
end;
$$;
