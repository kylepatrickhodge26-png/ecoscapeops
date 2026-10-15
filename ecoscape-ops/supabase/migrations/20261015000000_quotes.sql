-- EcoScape Ops quotes: price a job for a customer (or a prospect who isn't a customer yet),
-- send it, and when it's accepted turn it into a booked or recurring service.
--
--   * Owner only. Crew members have no access to quotes, prices or totals at all.
--   * Same isolation model as invoices: business_id on every row, owner-only reads through
--     RLS, and every change goes through a database function that checks the caller owns the
--     business. Nobody writes quotes or their lines directly.
--   * Statuses: draft, sent, accepted, declined are set by the owner. "Expired" is worked out
--     every time a quote is shown (a sent quote past its expiry date), so it can't go stale.

create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined');

-- Quote numbers per business (#1001, #1002, ...). No policies and no grants: only the
-- functions below touch it.
create table public.quote_counters (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  next_number integer not null default 1001
);

create function private.take_quote_number(p_business_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  taken integer;
begin
  insert into public.quote_counters (business_id) values (p_business_id) on conflict do nothing;
  update public.quote_counters
  set next_number = next_number + 1
  where business_id = p_business_id
  returning next_number - 1 into taken;
  return taken;
end;
$$;

revoke execute on function private.take_quote_number(uuid) from public;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- An existing customer, or null for a prospect described by the prospect_* fields.
  customer_id uuid,
  number integer not null,
  status public.quote_status not null default 'draft',

  prospect_name text not null default '',
  prospect_phone text not null default '',
  prospect_email text not null default '',
  prospect_address text not null default '',

  -- What the work is called; becomes the service's name when the quote is accepted.
  title text not null default '',
  issue_date date not null,
  expires_on date not null,
  notes text not null default '',
  -- Kept in step with the lines by a trigger.
  total numeric(12, 2) not null default 0,

  sent_at timestamptz,
  decided_at timestamptz,
  -- The service this quote became, once accepted.
  accepted_service_plan_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade,
  foreign key (accepted_service_plan_id, business_id) references public.service_plans (id, business_id)
    on delete set null (accepted_service_plan_id),
  constraint quotes_id_business_unique unique (id, business_id),
  constraint quotes_number_unique unique (business_id, number),
  constraint quotes_number_positive check (number > 0),
  constraint quotes_expires_after_issue check (expires_on >= issue_date),
  constraint quotes_has_customer_or_prospect check (customer_id is not null or btrim(prospect_name) <> ''),
  constraint quotes_field_lengths check (
    char_length(prospect_name) <= 200
    and char_length(prospect_phone) <= 40
    and char_length(prospect_email) <= 254
    and char_length(prospect_address) <= 300
    and char_length(title) <= 100
    and char_length(notes) <= 2000
  )
);

create index quotes_business_idx on public.quotes (business_id, number desc);
create index quotes_customer_idx on public.quotes (business_id, customer_id);

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function private.set_updated_at();

create trigger quotes_business_id_immutable
  before update on public.quotes
  for each row execute function private.prevent_business_id_change();

create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  quote_id uuid not null,
  position integer not null default 0,
  description text not null,
  quantity numeric(8, 2) not null default 1,
  unit_price numeric(10, 2) not null,
  amount numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,

  foreign key (quote_id, business_id) references public.quotes (id, business_id) on delete cascade,
  constraint quote_lines_description_length check (char_length(btrim(description)) between 1 and 200),
  constraint quote_lines_quantity_range check (quantity > 0 and quantity <= 9999),
  constraint quote_lines_unit_price_range check (unit_price >= 0 and unit_price <= 99999.99)
);

create index quote_lines_quote_idx on public.quote_lines (quote_id, position);

create trigger quote_lines_business_id_immutable
  before update on public.quote_lines
  for each row execute function private.prevent_business_id_change();

create function private.update_quote_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.quote_id, old.quote_id);
begin
  update public.quotes q
  set total = coalesce((select sum(l.amount) from public.quote_lines l where l.quote_id = target), 0)
  where q.id = target;
  return null;
end;
$$;

revoke execute on function private.update_quote_total() from public;

create trigger quote_lines_update_total
  after insert or update or delete on public.quote_lines
  for each row execute function private.update_quote_total();

-- draft/accepted/declined as set; a sent quote past its expiry date shows as expired.
create function private.quote_display_status(status public.quote_status, expires_on date, today date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when status = 'sent' and expires_on < today then 'expired'
    else status::text
  end;
$$;

revoke execute on function private.quote_display_status(public.quote_status, date, date) from public;

-- Computed column for the API: select=*,quote_status_shown. Only works from a quote row
-- RLS has already allowed.
create function public.quote_status_shown(public.quotes)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.quote_display_status($1.status, $1.expires_on, private.business_today($1.business_id));
$$;

revoke execute on function public.quote_status_shown(public.quotes) from public, anon;
grant execute on function public.quote_status_shown(public.quotes) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security: owners read; functions write.
-- ---------------------------------------------------------------------------
revoke all on public.quote_counters, public.quotes, public.quote_lines from anon, authenticated;
grant select on public.quotes, public.quote_lines to authenticated;

alter table public.quote_counters enable row level security; -- no policies: functions only
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;

create policy "Owners can view their quotes"
  on public.quotes for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their quote lines"
  on public.quote_lines for select to authenticated
  using (business_id in (select private.owner_business_ids()));

-- ---------------------------------------------------------------------------
-- Owner functions
-- ---------------------------------------------------------------------------

-- A quote of the caller's business, locked for update; anything else is "not found".
create function private.my_quote_for_update(p_quote_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  q public.quotes;
begin
  select * into q from public.quotes x where x.id = p_quote_id and x.business_id = biz for update;
  if not found then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  return q;
end;
$$;

revoke execute on function private.my_quote_for_update(uuid) from public;

-- Replaces a quote's lines. p_lines is a JSON array of
-- { "description": text, "quantity": number, "unit_price": number }.
create function private.write_quote_lines(p_quote public.quotes, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line jsonb;
  pos integer := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'A quote can have at most 100 lines' using errcode = '22023';
  end if;

  delete from public.quote_lines where quote_id = p_quote.id;

  for line in select * from jsonb_array_elements(p_lines) loop
    if nullif(line ->> 'unit_price', '') is null then
      raise exception 'Each line needs a price' using errcode = '22023';
    end if;
    insert into public.quote_lines (business_id, quote_id, position, description, quantity, unit_price)
    values (
      p_quote.business_id,
      p_quote.id,
      pos,
      btrim(coalesce(line ->> 'description', '')),
      coalesce((line ->> 'quantity')::numeric, 1),
      (line ->> 'unit_price')::numeric
    );
    pos := pos + 1;
  end loop;

  if (select q.total from public.quotes q where q.id = p_quote.id) <= 0 then
    raise exception 'The quote total must be more than $0' using errcode = '22023';
  end if;
  -- A quote becomes a service, and a service's price tops out at this.
  if (select q.total from public.quotes q where q.id = p_quote.id) > 99999.99 then
    raise exception 'The quote total can''t be more than $99,999.99' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function private.write_quote_lines(public.quotes, jsonb) from public;

-- Creates a draft quote (quote_id null) or rewrites a draft. Pass customer_id for an
-- existing customer, or leave it null and describe the prospect. Returns the quote's id.
create function public.save_quote(
  quote_id uuid,
  customer_id uuid,
  prospect_name text,
  prospect_phone text,
  prospect_email text,
  prospect_address text,
  title text,
  expires_on date,
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
  p_name text := btrim(coalesce(save_quote.prospect_name, ''));
  p_phone text := btrim(coalesce(save_quote.prospect_phone, ''));
  p_email text := btrim(coalesce(save_quote.prospect_email, ''));
  p_address text := btrim(coalesce(save_quote.prospect_address, ''));
  q public.quotes;
begin
  if save_quote.customer_id is not null then
    if not exists (select 1 from public.customers c where c.id = save_quote.customer_id and c.business_id = biz) then
      raise exception 'Customer not found' using errcode = 'P0002';
    end if;
    -- A real customer's details live on the customer, not on the quote.
    p_name := ''; p_phone := ''; p_email := ''; p_address := '';
  else
    if p_name = '' then
      raise exception 'Choose a customer or enter the prospect''s name' using errcode = '22023';
    end if;
    if p_email <> '' and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'That email address doesn''t look right' using errcode = '22023';
    end if;
  end if;
  if char_length(p_name) > 200 or char_length(p_phone) > 40 or char_length(p_email) > 254 or char_length(p_address) > 300 then
    raise exception 'One of the prospect''s details is too long' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(save_quote.title, ''))) > 100 then
    raise exception 'The title must be 100 characters or fewer' using errcode = '22023';
  end if;
  if char_length(coalesce(save_quote.notes, '')) > 2000 then
    raise exception 'Notes must be 2000 characters or fewer' using errcode = '22023';
  end if;
  if save_quote.expires_on is null then
    raise exception 'Choose an expiry date' using errcode = '22023';
  end if;

  if save_quote.quote_id is null then
    if save_quote.expires_on < today then
      raise exception 'The expiry date can''t be before today' using errcode = '22023';
    end if;
    insert into public.quotes (
      business_id, customer_id, number, prospect_name, prospect_phone, prospect_email, prospect_address,
      title, issue_date, expires_on, notes, created_by
    )
    values (
      biz, save_quote.customer_id, private.take_quote_number(biz), p_name, p_phone, p_email, p_address,
      btrim(coalesce(save_quote.title, '')), today, save_quote.expires_on, coalesce(save_quote.notes, ''), (select auth.uid())
    )
    returning * into q;
  else
    q := private.my_quote_for_update(save_quote.quote_id);
    if q.status <> 'draft' then
      raise exception 'Only a draft quote can be changed' using errcode = '22023';
    end if;
    if save_quote.expires_on < q.issue_date then
      raise exception 'The expiry date can''t be before the quote date' using errcode = '22023';
    end if;
    update public.quotes x
    set customer_id = save_quote.customer_id,
        prospect_name = p_name, prospect_phone = p_phone, prospect_email = p_email, prospect_address = p_address,
        title = btrim(coalesce(save_quote.title, '')),
        expires_on = save_quote.expires_on,
        notes = coalesce(save_quote.notes, '')
    where x.id = q.id
    returning * into q;
  end if;

  perform private.write_quote_lines(q, save_quote.lines);
  return q.id;
end;
$$;

-- Marks a quote sent (the owner has shared it). Sending a sent quote again is fine.
create function public.send_quote(quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes := private.my_quote_for_update(send_quote.quote_id);
begin
  if q.status in ('accepted', 'declined') then
    raise exception 'This quote has already been %', q.status using errcode = '22023';
  end if;
  if q.status = 'draft' then
    update public.quotes x set status = 'sent', sent_at = now() where x.id = q.id;
  end if;
end;
$$;

-- The customer said no.
create function public.decline_quote(quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes := private.my_quote_for_update(decline_quote.quote_id);
begin
  if q.status = 'accepted' then
    raise exception 'This quote has already been accepted' using errcode = '22023';
  end if;
  if q.status <> 'declined' then
    update public.quotes x set status = 'declined', decided_at = now() where x.id = q.id;
  end if;
end;
$$;

-- A copy of any quote as a new draft (to revise a sent or declined one). Returns its id.
create function public.duplicate_quote(quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes := private.my_quote_for_update(duplicate_quote.quote_id);
  today date := private.business_today(q.business_id);
  copy_id uuid;
begin
  insert into public.quotes (
    business_id, customer_id, number, prospect_name, prospect_phone, prospect_email, prospect_address,
    title, issue_date, expires_on, notes, created_by
  )
  values (
    q.business_id, q.customer_id, private.take_quote_number(q.business_id), q.prospect_name, q.prospect_phone,
    q.prospect_email, q.prospect_address, q.title, today, today + 30, q.notes, (select auth.uid())
  )
  returning id into copy_id;

  insert into public.quote_lines (business_id, quote_id, position, description, quantity, unit_price)
  select l.business_id, copy_id, l.position, l.description, l.quantity, l.unit_price
  from public.quote_lines l where l.quote_id = q.id;

  return copy_id;
end;
$$;

create function public.delete_draft_quote(quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes := private.my_quote_for_update(delete_draft_quote.quote_id);
begin
  if q.status <> 'draft' then
    raise exception 'Only a draft quote can be deleted' using errcode = '22023';
  end if;
  delete from public.quotes x where x.id = q.id;
end;
$$;

-- Accepts a quote and books the work: a recurring service, or a one-time visit, priced at
-- the quote's total. A prospect becomes a customer first. Accepting twice (a double tap,
-- two devices) books once: the second try finds it already accepted. Returns the service's id.
create function public.accept_quote(
  quote_id uuid,
  service_name text,
  frequency public.service_frequency,
  first_visit date,
  assigned_crew_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes := private.my_quote_for_update(accept_quote.quote_id);
  today date := private.business_today(q.business_id);
  svc text := btrim(coalesce(accept_quote.service_name, ''));
  who uuid := q.customer_id;
  first_part text;
  plan_id uuid;
begin
  if q.status = 'accepted' then
    raise exception 'This quote has already been accepted' using errcode = '22023';
  end if;
  if q.total <= 0 or q.total > 99999.99 then
    raise exception 'The quote total must be between $0.01 and $99,999.99' using errcode = '22023';
  end if;
  if svc = '' or char_length(svc) > 100 then
    raise exception 'Give the service a name of 100 characters or fewer' using errcode = '22023';
  end if;
  if accept_quote.first_visit is null or accept_quote.first_visit < today then
    raise exception 'Choose a first visit date of today or later' using errcode = '22023';
  end if;
  if accept_quote.assigned_crew_member_id is not null and not exists (
    select 1 from public.crew_members m
    where m.id = accept_quote.assigned_crew_member_id and m.business_id = q.business_id
  ) then
    raise exception 'That crew member isn''t on your crew' using errcode = '22023';
  end if;

  if who is null then
    first_part := split_part(q.prospect_name, ' ', 1);
    insert into public.customers (business_id, first_name, last_name, phone, email, property_address)
    values (
      q.business_id,
      left(first_part, 100),
      left(btrim(substr(q.prospect_name, char_length(first_part) + 1)), 100),
      q.prospect_phone,
      q.prospect_email,
      q.prospect_address
    )
    returning id into who;
  end if;

  insert into public.service_plans (
    business_id, customer_id, service_name, price, frequency, start_date, assigned_crew_member_id
  )
  values (
    q.business_id, who, svc, q.total, accept_quote.frequency, accept_quote.first_visit,
    accept_quote.assigned_crew_member_id
  )
  returning id into plan_id;

  update public.quotes x
  set status = 'accepted', decided_at = now(), customer_id = who, accepted_service_plan_id = plan_id
  where x.id = q.id;

  return plan_id;
end;
$$;

revoke execute on function public.save_quote(uuid, uuid, text, text, text, text, text, date, text, jsonb) from public, anon;
revoke execute on function public.send_quote(uuid) from public, anon;
revoke execute on function public.decline_quote(uuid) from public, anon;
revoke execute on function public.duplicate_quote(uuid) from public, anon;
revoke execute on function public.delete_draft_quote(uuid) from public, anon;
revoke execute on function public.accept_quote(uuid, text, public.service_frequency, date, uuid) from public, anon;
grant execute on function public.save_quote(uuid, uuid, text, text, text, text, text, date, text, jsonb) to authenticated;
grant execute on function public.send_quote(uuid) to authenticated;
grant execute on function public.decline_quote(uuid) to authenticated;
grant execute on function public.duplicate_quote(uuid) to authenticated;
grant execute on function public.delete_draft_quote(uuid) to authenticated;
grant execute on function public.accept_quote(uuid, text, public.service_frequency, date, uuid) to authenticated;
