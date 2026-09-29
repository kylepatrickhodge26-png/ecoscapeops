-- EcoScape Ops invoicing: invoices built from visits and/or free-form lines, cash and
-- check payments recorded by the owner, and card / bank payments through Stripe.
--
--   * Statuses. The owner moves an invoice through draft → sent (or cancels it). Partial
--     and paid come from the payments recorded, and overdue from the due date, every time
--     they're read (display_status), so none of them can go stale.
--   * A visit can be on only one live (not cancelled) invoice, so it's never billed twice.
--   * Numbers run from 1001 per business, like the prototype.
--   * Stripe (Connect): each business connects its own Stripe account and customers pay on
--     Stripe's hosted Checkout page, charged directly to that business's account. Card
--     numbers never reach EcoScape Ops. A payment is recorded from Stripe's webhook, at most
--     once per checkout, and only for checkouts EcoScape Ops itself started on that
--     business's own account.
--   * Owners read invoices, lines and payments through RLS but never write them directly:
--     every change goes through the functions below, which enforce the rules. Crew members
--     get nothing (they never see money). Stripe bookkeeping is written only by the
--     service role (the app's server, for Stripe's webhooks and onboarding).
--   * The dashboard counts each visit once: at its invoiced amount once it's on a sent
--     invoice, otherwise at its booked price. Invoice lines that aren't visits count in the
--     month the invoice was issued.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table public.invoice_settings (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  auto_invoice boolean not null default false,
  next_number integer not null default 1001,
  updated_at timestamptz not null default now(),
  constraint invoice_settings_next_number_positive check (next_number > 0)
);

create trigger invoice_settings_set_updated_at
  before update on public.invoice_settings
  for each row execute function private.set_updated_at();

create trigger invoice_settings_business_id_immutable
  before update on public.invoice_settings
  for each row execute function private.prevent_business_id_change();

-- The business's next invoice number, taken atomically (the row lock makes concurrent
-- invoices wait their turn).
create function private.take_invoice_number(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  taken integer;
begin
  insert into public.invoice_settings (business_id) values (p_business_id) on conflict do nothing;
  update public.invoice_settings
  set next_number = next_number + 1
  where business_id = p_business_id
  returning next_number - 1 into taken;
  return taken;
end;
$$;

revoke execute on function private.take_invoice_number(uuid) from public;

-- ---------------------------------------------------------------------------
-- Invoices and their lines
-- ---------------------------------------------------------------------------
create type public.invoice_status as enum ('draft', 'sent', 'cancelled');

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,
  number integer not null,
  status public.invoice_status not null default 'draft',
  issue_date date not null,
  due_date date not null,
  notes text not null default '',
  -- Kept in step with the lines and payments by triggers.
  total numeric(12, 2) not null default 0,
  amount_paid numeric(12, 2) not null default 0,
  -- The secret in the customer's pay link (/pay/<token>). Only the owner can read it.
  pay_token text not null unique default private.new_invite_token(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade,
  constraint invoices_id_business_unique unique (id, business_id),
  constraint invoices_number_unique unique (business_id, number),
  constraint invoices_number_positive check (number > 0),
  constraint invoices_due_after_issue check (due_date >= issue_date),
  constraint invoices_notes_length check (char_length(notes) <= 1000)
);

create index invoices_business_idx on public.invoices (business_id, issue_date desc);
create index invoices_customer_idx on public.invoices (business_id, customer_id);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function private.set_updated_at();

create trigger invoices_business_id_immutable
  before update on public.invoices
  for each row execute function private.prevent_business_id_change();

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null,
  -- The visit this line bills, if any. Kept (without the visit) if the visit is deleted.
  job_id uuid,
  position integer not null default 0,
  description text not null,
  quantity numeric(8, 2) not null default 1,
  unit_price numeric(10, 2) not null,
  amount numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,
  -- Mirrors the invoice being cancelled, so the index below can free its visits.
  invoice_cancelled boolean not null default false,

  foreign key (invoice_id, business_id) references public.invoices (id, business_id) on delete cascade,
  foreign key (job_id, business_id) references public.jobs (id, business_id) on delete set null (job_id),
  constraint invoice_lines_description_length check (char_length(btrim(description)) between 1 and 200),
  constraint invoice_lines_quantity_range check (quantity > 0 and quantity <= 9999),
  constraint invoice_lines_unit_price_range check (unit_price >= 0 and unit_price <= 99999.99)
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);
-- A visit can be on only one live invoice.
create unique index invoice_lines_one_live_invoice_per_visit
  on public.invoice_lines (job_id)
  where job_id is not null and not invoice_cancelled;

create trigger invoice_lines_business_id_immutable
  before update on public.invoice_lines
  for each row execute function private.prevent_business_id_change();

create function private.update_invoice_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i
  set total = coalesce((select sum(l.amount) from public.invoice_lines l where l.invoice_id = target), 0)
  where i.id = target;
  return null;
end;
$$;

revoke execute on function private.update_invoice_total() from public;

create trigger invoice_lines_update_total
  after insert or update or delete on public.invoice_lines
  for each row execute function private.update_invoice_total();

-- The status to show: draft and cancelled as set; otherwise paid, overdue, partial or
-- sent, worked out from the payments and the due date in the business's time zone.
create function private.invoice_display_status(
  status public.invoice_status,
  total numeric,
  amount_paid numeric,
  due_date date,
  today date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when status = 'draft' then 'draft'
    when status = 'cancelled' then 'cancelled'
    when amount_paid >= total then 'paid'
    when due_date < today then 'overdue'
    when amount_paid > 0 then 'partial'
    else 'sent'
  end;
$$;

revoke execute on function private.invoice_display_status(public.invoice_status, numeric, numeric, date, date) from public;

create function private.business_today(p_business_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone b.time_zone)::date from public.businesses b where b.id = p_business_id;
$$;

revoke execute on function private.business_today(uuid) from public;

-- Computed columns for the API: select=*,display_status,balance. They only work from the
-- invoice row they're given (which RLS has already allowed). The parameter is unnamed so
-- the generated types list them as columns.
create function public.display_status(public.invoices)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.invoice_display_status($1.status, $1.total, $1.amount_paid, $1.due_date, private.business_today($1.business_id));
$$;

create function public.balance(public.invoices)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select $1.total - $1.amount_paid;
$$;

revoke execute on function public.display_status(public.invoices) from public, anon;
revoke execute on function public.balance(public.invoices) from public, anon;
grant execute on function public.display_status(public.invoices) to authenticated;
grant execute on function public.balance(public.invoices) to authenticated;

-- ---------------------------------------------------------------------------
-- Stripe (Connect)
-- ---------------------------------------------------------------------------
-- Each business's own connected Stripe account. Written only by the app's server after
-- it creates the account with Stripe, so no business can point at someone else's.
create table public.stripe_accounts (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  account_id text not null unique,
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_accounts_account_id_format check (account_id ~ '^acct_[A-Za-z0-9]+$')
);

create trigger stripe_accounts_set_updated_at
  before update on public.stripe_accounts
  for each row execute function private.set_updated_at();

create trigger stripe_accounts_business_id_immutable
  before update on public.stripe_accounts
  for each row execute function private.prevent_business_id_change();

-- Stripe Checkout sessions EcoScape Ops started for an invoice.
create type public.checkout_status as enum ('open', 'processing', 'paid', 'failed', 'expired');

create table public.checkout_sessions (
  id text primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null,
  account_id text not null,
  amount numeric(12, 2) not null,
  url text not null,
  status public.checkout_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (invoice_id, business_id) references public.invoices (id, business_id) on delete cascade,
  constraint checkout_sessions_id_format check (id ~ '^cs_[A-Za-z0-9_]+$'),
  constraint checkout_sessions_amount_positive check (amount > 0)
);

create index checkout_sessions_invoice_idx on public.checkout_sessions (invoice_id, created_at desc);

create trigger checkout_sessions_set_updated_at
  before update on public.checkout_sessions
  for each row execute function private.set_updated_at();

create trigger checkout_sessions_business_id_immutable
  before update on public.checkout_sessions
  for each row execute function private.prevent_business_id_change();

-- Stripe events already handled, so a redelivered event is ignored.
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
-- online: paid through Stripe straight away (card and similar); bank_transfer: through
-- Stripe by US bank account, which takes a few days to clear.
create type public.payment_method as enum ('online', 'bank_transfer', 'cash', 'check', 'other');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_id uuid not null,
  amount numeric(12, 2) not null,
  method public.payment_method not null,
  received_on date not null,
  note text not null default '',
  -- A Stripe payment: the checkout it came from. At most one payment per checkout.
  checkout_session_id text unique references public.checkout_sessions (id) on delete set null,
  -- A payment the owner recorded: the form submission it came from. Submitting the same
  -- form twice records it once.
  request_id uuid,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  foreign key (invoice_id, business_id) references public.invoices (id, business_id) on delete cascade,
  constraint payments_request_unique unique (business_id, request_id),
  constraint payments_amount_range check (amount > 0 and amount <= 999999.99),
  constraint payments_note_length check (char_length(note) <= 200),
  constraint payments_source check (
    (method in ('online', 'bank_transfer') and request_id is null)
    or (method in ('cash', 'check', 'other') and checkout_session_id is null and request_id is not null)
  )
);

create index payments_invoice_idx on public.payments (invoice_id, received_on);
create index payments_business_date_idx on public.payments (business_id, received_on);

create trigger payments_business_id_immutable
  before update on public.payments
  for each row execute function private.prevent_business_id_change();

create function private.update_invoice_amount_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i
  set amount_paid = coalesce((select sum(p.amount) from public.payments p where p.invoice_id = target), 0)
  where i.id = target;
  return null;
end;
$$;

revoke execute on function private.update_invoice_amount_paid() from public;

create trigger payments_update_amount_paid
  after insert or update or delete on public.payments
  for each row execute function private.update_invoice_amount_paid();

-- ---------------------------------------------------------------------------
-- Privileges and row-level security: owners read; functions and the service role write.
-- ---------------------------------------------------------------------------
revoke all on public.invoice_settings, public.invoices, public.invoice_lines, public.payments,
  public.stripe_accounts, public.checkout_sessions, public.stripe_events
  from anon, authenticated;
grant select on public.invoice_settings, public.invoices, public.invoice_lines, public.payments,
  public.stripe_accounts, public.checkout_sessions
  to authenticated;

alter table public.invoice_settings enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_accounts enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.stripe_events enable row level security; -- no policies: service role only

create policy "Owners can view their invoice settings"
  on public.invoice_settings for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their invoices"
  on public.invoices for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their invoice lines"
  on public.invoice_lines for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their payments"
  on public.payments for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their Stripe account"
  on public.stripe_accounts for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their checkouts"
  on public.checkout_sessions for select to authenticated
  using (business_id in (select private.owner_business_ids()));

-- ---------------------------------------------------------------------------
-- Owner functions
-- ---------------------------------------------------------------------------

-- An invoice of the caller's business, locked for update; anything else is "not found".
create function private.my_invoice_for_update(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  inv public.invoices;
begin
  select * into inv from public.invoices i where i.id = p_invoice_id and i.business_id = biz for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  return inv;
end;
$$;

revoke execute on function private.my_invoice_for_update(uuid) from public;

-- Replaces an invoice's lines. p_lines is a JSON array of
-- { "job_id": uuid | null, "description": text, "quantity": number, "unit_price": number }.
-- A line with a job_id bills that visit, which must be this customer's and not cancelled.
create function private.write_invoice_lines(p_invoice public.invoices, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
  pos integer := 0;
  line_job uuid;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'An invoice can have at most 100 lines' using errcode = '22023';
  end if;

  delete from public.invoice_lines where invoice_id = p_invoice.id;

  for line in select * from jsonb_array_elements(p_lines) loop
    line_job := nullif(line ->> 'job_id', '')::uuid;
    if nullif(line ->> 'unit_price', '') is null then
      raise exception 'Each line needs a price' using errcode = '22023';
    end if;
    if line_job is not null and not exists (
      select 1 from public.jobs j
      where j.id = line_job
        and j.business_id = p_invoice.business_id
        and j.customer_id = p_invoice.customer_id
        and j.status <> 'cancelled'
    ) then
      raise exception 'That visit can''t be added to this invoice' using errcode = '22023';
    end if;

    insert into public.invoice_lines (business_id, invoice_id, job_id, position, description, quantity, unit_price)
    values (
      p_invoice.business_id,
      p_invoice.id,
      line_job,
      pos,
      btrim(coalesce(line ->> 'description', '')),
      coalesce((line ->> 'quantity')::numeric, 1),
      (line ->> 'unit_price')::numeric
    );
    pos := pos + 1;
  end loop;

  if (select i.total from public.invoices i where i.id = p_invoice.id) <= 0 then
    raise exception 'The invoice total must be more than $0' using errcode = '22023';
  end if;
exception
  when unique_violation then
    raise exception 'One of those visits is already on another invoice' using errcode = '23505';
end;
$$;

revoke execute on function private.write_invoice_lines(public.invoices, jsonb) from public;

-- Creates a draft invoice (invoice_id null) or rewrites a draft. Returns its id.
create function public.save_invoice(
  invoice_id uuid,
  customer_id uuid,
  due_date date,
  notes text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  today date := private.business_today(biz);
  inv public.invoices;
begin
  if not exists (
    select 1 from public.customers c where c.id = save_invoice.customer_id and c.business_id = biz
  ) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  if save_invoice.due_date is null then
    raise exception 'Choose a due date' using errcode = '22023';
  end if;
  if char_length(coalesce(save_invoice.notes, '')) > 1000 then
    raise exception 'Notes must be 1000 characters or fewer' using errcode = '22023';
  end if;

  if save_invoice.invoice_id is null then
    if save_invoice.due_date < today then
      raise exception 'The due date can''t be before today' using errcode = '22023';
    end if;
    insert into public.invoices (business_id, customer_id, number, issue_date, due_date, notes, created_by)
    values (
      biz, save_invoice.customer_id, private.take_invoice_number(biz), today, save_invoice.due_date,
      coalesce(save_invoice.notes, ''), (select auth.uid())
    )
    returning * into inv;
  else
    inv := private.my_invoice_for_update(save_invoice.invoice_id);
    if inv.status <> 'draft' then
      raise exception 'Only a draft invoice can be changed' using errcode = '22023';
    end if;
    if save_invoice.due_date < inv.issue_date then
      raise exception 'The due date can''t be before the invoice date' using errcode = '22023';
    end if;
    update public.invoices i
    set customer_id = save_invoice.customer_id, due_date = save_invoice.due_date, notes = coalesce(save_invoice.notes, '')
    where i.id = inv.id
    returning * into inv;
  end if;

  perform private.write_invoice_lines(inv, save_invoice.lines);
  return inv.id;
end;
$$;

-- Marks an invoice sent (the owner has shared it). Sending a sent invoice again is fine.
create function public.send_invoice(invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(send_invoice.invoice_id);
begin
  if inv.status = 'cancelled' then
    raise exception 'This invoice is cancelled' using errcode = '22023';
  end if;
  if inv.status = 'draft' then
    update public.invoices i set status = 'sent', sent_at = now() where i.id = inv.id;
  end if;
end;
$$;

-- Cancels an invoice with no payments. Its visits can then go on another invoice.
create function public.cancel_invoice(invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(cancel_invoice.invoice_id);
begin
  if inv.status = 'cancelled' then
    return;
  end if;
  if exists (select 1 from public.payments p where p.invoice_id = inv.id) then
    raise exception 'An invoice with payments can''t be cancelled' using errcode = '22023';
  end if;
  update public.invoices i set status = 'cancelled', cancelled_at = now() where i.id = inv.id;
  update public.invoice_lines l set invoice_cancelled = true where l.invoice_id = inv.id;
  update public.checkout_sessions s set status = 'expired' where s.invoice_id = inv.id and s.status = 'open';
end;
$$;

-- Deletes a draft (a sent invoice is cancelled instead, so there's a record of it).
create function public.delete_draft_invoice(invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(delete_draft_invoice.invoice_id);
begin
  if inv.status <> 'draft' then
    raise exception 'Only a draft can be deleted; cancel a sent invoice instead' using errcode = '22023';
  end if;
  delete from public.invoices i where i.id = inv.id;
end;
$$;

-- Gives a sent invoice a new due date (e.g. more time to pay).
create function public.change_invoice_due_date(invoice_id uuid, due_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(change_invoice_due_date.invoice_id);
begin
  if inv.status = 'cancelled' then
    raise exception 'This invoice is cancelled' using errcode = '22023';
  end if;
  if change_invoice_due_date.due_date is null or change_invoice_due_date.due_date < inv.issue_date then
    raise exception 'The due date can''t be before the invoice date' using errcode = '22023';
  end if;
  update public.invoices i set due_date = change_invoice_due_date.due_date where i.id = inv.id;
end;
$$;

-- Records a cash, check or other payment on a sent invoice. request_id identifies the
-- form submission: recording the same request_id again returns the first payment instead
-- of recording another. A payment can't be more than what's still owed.
create function public.record_manual_payment(
  invoice_id uuid,
  amount numeric,
  method public.payment_method,
  received_on date,
  note text,
  request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices := private.my_invoice_for_update(record_manual_payment.invoice_id);
  existing uuid;
  payment_id uuid;
begin
  if record_manual_payment.request_id is null then
    raise exception 'Missing request id' using errcode = '22023';
  end if;
  -- The invoice row lock serializes payments on this invoice, so a repeated submission
  -- always finds the first one here.
  select p.id into existing
  from public.payments p
  where p.business_id = inv.business_id and p.request_id = record_manual_payment.request_id;
  if existing is not null then
    return existing;
  end if;

  if inv.status <> 'sent' then
    raise exception 'Payments can only be recorded on a sent invoice' using errcode = '22023';
  end if;
  if record_manual_payment.method not in ('cash', 'check', 'other') then
    raise exception 'Online payments are recorded by Stripe' using errcode = '22023';
  end if;
  if record_manual_payment.amount is null or record_manual_payment.amount <= 0 then
    raise exception 'Enter an amount more than $0' using errcode = '22023';
  end if;
  if record_manual_payment.amount > inv.total - inv.amount_paid then
    raise exception 'That''s more than the balance due' using errcode = '22023';
  end if;
  if record_manual_payment.received_on is null or record_manual_payment.received_on > private.business_today(inv.business_id) then
    raise exception 'The date received can''t be in the future' using errcode = '22023';
  end if;

  insert into public.payments (business_id, invoice_id, amount, method, received_on, note, request_id, recorded_by)
  values (
    inv.business_id, inv.id, record_manual_payment.amount, record_manual_payment.method,
    record_manual_payment.received_on, btrim(coalesce(record_manual_payment.note, '')),
    record_manual_payment.request_id, (select auth.uid())
  )
  returning id into payment_id;
  return payment_id;
end;
$$;

-- Removes a cash/check/other payment recorded by mistake. Stripe payments stay.
create function public.delete_manual_payment(payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments;
begin
  select * into pay
  from public.payments p
  where p.id = delete_manual_payment.payment_id and p.business_id = private.my_owned_business();
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if pay.method not in ('cash', 'check', 'other') then
    raise exception 'Stripe payments can''t be removed here; refund them in Stripe' using errcode = '22023';
  end if;
  perform private.my_invoice_for_update(pay.invoice_id);
  delete from public.payments p where p.id = pay.id;
end;
$$;

create function public.set_auto_invoice(enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  insert into public.invoice_settings (business_id, auto_invoice)
  values (biz, coalesce(enabled, false))
  on conflict (business_id) do update set auto_invoice = excluded.auto_invoice;
end;
$$;

revoke execute on function public.save_invoice(uuid, uuid, date, text, jsonb) from public, anon;
revoke execute on function public.send_invoice(uuid) from public, anon;
revoke execute on function public.cancel_invoice(uuid) from public, anon;
revoke execute on function public.delete_draft_invoice(uuid) from public, anon;
revoke execute on function public.change_invoice_due_date(uuid, date) from public, anon;
revoke execute on function public.record_manual_payment(uuid, numeric, public.payment_method, date, text, uuid) from public, anon;
revoke execute on function public.delete_manual_payment(uuid) from public, anon;
revoke execute on function public.set_auto_invoice(boolean) from public, anon;
grant execute on function public.save_invoice(uuid, uuid, date, text, jsonb) to authenticated;
grant execute on function public.send_invoice(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid) to authenticated;
grant execute on function public.delete_draft_invoice(uuid) to authenticated;
grant execute on function public.change_invoice_due_date(uuid, date) to authenticated;
grant execute on function public.record_manual_payment(uuid, numeric, public.payment_method, date, text, uuid) to authenticated;
grant execute on function public.delete_manual_payment(uuid) to authenticated;
grant execute on function public.set_auto_invoice(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-invoice: a draft invoice for each visit marked completed (by the owner or a crew
-- member), when the business has it turned on and the visit isn't invoiced yet.
-- ---------------------------------------------------------------------------
create function private.auto_invoice_completed_job()
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

revoke execute on function private.auto_invoice_completed_job() from public;

create trigger jobs_auto_invoice
  after update of status on public.jobs
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function private.auto_invoice_completed_job();

-- ---------------------------------------------------------------------------
-- The customer's pay page (/pay/<token>): anyone with the link can see that one invoice,
-- and nothing else. Drafts and cancelled invoices show nothing.
-- ---------------------------------------------------------------------------
create function public.public_invoice(token text)
returns table (
  business_name text,
  number integer,
  customer_name text,
  issue_date date,
  due_date date,
  status text,
  total numeric,
  amount_paid numeric,
  balance numeric,
  lines jsonb,
  can_pay_online boolean,
  payment_processing boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name,
         i.number,
         btrim(c.first_name || ' ' || c.last_name),
         i.issue_date,
         i.due_date,
         private.invoice_display_status(i.status, i.total, i.amount_paid, i.due_date, private.business_today(i.business_id)),
         i.total,
         i.amount_paid,
         greatest(i.total - i.amount_paid, 0),
         (
           select coalesce(jsonb_agg(jsonb_build_object(
             'description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price, 'amount', l.amount
           ) order by l.position), '[]'::jsonb)
           from public.invoice_lines l where l.invoice_id = i.id
         ),
         i.total > i.amount_paid and coalesce(sa.charges_enabled, false),
         exists (select 1 from public.checkout_sessions s where s.invoice_id = i.id and s.status = 'processing')
  from public.invoices i
  join public.businesses b on b.id = i.business_id
  join public.customers c on c.id = i.customer_id and c.business_id = i.business_id
  left join public.stripe_accounts sa on sa.business_id = i.business_id
  where token ~ '^[0-9a-f]{64}$'
    and i.pay_token = token
    and i.status = 'sent';
$$;

revoke execute on function public.public_invoice(text) from public;
grant execute on function public.public_invoice(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Service-role functions for Stripe (the app's server, after checking Stripe's webhook
-- signature or when a customer presses Pay). Nobody else can execute these.
-- ---------------------------------------------------------------------------

-- What a customer's Pay button needs: the balance and the business's connected account,
-- plus an open checkout for that same amount to reuse (so two taps don't start two).
create function public.begin_invoice_checkout(token text)
returns table (
  invoice_id uuid,
  business_id uuid,
  business_name text,
  number integer,
  amount numeric,
  account_id text,
  reusable_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices i
  where begin_invoice_checkout.token ~ '^[0-9a-f]{64}$' and i.pay_token = begin_invoice_checkout.token
  for update;
  if not found or inv.status <> 'sent' then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.total <= inv.amount_paid then
    raise exception 'This invoice is already paid' using errcode = '22023';
  end if;

  return query
  select inv.id, inv.business_id, b.name, inv.number, inv.total - inv.amount_paid, sa.account_id,
         (
           select s.url from public.checkout_sessions s
           where s.invoice_id = inv.id
             and s.status = 'open'
             and s.account_id = sa.account_id
             and s.amount = inv.total - inv.amount_paid
             and s.created_at > now() - interval '23 hours'
           order by s.created_at desc
           limit 1
         )
  from public.businesses b
  join public.stripe_accounts sa on sa.business_id = b.id and sa.charges_enabled
  where b.id = inv.business_id;
  if not found then
    raise exception 'This business can''t take online payments yet' using errcode = '55000';
  end if;
end;
$$;

-- Remembers a checkout the app just started, on the invoice's own business's account.
create function public.record_checkout_session(
  session_id text,
  invoice_id uuid,
  account_id text,
  amount numeric,
  url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.checkout_sessions (id, business_id, invoice_id, account_id, amount, url)
  select record_checkout_session.session_id, i.business_id, i.id, record_checkout_session.account_id,
         record_checkout_session.amount, record_checkout_session.url
  from public.invoices i
  join public.stripe_accounts sa on sa.business_id = i.business_id and sa.account_id = record_checkout_session.account_id
  where i.id = record_checkout_session.invoice_id;
  if not found then
    raise exception 'That account doesn''t belong to this invoice''s business' using errcode = '42501';
  end if;
end;
$$;

-- Applies a Stripe Checkout event. outcome is 'paid' (money received, straight away),
-- 'paid_later' (a bank payment that has now cleared), 'processing' (a bank payment
-- started), 'failed' or 'expired'. Only checkouts EcoScape Ops started, on the account
-- the event came from, count; a payment is recorded at most once per checkout. Returns
-- what happened.
create function public.apply_checkout_event(
  session_id text,
  account_id text,
  outcome text,
  amount_cents bigint default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cs public.checkout_sessions;
  recorded uuid;
begin
  select * into cs from public.checkout_sessions s
  where s.id = apply_checkout_event.session_id and s.account_id = apply_checkout_event.account_id
  for update;
  if not found then
    return 'unknown_checkout';
  end if;

  if apply_checkout_event.outcome in ('paid', 'paid_later') then
    insert into public.payments (business_id, invoice_id, amount, method, received_on, checkout_session_id, note)
    values (
      cs.business_id, cs.invoice_id,
      coalesce(apply_checkout_event.amount_cents / 100.0, cs.amount),
      case when apply_checkout_event.outcome = 'paid_later' then 'bank_transfer' else 'online' end::public.payment_method,
      private.business_today(cs.business_id),
      cs.id,
      'Paid through Stripe'
    )
    on conflict (checkout_session_id) do nothing
    returning id into recorded;
    update public.checkout_sessions s set status = 'paid' where s.id = cs.id;
    return case when recorded is null then 'already_recorded' else 'recorded' end;
  elsif apply_checkout_event.outcome = 'processing' then
    update public.checkout_sessions s set status = 'processing' where s.id = cs.id and s.status = 'open';
    return 'processing';
  elsif apply_checkout_event.outcome in ('failed', 'expired') then
    update public.checkout_sessions s
    set status = apply_checkout_event.outcome::public.checkout_status
    where s.id = cs.id and s.status in ('open', 'processing');
    return apply_checkout_event.outcome;
  end if;
  raise exception 'Unknown outcome %', apply_checkout_event.outcome using errcode = '22023';
end;
$$;

-- Logs a Stripe event once it's been handled. Returns false if it was already logged (a
-- redelivery). Handling is safe to repeat anyway: a checkout records at most one payment.
create function public.record_stripe_event(event_id text, event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_events (id, type) values (event_id, event_type) on conflict do nothing;
  return found;
end;
$$;

revoke execute on function public.begin_invoice_checkout(text) from public, anon, authenticated;
revoke execute on function public.record_checkout_session(text, uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.apply_checkout_event(text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.record_stripe_event(text, text) from public, anon, authenticated;
grant execute on function public.begin_invoice_checkout(text) to service_role;
grant execute on function public.record_checkout_session(text, uuid, text, numeric, text) to service_role;
grant execute on function public.apply_checkout_event(text, text, text, bigint) to service_role;
grant execute on function public.record_stripe_event(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Dashboard: revenue without double counting, plus what's owed and what's come in.
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
  month_expenses numeric,
  outstanding numeric,
  overdue numeric,
  month_collected numeric
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
  extra_booked numeric;
  owed numeric;
  late numeric;
  collected numeric;
begin
  select m.business_id, m.role into caller_business, caller_role
  from public.business_members m
  where m.user_id = caller;
  if caller_business is null then
    return; -- not signed in, or no business: no summary
  end if;

  t := private.business_today(caller_business);
  month_start := date_trunc('month', t)::date;
  month_end := (date_trunc('month', t) + interval '1 month - 1 day')::date;

  select c.id into caller_crew_member from public.crew_members c where c.user_id = caller;

  if caller_role = 'owner' then
    select coalesce(sum(e.amount), 0) into expenses_total
    from public.expenses e
    where e.business_id = caller_business and e.spent_on between month_start and month_end;

    -- Lines on sent invoices issued this month that aren't a (still booked) visit: those
    -- visits are already counted below.
    select coalesce(sum(l.amount), 0) into extra_booked
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id and i.business_id = l.business_id
    left join public.jobs j on j.id = l.job_id and j.business_id = l.business_id
    where i.business_id = caller_business
      and i.status = 'sent'
      and i.issue_date between month_start and month_end
      and (j.id is null or j.status = 'cancelled');

    select coalesce(sum(i.total - i.amount_paid), 0),
           coalesce(sum(i.total - i.amount_paid) filter (where i.due_date < t), 0)
    into owed, late
    from public.invoices i
    where i.business_id = caller_business and i.status = 'sent' and i.amount_paid < i.total;

    select coalesce(sum(p.amount), 0) into collected
    from public.payments p
    where p.business_id = caller_business and p.received_on between month_start and month_end;
  end if;

  return query
  with scoped as (
    select j.scheduled_date, j.status,
           -- A visit counts at its invoiced amount once it's on a sent invoice.
           coalesce(
             (select sum(l.amount)
              from public.invoice_lines l
              join public.invoices i on i.id = l.invoice_id and i.business_id = l.business_id
              where l.job_id = j.id and not l.invoice_cancelled and i.status = 'sent'),
             j.price
           ) as value
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
      coalesce(sum(s.value) filter (where s.scheduled_date between month_start and month_end), 0) + extra_booked
    end,
    case when caller_role = 'owner' then
      coalesce(sum(s.value) filter (where s.scheduled_date between month_start and month_end and s.status = 'completed'), 0)
        + extra_booked
    end,
    expenses_total, -- null for crew, like every money field
    owed,
    late,
    collected
  from scoped s;
end;
$$;

revoke execute on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;
