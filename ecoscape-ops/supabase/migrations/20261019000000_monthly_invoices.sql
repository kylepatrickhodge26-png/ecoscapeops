-- Monthly invoices: a customer can be billed once a month, with one invoice covering all of
-- that month's completed visits, instead of one invoice per visit.
--
-- The owner presses "Generate invoices" for a month. There is no scheduled job and nothing to
-- pay for. Running it again never double bills: a visit can be on only one live invoice
-- (a database rule), and the generator only picks completed visits that aren't on one.

alter table public.customers add column bill_monthly boolean not null default false;

-- Set on invoices the generator makes: the first day of the month they bill.
alter table public.invoices add column billing_month date;
alter table public.invoices
  add constraint invoices_billing_month_first check (billing_month is null or billing_month = date_trunc('month', billing_month)::date);
create index invoices_billing_month_idx on public.invoices (business_id, customer_id, billing_month) where billing_month is not null;

create function public.set_customer_bill_monthly(customer_id uuid, enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  update public.customers c
  set bill_monthly = coalesce(set_customer_bill_monthly.enabled, false)
  where c.id = set_customer_bill_monthly.customer_id and c.business_id = biz;
  if not found then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
end;
$$;

-- One draft invoice per monthly customer for the month, covering their completed visits that
-- aren't already on a live invoice. If that customer's draft for the month already exists
-- (from an earlier run), new visits are added to it instead of making a second invoice.
-- Returns one row per invoice made or added to.
create function public.generate_monthly_invoices(for_month date)
returns table (invoice_id uuid, customer_id uuid, added_to_existing boolean, visits integer, amount numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  today date := private.business_today(biz);
  month_start date;
  month_end date;
  cust record;
  inv_id uuid;
  existing boolean;
  visit_count integer;
  next_pos integer;
  line_count bigint;
begin
  if for_month is null then
    raise exception 'Choose a month' using errcode = '22023';
  end if;
  month_start := date_trunc('month', for_month)::date;
  month_end := (month_start + interval '1 month - 1 day')::date;
  if month_start > date_trunc('month', today)::date then
    raise exception 'That month hasn''t started yet' using errcode = '22023';
  end if;

  -- One run at a time per business, so two clicks can't both pick the same visits.
  perform pg_advisory_xact_lock(hashtextextended('monthly-invoices:' || biz::text, 0));

  for cust in
    select c.id, c.first_name, c.last_name
    from public.customers c
    where c.business_id = biz and c.bill_monthly
      and exists (
        select 1 from public.jobs j
        where j.business_id = biz and j.customer_id = c.id and j.status = 'completed' and j.price > 0
          and j.scheduled_date between month_start and month_end
          and not exists (select 1 from public.invoice_lines l where l.job_id = j.id and not l.invoice_cancelled)
      )
    order by c.last_name, c.first_name, c.id
  loop
    select i.id into inv_id
    from public.invoices i
    where i.business_id = biz and i.customer_id = cust.id and i.billing_month = month_start and i.status = 'draft'
    order by i.number
    limit 1
    for update;
    existing := inv_id is not null;

    if not existing then
      insert into public.invoices (business_id, customer_id, number, issue_date, due_date, notes, billing_month, created_by)
      values (
        biz, cust.id, private.take_invoice_number(biz), today, today + 14,
        'Services for ' || to_char(month_start, 'FMMonth YYYY'), month_start, (select auth.uid())
      )
      returning id into inv_id;
    end if;

    select coalesce(max(l.position), -1) + 1, count(*) into next_pos, line_count from public.invoice_lines l where l.invoice_id = inv_id;

    insert into public.invoice_lines (business_id, invoice_id, job_id, position, description, quantity, unit_price)
    select biz, inv_id, j.id, next_pos + (row_number() over (order by j.scheduled_date, j.created_at, j.id) - 1)::integer,
           left(j.service_name || ' (' || to_char(j.scheduled_date, 'Dy, Mon FMDD') || ')', 200), 1, j.price
    from public.jobs j
    where j.business_id = biz and j.customer_id = cust.id and j.status = 'completed' and j.price > 0
      and j.scheduled_date between month_start and month_end
      and not exists (select 1 from public.invoice_lines l where l.job_id = j.id and not l.invoice_cancelled)
    order by j.scheduled_date, j.created_at, j.id
    -- An invoice holds at most 100 lines; anything left over is picked up by the next run.
    limit greatest(100 - line_count, 0);
    get diagnostics visit_count = row_count;

    return query
      select inv_id, cust.id, existing, visit_count,
             (select i.total from public.invoices i where i.id = inv_id);
  end loop;
end;
$$;

-- Auto-invoice makes a draft per visit as it's completed. A monthly customer's visits are
-- left for the monthly invoice instead.
create or replace function private.auto_invoice_completed_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date;
  invoice_id uuid;
begin
  if new.price <= 0 or not exists (
    select 1 from public.invoice_settings s where s.business_id = new.business_id and s.auto_invoice
  ) or exists (
    select 1 from public.invoice_lines l where l.job_id = new.id and not l.invoice_cancelled
  ) or exists (
    select 1 from public.customers c where c.id = new.customer_id and c.business_id = new.business_id and c.bill_monthly
  ) then
    return null;
  end if;

  today := private.business_today(new.business_id);
  insert into public.invoices (business_id, customer_id, number, issue_date, due_date, created_by)
  values (new.business_id, new.customer_id, private.take_invoice_number(new.business_id), today, today + 14, (select auth.uid()))
  returning id into invoice_id;

  insert into public.invoice_lines (business_id, invoice_id, job_id, description, quantity, unit_price)
  values (
    new.business_id, invoice_id, new.id,
    left(new.service_name || ' (' || to_char(new.scheduled_date, 'Dy, Mon FMDD') || ')', 200),
    1, new.price
  );
  return null;
end;
$$;

revoke execute on function public.set_customer_bill_monthly(uuid, boolean) from public, anon;
revoke execute on function public.generate_monthly_invoices(date) from public, anon;
grant execute on function public.set_customer_bill_monthly(uuid, boolean) to authenticated;
grant execute on function public.generate_monthly_invoices(date) to authenticated;
