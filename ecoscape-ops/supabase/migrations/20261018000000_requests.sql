-- Requests: a public form where a potential customer asks for work, and an owner-only inbox.
--
-- Each business has a secret link (/request/<token>). The page shows only the business's
-- name and the form. Anyone can submit, but a submission can only ever create a request for
-- the business that owns the link, and nobody signed out can read anything back. Requests are
-- owner-only. Abuse limits (per IP, per business, and a cap on unread requests) are enforced
-- in the database function, not just the page. Everything submitted is data: the app escapes
-- it wherever it is shown.

create type public.request_status as enum ('new', 'converted', 'dismissed');

-- The shareable link: one row per business, made the first time the owner opens Requests.
create table public.request_links (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  token text not null unique default private.new_invite_token(),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  details text not null,
  status public.request_status not null default 'new',
  -- The customer made from this request.
  customer_id uuid,
  -- A one-way hash of the sender's address, used only to limit repeat submissions.
  ip_hash text not null,
  created_at timestamptz not null default now(),
  handled_at timestamptz,

  foreign key (customer_id, business_id) references public.customers (id, business_id) on delete set null (customer_id),
  constraint requests_id_business_unique unique (id, business_id),
  constraint requests_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint requests_phone_length check (char_length(phone) <= 40),
  constraint requests_email_length check (char_length(email) <= 200),
  constraint requests_email_format check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint requests_address_length check (char_length(address) <= 200),
  constraint requests_details_length check (char_length(btrim(details)) between 1 and 1500),
  constraint requests_contact check (btrim(phone) <> '' or btrim(email) <> ''),
  constraint requests_ip_hash_length check (char_length(ip_hash) between 1 and 100)
);

create index requests_business_idx on public.requests (business_id, created_at desc);
create index requests_ip_idx on public.requests (ip_hash, created_at);

create trigger requests_business_id_immutable
  before update on public.requests
  for each row execute function private.prevent_business_id_change();

-- ---------------------------------------------------------------------------
-- What the public page can ask: is this link on, and whose is it? Only a name comes back.
-- ---------------------------------------------------------------------------
create function public.public_request_form(token text)
returns table (business_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name
  from public.request_links l
  join public.businesses b on b.id = l.business_id
  where l.token = public_request_form.token and l.enabled;
$$;

-- ---------------------------------------------------------------------------
-- Sending a request. Callable signed out, so it does its own checking and limiting.
-- ---------------------------------------------------------------------------
create function public.submit_request(
  token text,
  name text,
  phone text,
  email text,
  address text,
  details text,
  ip_hash text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid;
  n text := btrim(coalesce(submit_request.name, ''));
  p text := btrim(coalesce(submit_request.phone, ''));
  e text := btrim(coalesce(submit_request.email, ''));
  a text := btrim(coalesce(submit_request.address, ''));
  d text := btrim(coalesce(submit_request.details, ''));
  h text := coalesce(submit_request.ip_hash, '');
begin
  select l.business_id into biz
  from public.request_links l
  where l.token = submit_request.token and l.enabled;
  if biz is null then
    raise exception 'This form isn''t available' using errcode = 'P0002';
  end if;

  if n = '' or char_length(n) > 100 then
    raise exception 'Enter your name (100 characters or fewer)' using errcode = '22023';
  end if;
  if char_length(p) > 40 then
    raise exception 'The phone number is too long' using errcode = '22023';
  end if;
  if char_length(e) > 200 or (e <> '' and e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if p = '' and e = '' then
    raise exception 'Enter a phone number or an email so we can reach you' using errcode = '22023';
  end if;
  if char_length(a) > 200 then
    raise exception 'The address is too long (200 characters or fewer)' using errcode = '22023';
  end if;
  if d = '' or char_length(d) > 1500 then
    raise exception 'Tell us what you need (1,500 characters or fewer)' using errcode = '22023';
  end if;
  if h = '' or char_length(h) > 100 then
    raise exception 'Something went wrong' using errcode = '22023';
  end if;

  -- One submission at a time per business, so the counts below can't be raced.
  perform pg_advisory_xact_lock(hashtextextended(biz::text, 0));

  if (select count(*) from public.requests r where r.ip_hash = h and r.created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.requests r where r.ip_hash = h and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many requests from your connection. Please try again later' using errcode = 'P0429';
  end if;
  if (select count(*) from public.requests r where r.business_id = biz and r.created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.requests r where r.business_id = biz and r.created_at > now() - interval '1 day') >= 100 then
    raise exception 'This form is busy right now. Please try again later' using errcode = 'P0429';
  end if;
  -- A ceiling on unread requests, so a flood can't grow the table without limit.
  if (select count(*) from public.requests r where r.business_id = biz and r.status = 'new') >= 500 then
    raise exception 'This form is full right now. Please call instead' using errcode = 'P0429';
  end if;

  insert into public.requests (business_id, name, phone, email, address, details, ip_hash)
  values (biz, n, p, e, a, d, h);
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner: the link and the inbox.
-- ---------------------------------------------------------------------------
create function public.request_link()
returns table (token text, enabled boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  insert into public.request_links (business_id) values (biz) on conflict (business_id) do nothing;
  return query select l.token, l.enabled from public.request_links l where l.business_id = biz;
end;
$$;

create function public.set_request_link_enabled(enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  insert into public.request_links (business_id, enabled) values (biz, set_request_link_enabled.enabled)
  on conflict (business_id) do update set enabled = excluded.enabled, updated_at = now();
end;
$$;

-- A new secret: the old link stops working at once.
create function public.regenerate_request_link()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  new_token text := private.new_invite_token();
begin
  insert into public.request_links (business_id, token) values (biz, new_token)
  on conflict (business_id) do update set token = excluded.token, updated_at = now();
  return new_token;
end;
$$;

-- Makes a customer from a request (once; asking again returns the same customer). The
-- sender's details become the customer's, and what they asked for goes in the service notes.
create function public.convert_request(request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
  req public.requests;
  new_customer uuid;
  first_part text;
  last_part text;
begin
  select * into req from public.requests r where r.id = convert_request.request_id and r.business_id = biz for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if req.status = 'converted' and req.customer_id is not null then
    return req.customer_id;
  end if;

  first_part := split_part(req.name, ' ', 1);
  last_part := btrim(substr(req.name, char_length(first_part) + 1));

  insert into public.customers (business_id, first_name, last_name, phone, email, property_address, service_notes)
  values (biz, left(first_part, 100), left(last_part, 100), req.phone, req.email, req.address, left('Requested: ' || req.details, 2000))
  returning id into new_customer;

  update public.requests r
  set status = 'converted', customer_id = new_customer, handled_at = now()
  where r.id = req.id;
  return new_customer;
end;
$$;

create function public.dismiss_request(request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  update public.requests r
  set status = 'dismissed', handled_at = now()
  where r.id = dismiss_request.request_id and r.business_id = biz and r.status = 'new';
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.delete_request(request_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  biz uuid := private.my_owned_business();
begin
  delete from public.requests r where r.id = delete_request.request_id and r.business_id = biz and r.status <> 'new';
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke all on public.request_links, public.requests from anon, authenticated;
grant select on public.request_links, public.requests to authenticated;

alter table public.request_links enable row level security;
alter table public.requests enable row level security;

create policy "Owners can view their request link"
  on public.request_links for select to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can view their requests"
  on public.requests for select to authenticated
  using (business_id in (select private.owner_business_ids()));

revoke execute on function public.public_request_form(text) from public;
revoke execute on function public.submit_request(text, text, text, text, text, text, text) from public;
revoke execute on function public.request_link() from public, anon;
revoke execute on function public.set_request_link_enabled(boolean) from public, anon;
revoke execute on function public.regenerate_request_link() from public, anon;
revoke execute on function public.convert_request(uuid) from public, anon;
revoke execute on function public.dismiss_request(uuid) from public, anon;
revoke execute on function public.delete_request(uuid) from public, anon;
grant execute on function public.public_request_form(text) to anon, authenticated;
grant execute on function public.submit_request(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.request_link() to authenticated;
grant execute on function public.set_request_link_enabled(boolean) to authenticated;
grant execute on function public.regenerate_request_link() to authenticated;
grant execute on function public.convert_request(uuid) to authenticated;
grant execute on function public.dismiss_request(uuid) to authenticated;
grant execute on function public.delete_request(uuid) to authenticated;
