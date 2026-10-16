-- Reports (owner only): revenue by month / customer / service, what's owed, expenses by
-- category, profit, and visits completed per crew member.
--
-- Nothing here is stored: every figure is worked out from the existing tables when asked, and
-- every function checks the caller owns the business and only reads that business's rows.
-- Crew members and signed-out visitors can't call them.
--
-- Revenue never double counts. A visit counts once, at its price, or at its invoiced amount
-- once it is on a sent invoice (so billing a visit doesn't add a second copy of it). Lines on
-- sent invoices that aren't a booked visit (extras, or a visit that was later cancelled) count
-- once, on the invoice's issue date. This is the same rule the dashboard uses.

-- One row per amount of revenue: its day, customer, service, value and whether it's done.
create function private.revenue_items(biz uuid, from_date date, to_date date)
returns table (day date, customer_id uuid, service_name text, value numeric, completed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select j.scheduled_date,
         j.customer_id,
         j.service_name,
         coalesce(
           (select sum(l.amount)
            from public.invoice_lines l
            join public.invoices i on i.id = l.invoice_id and i.business_id = l.business_id
            where l.job_id = j.id and l.business_id = biz and not l.invoice_cancelled and i.status = 'sent'),
           j.price
         ),
         j.status = 'completed'
  from public.jobs j
  where j.business_id = biz
    and j.status <> 'cancelled'
    and j.scheduled_date between from_date and to_date
  union all
  select i.issue_date, i.customer_id, l.description, l.amount, true
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id and i.business_id = l.business_id
  left join public.jobs j on j.id = l.job_id and j.business_id = l.business_id
  where i.business_id = biz
    and i.status = 'sent'
    and i.issue_date between from_date and to_date
    and (j.id is null or j.status = 'cancelled');
$$;

revoke execute on function private.revenue_items(uuid, date, date) from public;

-- The owner's business, after checking the date range.
create function private.report_business(from_date date, to_date date)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  if from_date is null or to_date is null or from_date > to_date then
    raise exception 'Choose a start date that is on or before the end date' using errcode = '22023';
  end if;
  if to_date - from_date > 1830 then
    raise exception 'Choose a range of five years or less' using errcode = '22023';
  end if;
  return biz;
end;
$$;

revoke execute on function private.report_business(date, date) from public;

create function public.report_summary(from_date date, to_date date)
returns table (
  booked numeric,
  completed numeric,
  collected numeric,
  expenses numeric,
  outstanding numeric,
  overdue numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
  t date := private.business_today(biz);
begin
  return query
  select
    coalesce((select sum(r.value) from private.revenue_items(biz, from_date, to_date) r), 0),
    coalesce((select sum(r.value) from private.revenue_items(biz, from_date, to_date) r where r.completed), 0),
    coalesce((select sum(p.amount) from public.payments p where p.business_id = biz and p.received_on between from_date and to_date), 0),
    coalesce((select sum(e.amount) from public.expenses e where e.business_id = biz and e.spent_on between from_date and to_date), 0),
    -- What's owed right now, whatever the range.
    coalesce((select sum(i.total - i.amount_paid) from public.invoices i
              where i.business_id = biz and i.status = 'sent' and i.amount_paid < i.total), 0),
    coalesce((select sum(i.total - i.amount_paid) from public.invoices i
              where i.business_id = biz and i.status = 'sent' and i.amount_paid < i.total and i.due_date < t), 0);
end;
$$;

create function public.report_revenue_by_month(from_date date, to_date date)
returns table (month date, booked numeric, completed numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select date_trunc('month', r.day)::date,
         sum(r.value),
         coalesce(sum(r.value) filter (where r.completed), 0)
  from private.revenue_items(biz, from_date, to_date) r
  group by 1
  order by 1;
end;
$$;

create function public.report_revenue_by_customer(from_date date, to_date date)
returns table (customer_id uuid, customer_name text, booked numeric, completed numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select r.customer_id,
         coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), nullif(c.phone, ''), nullif(c.email, ''), 'Customer'),
         sum(r.value),
         coalesce(sum(r.value) filter (where r.completed), 0)
  from private.revenue_items(biz, from_date, to_date) r
  join public.customers c on c.id = r.customer_id and c.business_id = biz
  group by r.customer_id, c.first_name, c.last_name, c.phone, c.email
  order by 4 desc, 3 desc, 2
  limit 500;
end;
$$;

create function public.report_revenue_by_service(from_date date, to_date date)
returns table (service_name text, booked numeric, completed numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select min(r.service_name),
         sum(r.value),
         coalesce(sum(r.value) filter (where r.completed), 0)
  from private.revenue_items(biz, from_date, to_date) r
  group by lower(btrim(r.service_name))
  order by 3 desc, 2 desc, 1
  limit 500;
end;
$$;

create function public.report_expenses_by_category(from_date date, to_date date)
returns table (category public.expense_category, total numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select e.category, sum(e.amount)
  from public.expenses e
  where e.business_id = biz and e.spent_on between from_date and to_date
  group by e.category
  order by 2 desc, 1;
end;
$$;

-- Visits completed per crew member (the owner is on the crew too). Visits nobody is
-- assigned to are listed as "Unassigned".
create function public.report_jobs_by_crew(from_date date, to_date date)
returns table (crew_member_id uuid, crew_name text, completed bigint, scheduled bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  biz uuid := private.report_business(from_date, to_date);
begin
  return query
  select j.assigned_crew_member_id,
         coalesce(c.name, 'Unassigned'),
         count(*) filter (where j.status = 'completed'),
         count(*)
  from public.jobs j
  left join public.crew_members c on c.id = j.assigned_crew_member_id and c.business_id = biz
  where j.business_id = biz
    and j.status <> 'cancelled'
    and j.scheduled_date between from_date and to_date
  group by j.assigned_crew_member_id, c.name
  order by 3 desc, 2;
end;
$$;

revoke execute on function public.report_summary(date, date) from public, anon;
revoke execute on function public.report_revenue_by_month(date, date) from public, anon;
revoke execute on function public.report_revenue_by_customer(date, date) from public, anon;
revoke execute on function public.report_revenue_by_service(date, date) from public, anon;
revoke execute on function public.report_expenses_by_category(date, date) from public, anon;
revoke execute on function public.report_jobs_by_crew(date, date) from public, anon;
grant execute on function public.report_summary(date, date) to authenticated;
grant execute on function public.report_revenue_by_month(date, date) to authenticated;
grant execute on function public.report_revenue_by_customer(date, date) to authenticated;
grant execute on function public.report_revenue_by_service(date, date) to authenticated;
grant execute on function public.report_expenses_by_category(date, date) to authenticated;
grant execute on function public.report_jobs_by_crew(date, date) to authenticated;
