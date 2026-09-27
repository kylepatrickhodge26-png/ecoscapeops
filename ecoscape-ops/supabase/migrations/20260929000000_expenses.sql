-- EcoScape Ops expenses: a categorized log of what the business spends, following the
-- prototype's expense log. Owner-only: crew members (and everyone outside the business)
-- can never read or write expenses. This month's total feeds the dashboard's estimated
-- profit.

create type public.expense_category as enum (
  'fuel',
  'equipment',
  'repairs',
  'materials',
  'fertilizer',
  'mulch',
  'payroll',
  'insurance',
  'advertising',
  'vehicle',
  'other'
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  spent_on date not null,
  category public.expense_category not null,
  amount numeric(10, 2) not null,
  vendor text not null default '',
  notes text not null default '',
  -- Who logged it.
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expenses_amount_range check (amount > 0 and amount <= 999999.99),
  constraint expenses_vendor_length check (char_length(vendor) <= 120),
  constraint expenses_notes_length check (char_length(notes) <= 1000)
);

create index expenses_business_date_idx on public.expenses (business_id, spent_on);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function private.set_updated_at();

create trigger expenses_business_id_immutable
  before update on public.expenses
  for each row execute function private.prevent_business_id_change();

revoke all on public.expenses from anon, authenticated;
-- Column grants: created_by always comes from the default (the signed-in user), and a
-- row's business can't be changed.
grant select, delete on public.expenses to authenticated;
grant insert (business_id, spent_on, category, amount, vendor, notes) on public.expenses to authenticated;
grant update (spent_on, category, amount, vendor, notes) on public.expenses to authenticated;

alter table public.expenses enable row level security;

create policy "Owners can view their expenses"
  on public.expenses for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can log expenses"
  on public.expenses for insert
  to authenticated
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can update their expenses"
  on public.expenses for update
  to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can delete their expenses"
  on public.expenses for delete
  to authenticated
  using (business_id in (select private.owner_business_ids()));

-- ---------------------------------------------------------------------------
-- Dashboard: add this month's expenses (owners only, like the other money fields).
-- ---------------------------------------------------------------------------
drop function public.dashboard_summary();

create function public.dashboard_summary()
returns table (
  today date,
  today_total integer,
  today_completed integer,
  tomorrow_total integer,
  week_total integer,
  month_booked numeric,
  month_completed numeric,
  month_expenses numeric
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
  expenses_total numeric;
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

  if caller_role = 'owner' then
    select coalesce(sum(e.amount), 0) into expenses_total
    from public.expenses e
    where e.business_id = caller_business and e.spent_on between month_start and month_end;
  end if;

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
    end,
    expenses_total -- null for crew
  from scoped s;
end;
$$;

revoke execute on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;
