-- Customer accounts: a customer can sign in and see their own visits, quotes and invoices,
-- say yes or no to a quote, and ask for more work.
--
--   * Customers join only through an invite link the owner makes from that customer's page,
--     the same way crew join. Nobody can sign up and claim to be someone's customer.
--   * A login is one kind of person: an owner or crew member of one business, or one
--     customer. A customer login is never a business member, so none of the business's
--     tables (which are owner/crew only through row-level security) let it read anything.
--   * Everything a customer sees comes through the portal_* functions below, which only
--     ever look at the caller's own customer record: their visits (no internal notes), quotes
--     that have been sent to them, and invoices that have been sent to them.

create table public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,
  -- Set when the customer accepts the invite.
  user_id uuid unique references auth.users (id) on delete cascade,
  email text,
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  joined_at timestamptz,

  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete cascade,
  -- One login per customer record.
  constraint customer_accounts_one_per_customer unique (customer_id),
  constraint customer_accounts_invite_or_joined check (user_id is not null or invite_token_hash is not null)
);

create index customer_accounts_business_idx on public.customer_accounts (business_id);

create trigger customer_accounts_business_id_immutable
  before update on public.customer_accounts
  for each row execute function private.prevent_business_id_change();

-- A login that belongs to a business can't become a customer, and the other way round.
create function private.business_member_not_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.customer_accounts a where a.user_id = new.user_id) then
    raise exception 'This login is a customer account. Use a different email for a business login' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke execute on function private.business_member_not_customer() from public;

create trigger business_members_not_customer
  before insert or update of user_id on public.business_members
  for each row execute function private.business_member_not_customer();

-- The quote a customer answered from their account. The owner still books the work.
alter table public.quotes
  add column customer_response text,
  add column customer_responded_at timestamptz,
  add constraint quotes_customer_response_valid check (customer_response is null or customer_response in ('accepted', 'declined'));

-- ---------------------------------------------------------------------------
-- Owner: invite or remove a customer's login
-- ---------------------------------------------------------------------------

-- A new invite link for this customer (the old one stops working). Returns the token, which
-- is never stored or shown again (only its hash is kept).
create function public.invite_customer(customer_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  token text := private.new_invite_token();
  acct public.customer_accounts;
begin
  if not exists (select 1 from public.customers c where c.id = invite_customer.customer_id and c.business_id = biz) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  select * into acct from public.customer_accounts a where a.customer_id = invite_customer.customer_id for update;
  if found and acct.user_id is not null then
    raise exception 'This customer already has an account' using errcode = '23505';
  end if;
  insert into public.customer_accounts (business_id, customer_id, invite_token_hash, invite_expires_at)
  values (biz, invite_customer.customer_id, private.hash_invite_token(token), now() + interval '14 days')
  on conflict on constraint customer_accounts_one_per_customer do update
    set invite_token_hash = excluded.invite_token_hash, invite_expires_at = excluded.invite_expires_at;
  return token;
end;
$$;

-- Removes the customer's access (or a pending invite). Their login then sees nothing.
create function public.remove_customer_access(customer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  delete from public.customer_accounts a where a.customer_id = remove_customer_access.customer_id and a.business_id = biz;
  if not found then
    raise exception 'No account for this customer' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining through the invite link
-- ---------------------------------------------------------------------------

-- Anyone holding a valid link: which business it's from and the customer's first name.
create function public.customer_invite_details(token text)
returns table (business_name text, customer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name, coalesce(nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), ''), 'there')
  from public.customer_accounts a
  join public.businesses b on b.id = a.business_id
  join public.customers c on c.id = a.customer_id and c.business_id = a.business_id
  where a.invite_token_hash = private.hash_invite_token(customer_invite_details.token)
    and a.user_id is null
    and a.invite_expires_at > now();
$$;

create function private.accept_customer_invite_for_user(p_user_id uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acct public.customer_accounts;
  user_email text;
begin
  select * into acct
  from public.customer_accounts a
  where a.invite_token_hash = private.hash_invite_token(p_token)
    and a.user_id is null
    and a.invite_expires_at > now()
  for update;
  if not found then
    raise exception 'This invite link is invalid or has expired' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.business_members m where m.user_id = p_user_id) then
    raise exception 'This login belongs to a business. Use a different email for your customer account' using errcode = '23505';
  end if;
  if exists (select 1 from public.customer_accounts a where a.user_id = p_user_id) then
    raise exception 'This login already has a customer account' using errcode = '23505';
  end if;

  select u.email into user_email from auth.users u where u.id = p_user_id;
  update public.customer_accounts a
  set user_id = p_user_id, email = user_email, joined_at = now(), invite_token_hash = null, invite_expires_at = null
  where a.id = acct.id;
  return acct.customer_id;
end;
$$;

revoke execute on function private.accept_customer_invite_for_user(uuid, text) from public;

-- A signed-in login with no business accepts the invite.
create function public.accept_customer_invite(token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return private.accept_customer_invite_for_user((select auth.uid()), accept_customer_invite.token);
end;
$$;

-- Signup: a customer invite token joins as that customer (an invalid one fails the signup
-- rather than leaving a login with nothing); otherwise as before (crew invite, or a new business).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'customer_invite_token'), '') is not null then
    perform private.accept_customer_invite_for_user(new.id, new.raw_user_meta_data ->> 'customer_invite_token');
  elsif nullif(btrim(new.raw_user_meta_data ->> 'crew_invite_token'), '') is not null then
    perform private.accept_crew_invite_for_user(new.id, new.raw_user_meta_data ->> 'crew_invite_token');
  elsif nullif(btrim(new.raw_user_meta_data ->> 'business_name'), '') is not null then
    perform private.create_business_for_user(
      new.id,
      new.raw_user_meta_data ->> 'business_name',
      new.raw_user_meta_data ->> 'time_zone'
    );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The customer's own view
-- ---------------------------------------------------------------------------

-- The caller's customer record, or nothing.
create function private.my_customer_account()
returns public.customer_accounts
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.customer_accounts a where a.user_id = (select auth.uid()) and a.user_id is not null;
$$;

revoke execute on function private.my_customer_account() from public;

create function public.portal_summary()
returns table (
  business_name text,
  first_name text,
  last_name text,
  property_address text,
  phone text,
  email text,
  open_quotes integer,
  amount_owed numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name, c.first_name, c.last_name, c.property_address, c.phone, c.email,
         (select count(*)::integer from public.quotes q
          where q.customer_id = c.id and q.business_id = c.business_id and q.status = 'sent'
            and q.expires_on >= private.business_today(c.business_id)),
         (select coalesce(sum(i.total - i.amount_paid), 0) from public.invoices i
          where i.customer_id = c.id and i.business_id = c.business_id and i.status = 'sent' and i.amount_paid < i.total)
  from public.customer_accounts a
  join public.customers c on c.id = a.customer_id and c.business_id = a.business_id
  join public.businesses b on b.id = a.business_id
  where a.user_id = (select auth.uid());
$$;

-- Their visits: upcoming ones, and the last 90 days. No internal notes, no crew details.
create function public.portal_visits()
returns table (id uuid, scheduled_date date, service_name text, status public.job_status, price numeric, upcoming boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, j.scheduled_date, j.service_name, j.status, j.price, j.scheduled_date >= private.business_today(a.business_id)
  from public.customer_accounts a
  join public.jobs j on j.customer_id = a.customer_id and j.business_id = a.business_id
  where a.user_id = (select auth.uid())
    and j.scheduled_date >= private.business_today(a.business_id) - 90
  order by j.scheduled_date, j.id
  limit 200;
$$;

-- Quotes that have been sent to them (never drafts), with their lines.
create function public.portal_quotes()
returns table (
  id uuid,
  number integer,
  title text,
  issue_date date,
  expires_on date,
  total numeric,
  status text,
  customer_response text,
  notes text,
  lines jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.number, q.title, q.issue_date, q.expires_on, q.total,
         private.quote_display_status(q.status, q.expires_on, private.business_today(q.business_id)),
         q.customer_response, q.notes,
         coalesce((select jsonb_agg(jsonb_build_object('description', l.description, 'quantity', l.quantity, 'unit_price', l.unit_price, 'amount', l.amount) order by l.position)
                   from public.quote_lines l where l.quote_id = q.id), '[]'::jsonb)
  from public.customer_accounts a
  join public.quotes q on q.customer_id = a.customer_id and q.business_id = a.business_id
  where a.user_id = (select auth.uid()) and q.status <> 'draft'
  order by q.number desc
  limit 100;
$$;

-- Invoices that have been sent to them (never drafts or cancelled), with the pay link's key.
create function public.portal_invoices()
returns table (
  id uuid,
  number integer,
  issue_date date,
  due_date date,
  total numeric,
  amount_paid numeric,
  balance numeric,
  status text,
  pay_token text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.number, i.issue_date, i.due_date, i.total, i.amount_paid, i.total - i.amount_paid,
         private.invoice_display_status(i.status, i.total, i.amount_paid, i.due_date, private.business_today(i.business_id)),
         i.pay_token
  from public.customer_accounts a
  join public.invoices i on i.customer_id = a.customer_id and i.business_id = a.business_id
  where a.user_id = (select auth.uid()) and i.status = 'sent'
  order by i.number desc
  limit 100;
$$;

-- The customer says yes or no to a quote sent to them. A "no" declines it; a "yes" is
-- recorded for the owner, who then books the work (choosing the dates and crew).
create function public.portal_respond_to_quote(quote_id uuid, accept boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  acct public.customer_accounts := private.my_customer_account();
  q public.quotes;
begin
  if acct.id is null then
    raise exception 'Not a customer account' using errcode = '42501';
  end if;
  select * into q from public.quotes x
  where x.id = portal_respond_to_quote.quote_id and x.customer_id = acct.customer_id and x.business_id = acct.business_id
  for update;
  if not found or q.status = 'draft' then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  if q.status <> 'sent' or q.customer_response is not null then
    raise exception 'This quote has already been answered' using errcode = '22023';
  end if;
  if q.expires_on < private.business_today(q.business_id) then
    raise exception 'This quote has expired. Ask for a new one' using errcode = '22023';
  end if;

  if accept then
    update public.quotes x set customer_response = 'accepted', customer_responded_at = now() where x.id = q.id;
  else
    update public.quotes x
    set customer_response = 'declined', customer_responded_at = now(), status = 'declined', decided_at = now()
    where x.id = q.id;
  end if;
end;
$$;

-- The customer asks for more work. It lands in the owner's Requests inbox, linked to them.
create function public.portal_request_service(details text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  acct public.customer_accounts := private.my_customer_account();
  c public.customers;
  d text := btrim(coalesce(portal_request_service.details, ''));
  who text;
begin
  if acct.id is null then
    raise exception 'Not a customer account' using errcode = '42501';
  end if;
  if d = '' or char_length(d) > 1500 then
    raise exception 'Tell us what you need (1,500 characters or fewer)' using errcode = '22023';
  end if;
  if (select count(*) from public.requests r where r.customer_id = acct.customer_id and r.created_at > now() - interval '1 day') >= 5 then
    raise exception 'You''ve sent several requests today. Please call if it''s urgent' using errcode = 'P0429';
  end if;

  select * into c from public.customers x where x.id = acct.customer_id and x.business_id = acct.business_id;
  who := left(coalesce(nullif(btrim(c.first_name || ' ' || c.last_name), ''), nullif(c.phone, ''), nullif(c.email, ''), 'Customer'), 100);

  insert into public.requests (business_id, name, phone, email, address, details, ip_hash, customer_id)
  values (
    acct.business_id, who, left(c.phone, 40),
    case when char_length(c.email) <= 200 then c.email else '' end,
    left(c.property_address, 200), d, 'customer-account', acct.customer_id
  );
exception
  when check_violation then
    raise exception 'Your account is missing a phone number and email. Please call us instead' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke all on public.customer_accounts from anon, authenticated;
-- Owners see who has an account (never the invite hash: column grant below).
grant select (id, business_id, customer_id, user_id, email, invite_expires_at, created_at, joined_at)
  on public.customer_accounts to authenticated;
alter table public.customer_accounts enable row level security;
create policy "Owners can view their customers' accounts"
  on public.customer_accounts for select to authenticated
  using (business_id in (select private.owner_business_ids()));

revoke execute on function public.invite_customer(uuid) from public, anon;
revoke execute on function public.remove_customer_access(uuid) from public, anon;
revoke execute on function public.customer_invite_details(text) from public;
revoke execute on function public.accept_customer_invite(text) from public, anon;
revoke execute on function public.portal_summary() from public, anon;
revoke execute on function public.portal_visits() from public, anon;
revoke execute on function public.portal_quotes() from public, anon;
revoke execute on function public.portal_invoices() from public, anon;
revoke execute on function public.portal_respond_to_quote(uuid, boolean) from public, anon;
revoke execute on function public.portal_request_service(text) from public, anon;
grant execute on function public.invite_customer(uuid) to authenticated;
grant execute on function public.remove_customer_access(uuid) to authenticated;
grant execute on function public.customer_invite_details(text) to anon, authenticated;
grant execute on function public.accept_customer_invite(text) to authenticated;
grant execute on function public.portal_summary() to authenticated;
grant execute on function public.portal_visits() to authenticated;
grant execute on function public.portal_quotes() to authenticated;
grant execute on function public.portal_invoices() to authenticated;
grant execute on function public.portal_respond_to_quote(uuid, boolean) to authenticated;
grant execute on function public.portal_request_service(text) to authenticated;
