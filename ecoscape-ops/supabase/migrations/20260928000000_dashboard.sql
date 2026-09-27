-- EcoScape Ops dashboard: one role-aware summary of what's already in the schedule.
--
--   * Owners get business-wide numbers, including money.
--   * Crew members get counts of their own assigned jobs only, and no money at all
--     (they never see prices).
--   * "Today", "tomorrow", "this week" (today + the next 6 days) and "this month" are
--     all in the business's time zone. Cancelled visits never count.
--   * Revenue counts every non-cancelled visit booked this month at its price, whether
--     or not it's completed yet (most small operators don't invoice every visit), plus
--     how much of that is already completed.

create function public.dashboard_summary()
returns table (
  today date,
  today_total integer,
  today_completed integer,
  tomorrow_total integer,
  week_total integer,
  month_booked numeric,
  month_completed numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_business uuid;
  caller_role public.business_role;
  caller_crew_member uuid;
  t date;
  month_start date;
  month_end date;
begin
  select m.business_id, m.role into caller_business, caller_role
  from public.business_members m
  where m.user_id = caller;
  if caller_business is null then
    return; -- not signed in, or no business: no summary
  end if;

  select (now() at time zone b.time_zone)::date into t
  from public.businesses b where b.id = caller_business;
  month_start := date_trunc('month', t)::date;
  month_end := (date_trunc('month', t) + interval '1 month - 1 day')::date;

  select c.id into caller_crew_member from public.crew_members c where c.user_id = caller;

  return query
  with scoped as (
    select j.scheduled_date, j.status, j.price
    from public.jobs j
    where j.business_id = caller_business
      -- Owners see the whole business; crew only what's assigned to them.
      and (caller_role = 'owner' or j.assigned_crew_member_id = caller_crew_member)
      and j.status <> 'cancelled'
      and j.scheduled_date between least(t, month_start) and greatest(t + 6, month_end)
  )
  select
    t,
    (count(*) filter (where s.scheduled_date = t))::integer,
    (count(*) filter (where s.scheduled_date = t and s.status = 'completed'))::integer,
    (count(*) filter (where s.scheduled_date = t + 1))::integer,
    (count(*) filter (where s.scheduled_date between t and t + 6))::integer,
    case when caller_role = 'owner' then
      coalesce(sum(s.price) filter (where s.scheduled_date between month_start and month_end), 0)
    end,
    case when caller_role = 'owner' then
      coalesce(sum(s.price) filter (where s.scheduled_date between month_start and month_end and s.status = 'completed'), 0)
    end
  from scoped s;
end;
$$;

revoke execute on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;
