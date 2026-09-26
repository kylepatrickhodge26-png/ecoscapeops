-- EcoScape Ops foundation: tenants (businesses), memberships, and customers.
--
-- Isolation model
--   * Every tenant-owned row carries a business_id.
--   * A user's access comes only from their row(s) in business_members.
--   * Row-level security on every table checks business_id against the calling
--     user's memberships, so one business can never read or change another's data,
--     no matter what the client sends.
--   * Membership rows can't be written through the API at all; they are created only
--     by the security-definer functions below (signup trigger / create_business).

-- ---------------------------------------------------------------------------
-- Private schema for helpers. It is not exposed through the Data API, so nothing
-- in here can be called directly by clients.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Businesses (the tenant)
-- ---------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_name_length check (char_length(btrim(name)) between 1 and 120)
);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Memberships: which users belong to which business, and in what role.
-- 'crew' exists so the role model is in place, but no crew features are built yet
-- and crew members are granted nothing on customers below.
-- ---------------------------------------------------------------------------
create type public.business_role as enum ('owner', 'crew');

create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.business_role not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id),
  -- One business per login for now. Dropping this constraint is all the database
  -- needs to let a login join several businesses (the app would need a switcher).
  constraint business_members_one_business_per_user unique (user_id)
);

-- Businesses the current user belongs to (any role) / owns. SECURITY DEFINER so the
-- lookup itself isn't subject to business_members' RLS (which would recurse).
create function private.member_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.business_members m
  where m.user_id = (select auth.uid());
$$;

create function private.owner_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.business_id
  from public.business_members m
  where m.user_id = (select auth.uid())
    and m.role = 'owner';
$$;

revoke execute on function private.member_business_ids() from public;
revoke execute on function private.owner_business_ids() from public;
grant execute on function private.member_business_ids() to authenticated;
grant execute on function private.owner_business_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a business (always together with its owner membership)
-- ---------------------------------------------------------------------------
create function private.create_business_for_user(p_user_id uuid, p_business_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_business_id uuid;
begin
  insert into public.businesses (name)
  values (btrim(p_business_name))
  returning id into new_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (new_business_id, p_user_id, 'owner');

  return new_business_id;
end;
$$;

revoke execute on function private.create_business_for_user(uuid, text) from public;

-- Signup: when a new auth user is created with a business_name in their metadata,
-- create the business and make them its owner in the same transaction.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'business_name'), '') is not null then
    perform private.create_business_for_user(new.id, new.raw_user_meta_data ->> 'business_name');
  end if;
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Fallback for a signed-in user who has no business yet (e.g. their signup metadata
-- was missing). Callable through the API by authenticated users only.
create function public.create_business(business_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if exists (select 1 from public.business_members m where m.user_id = current_user_id) then
    raise exception 'This account already belongs to a business' using errcode = '23505';
  end if;

  return private.create_business_for_user(current_user_id, business_name);
end;
$$;

revoke execute on function public.create_business(text) from public, anon;
grant execute on function public.create_business(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Customers
-- Fields follow the Add Customer form in the EcoScape Ops prototype. Optional text
-- fields use '' for "not provided" so there is only one empty value.
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,

  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  -- Digits only, for duplicate-phone detection ("(631) 555-0142" = "631.555.0142").
  phone_digits text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  email text not null default '',

  property_address text not null default '',
  billing_address text not null default '',
  access_instructions text not null default '',
  service_notes text not null default '',

  preferred_day text not null default 'monday',
  status text not null default 'active',
  notification_preference text not null default 'text',
  sms_opt_in boolean not null default false,
  customer_since date not null default current_date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The prototype names a customer by name, then phone, then email; require at least
  -- one of them so every customer can be identified in a list.
  constraint customers_identifiable check (
    btrim(first_name) <> '' or btrim(last_name) <> '' or btrim(phone) <> '' or btrim(email) <> ''
  ),
  constraint customers_preferred_day_valid check (
    preferred_day in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')
  ),
  constraint customers_status_valid check (status in ('active', 'inactive')),
  constraint customers_notification_preference_valid check (notification_preference in ('text', 'email')),
  constraint customers_email_format check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint customers_field_lengths check (
    char_length(first_name) <= 100
    and char_length(last_name) <= 100
    and char_length(phone) <= 40
    and char_length(email) <= 254
    and char_length(property_address) <= 300
    and char_length(billing_address) <= 300
    and char_length(access_instructions) <= 1000
    and char_length(service_notes) <= 2000
  )
);

create index customers_business_name_idx on public.customers (business_id, last_name, first_name);
create index customers_business_phone_idx on public.customers (business_id, phone_digits);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

-- A customer can never be moved to another business, even by someone who owns both.
create function private.prevent_business_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'business_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger customers_business_id_immutable
  before update on public.customers
  for each row execute function private.prevent_business_id_change();

-- ---------------------------------------------------------------------------
-- Privileges. Explicit grants (rather than relying on project defaults), and the
-- anonymous role gets nothing on any tenant table.
-- ---------------------------------------------------------------------------
revoke all on public.businesses, public.business_members, public.customers from anon, authenticated;

grant select, update (name) on public.businesses to authenticated;
grant select on public.business_members to authenticated;
grant select, insert, update, delete on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.customers enable row level security;

-- Businesses: members can see their business; owners can rename it.
-- No insert/delete policies: businesses are created only via the functions above.
create policy "Members can view their business"
  on public.businesses for select
  to authenticated
  using (id in (select private.member_business_ids()));

create policy "Owners can update their business"
  on public.businesses for update
  to authenticated
  using (id in (select private.owner_business_ids()))
  with check (id in (select private.owner_business_ids()));

-- Memberships: members can see who belongs to their business. No write policies.
create policy "Members can view memberships of their business"
  on public.business_members for select
  to authenticated
  using (business_id in (select private.member_business_ids()));

-- Customers: owners have full access to their own business's customers.
-- Crew access will be decided when crew features are built.
create policy "Owners can view their customers"
  on public.customers for select
  to authenticated
  using (business_id in (select private.owner_business_ids()));

create policy "Owners can add customers"
  on public.customers for insert
  to authenticated
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can update their customers"
  on public.customers for update
  to authenticated
  using (business_id in (select private.owner_business_ids()))
  with check (business_id in (select private.owner_business_ids()));

create policy "Owners can delete their customers"
  on public.customers for delete
  to authenticated
  using (business_id in (select private.owner_business_ids()));
